const FeedPost = require("../models/FeedPost");
const Event = require("../models/Event");
const ClubMembership = require("../models/ClubMembership");
const Club = require("../models/Club");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    FEED_POST_TYPES,
    FEED_VISIBILITY,
    MEMBERSHIP_STATUS,
    CLUB_STATUS,
    PUBLIC_EVENT_STATUSES,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { parsePagination, paginationMeta } = require("../utils/Query");
const { getClubContext, contextHas, assertClubPermission } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify, notifyAllUsers } = require("./NotificationService");
const { sendAnnouncementEmails } = require("./CampusMailer");
const { approvedMemberIds } = require("./MembershipService");
const logger = require("../utils/Logger");

const MANUAL_POST_TYPES = [FEED_POST_TYPES.ANNOUNCEMENT, FEED_POST_TYPES.CLUB_UPDATE, FEED_POST_TYPES.EVENT_UPDATE];

const populatePost = (query) =>
    query
        .populate("club", "name logo category status")
        .populate("author", "name")
        .populate({
            path: "event",
            select: "title shortDescription poster startAt endAt status venue registeredCount maxParticipants category",
            populate: { path: "venue", select: "name location" }
        })
        .populate({
            path: "result",
            select: "summary awards status publishedAt",
            populate: { path: "awards.recipientUser", select: "name" }
        });

// Event updates and cancellations, recorded against the event and shown on its page (not in the campus feed).
const createSystemPost = async ({ type, club, event = null, result = null, author, title, body = "", image = null }) => {
    try {
        return await FeedPost.create({
            type,
            club,
            event,
            result,
            author,
            title,
            body,
            image,
            visibility: FEED_VISIBILITY.PUBLIC,
            isSystem: true
        });
    } catch (error) {
        logger.error("Failed to create feed post", { type, message: error.message });
        return null;
    }
};

const createPost = async (actor, payload) => {
    const { club: clubId, type = FEED_POST_TYPES.ANNOUNCEMENT, title, body = "", event: eventId = null, image = null } = payload;
    const visibility = payload.visibility === FEED_VISIBILITY.MEMBERS ? FEED_VISIBILITY.MEMBERS : FEED_VISIBILITY.PUBLIC;

    if (!MANUAL_POST_TYPES.includes(type)) {
        throw new AppError("Invalid post type", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (!title || !String(title).trim()) {
        throw new AppError("Post title is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const context = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.POST_UPDATES, "You cannot post on behalf of this club");

    if (context.club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can post updates", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    let event = null;
    if (type === FEED_POST_TYPES.EVENT_UPDATE || eventId) {
        if (!eventId) {
            throw new AppError("Event updates must reference an event", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        event = await Event.findById(eventId).select("club status");
        if (!event || String(event.club) !== String(context.club._id) || !PUBLIC_EVENT_STATUSES.includes(event.status)) {
            throw new AppError("Updates can only reference this club's published events", 400, ERROR_CODES.VALIDATION_ERROR);
        }
    }

    const post = await FeedPost.create({
        type,
        club: context.club._id,
        event: event?._id || null,
        author: actor._id,
        title: String(title).trim(),
        body,
        image,
        visibility
    });

    await recordAudit({
        action: AUDIT_ACTIONS.FEED_POST_CREATED,
        actor: actor._id,
        targetType: "FeedPost",
        targetId: post._id,
        metadata: { clubId: context.club._id, type }
    });

    // Announcements are delivered as notifications (the campus feed shows events only).
    const notification = {
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        title: `${context.club.name}: ${post.title}`,
        message: String(body || "").slice(0, 300),
        link: event ? `/events/${event._id}` : `/clubs/${context.club._id}`,
        exclude: [actor._id]
    };

    const membersOnly = visibility === FEED_VISIBILITY.MEMBERS;
    if (membersOnly) {
        await notify([...(await approvedMemberIds(context.club._id)), context.club.mentor], notification);
    } else {
        await notifyAllUsers(notification);
    }
    // Followers of the club (bell on) also get it by email.
    await sendAnnouncementEmails(post, context.club, actor, { membersOnly, link: notification.link });

    return populatePost(FeedPost.findById(post._id));
};

const listFeed = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 10 });
    const filter = {};

    const types = String(query.types || query.type || "")
        .split(",")
        .map((type) => type.trim().toUpperCase())
        .filter((type) => Object.values(FEED_POST_TYPES).includes(type));
    if (types.length) {
        filter.type = { $in: types };
    }

    if (query.event) {
        filter.event = query.event;
    }

    if (query.club) {
        filter.club = query.club;
    } else if (query.scope === "my-clubs" && actor) {
        const memberships = await ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club");
        filter.club = { $in: memberships.map((m) => m.club) };
    }

    // Members-only posts are visible to that club's members and mentor only (not the university admin).
    const [memberships, mentored] = actor
        ? await Promise.all([
              ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club"),
              Club.find({ mentor: actor._id }).select("_id")
          ])
        : [[], []];
    const insideClubs = [...memberships.map((m) => m.club), ...mentored.map((c) => c._id)];

    filter.$or = [
        { visibility: FEED_VISIBILITY.PUBLIC },
        { visibility: FEED_VISIBILITY.MEMBERS, club: { $in: insideClubs } }
    ];

    const [items, total] = await Promise.all([
        populatePost(FeedPost.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        FeedPost.countDocuments(filter)
    ]);

    return { items, ...paginationMeta(pagination, total) };
};

const deletePost = async (actor, id) => {
    const post = await FeedPost.findById(id);

    if (!post) {
        throw new AppError("Post not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const isAuthor = String(post.author) === String(actor._id) && !post.isSystem;

    if (!isAuthor) {
        const context = await getClubContext(actor, post.club);
        if (!contextHas(context, CLUB_PERMISSIONS.MANAGE_CLUB)) {
            throw new AppError("You cannot delete this post", 403, ERROR_CODES.FORBIDDEN);
        }
    }

    await FeedPost.deleteOne({ _id: post._id });

    await recordAudit({
        action: AUDIT_ACTIONS.FEED_POST_DELETED,
        actor: actor._id,
        targetType: "FeedPost",
        targetId: post._id,
        metadata: { clubId: post.club, type: post.type }
    });
};

module.exports = { createSystemPost, createPost, listFeed, deletePost, MANUAL_POST_TYPES };
