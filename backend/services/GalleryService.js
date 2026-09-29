const Event = require("../models/Event");
const ClubMembership = require("../models/ClubMembership");
const EventMedia = require("../models/EventMedia");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { env } = require("../config/env");
const { GALLERY_STATUS, MEMBERSHIP_STATUS, REGISTRATION_STATUS, PUBLIC_EVENT_STATUSES, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { parsePagination, paginationMeta, searchRegex } = require("../utils/Query");
const { getClubContext, contextHas } = require("./AuthorizationService");
const { clubUsersWithPermission, clubIdsWithAnyPermission } = require("./MembershipService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const media = require("./GalleryMediaService");

// Event galleries. Club members can add photos and videos once the event is published; participants can
// once the event has started and they've been checked in at the door. Nothing is public until the club's
// president or vice-president approves it (their own uploads go straight in). Rejected uploads are deleted.

const { PENDING, APPROVED } = GALLERY_STATUS;
const MODERATE = CLUB_PERMISSIONS.MODERATE_GALLERY;
const MAX_TICKETS = 20;
const MAX_REVIEW_BATCH = 100;
// One "new uploads to review" notification per uploader per burst of uploads, not one per file.
const SUBMIT_NOTICE_QUIET_MS = 15 * 60 * 1000;

const findEvent = async (eventId) => {
    const event = await Event.findById(eventId).select("title club status startAt endAt");
    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return event;
};

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const itemsLabel = (items) => {
    const videos = items.filter((item) => item.media.kind === media.KINDS.VIDEO).length;
    const photos = items.length - videos;
    return [photos && plural(photos, "photo"), videos && plural(videos, "video")].filter(Boolean).join(" and ");
};

const NOT_ALLOWED = "Only club members and checked-in participants can add photos and videos to this event.";

/**
 * What the signed-in user may do with this event's gallery. `role` is how they may upload (MEMBER or
 * PARTICIPANT); `hint` tells a registered student what they still need to do, only while they can still
 * do it; `reason` explains a refused upload.
 */
const galleryAccess = async (actor, event) => {
    if (!actor) {
        return { canUpload: false, canModerate: false, role: null, hint: null, reason: NOT_ALLOWED };
    }
    const context = await getClubContext(actor, event.club);
    const canModerate = contextHas(context, MODERATE);

    if (!PUBLIC_EVENT_STATUSES.includes(event.status)) {
        return { canUpload: false, canModerate, role: null, hint: null, reason: "Photos can be added once the event is published." };
    }
    if (context.isMember) {
        return { canUpload: true, canModerate, role: "MEMBER", hint: null, reason: null };
    }

    const registration = await EventRegistration.findOne({ event: event._id, user: actor._id, status: REGISTRATION_STATUS.REGISTERED }).select("checkedInAt");
    const now = new Date();
    const started = new Date(event.startAt) <= now;
    if (registration?.checkedInAt && started) {
        return { canUpload: true, canModerate, role: "PARTICIPANT", hint: null, reason: null };
    }

    const ended = event.status === "COMPLETED" || new Date(event.endAt) <= now;
    let hint = null;
    if (registration && !started) {
        hint = "You can add photos and videos once the event starts and you've been checked in.";
    } else if (registration && !ended && !registration.checkedInAt) {
        hint = "Get checked in at the entrance to add your photos and videos.";
    }
    return { canUpload: false, canModerate, role: null, hint, reason: hint || NOT_ALLOWED };
};

const assertCanUpload = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const access = await galleryAccess(actor, event);
    if (!access.canUpload) {
        throw new AppError(access.reason, 403, ERROR_CODES.FORBIDDEN);
    }
    return { event, access };
};

const assertPendingRoom = async (actor, event, access, adding = 1) => {
    if (access.canModerate) {
        return;
    }
    const waiting = await EventMedia.countDocuments({ event: event._id, uploader: actor._id, status: PENDING });
    if (waiting + adding > env.gallery.maxPendingPerUser) {
        throw new AppError(
            `You have ${plural(waiting, "upload")} waiting for review. You can add more once the club has reviewed them (up to ${env.gallery.maxPendingPerUser} at a time).`,
            409,
            ERROR_CODES.CONFLICT
        );
    }
};

const itemView = (item, { viewerId = null, canModerate = false } = {}) => {
    const uploader = item.uploader || {};
    const mine = Boolean(viewerId && String(uploader._id || item.uploader) === String(viewerId));
    return {
        _id: item._id,
        kind: item.media.kind,
        ...media.mediaUrls(item.media),
        width: item.media.width,
        height: item.media.height,
        duration: item.media.duration,
        status: item.status,
        uploader: { _id: uploader._id || item.uploader, name: uploader.name || "CampusConnect user" },
        uploaderRole: item.uploaderRole,
        createdAt: item.createdAt,
        mine,
        canDelete: mine || canModerate
    };
};

const limits = () => ({
    maxImageBytes: env.gallery.maxImageBytes,
    maxVideoBytes: env.gallery.maxVideoBytes,
    maxVideoSeconds: env.gallery.maxVideoSeconds,
    maxPendingPerUser: env.gallery.maxPendingPerUser
});

/**
 * The gallery as the viewer sees it: approved items (paged, newest first), plus the viewer's own uploads
 * still waiting for review, and — for the president and vice-president — the whole review queue.
 */
const getGallery = async (actor, eventId, query = {}) => {
    const event = await findEvent(eventId);
    const access = await galleryAccess(actor, event);
    const viewer = { viewerId: actor?._id || null, canModerate: access.canModerate };
    const pagination = parsePagination(query, { defaultLimit: 24, maxLimit: 60 });

    if (!PUBLIC_EVENT_STATUSES.includes(event.status)) {
        return { items: [], meta: paginationMeta(pagination, 0), mine: [], pending: [], counts: { approved: 0, pending: 0 }, viewer: { ...access, limits: limits() } };
    }

    const approvedFilter = { event: event._id, status: APPROVED };
    const [items, approvedCount, mine, pending, pendingCount] = await Promise.all([
        EventMedia.find(approvedFilter).sort({ createdAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit).populate("uploader", "name"),
        EventMedia.countDocuments(approvedFilter),
        actor && !access.canModerate
            ? EventMedia.find({ event: event._id, uploader: actor._id, status: PENDING }).sort({ createdAt: -1 }).populate("uploader", "name")
            : [],
        access.canModerate ? EventMedia.find({ event: event._id, status: PENDING }).sort({ createdAt: 1 }).limit(MAX_REVIEW_BATCH).populate("uploader", "name") : [],
        access.canModerate ? EventMedia.countDocuments({ event: event._id, status: PENDING }) : 0
    ]);

    return {
        items: items.map((item) => itemView(item, viewer)),
        meta: paginationMeta(pagination, approvedCount),
        mine: mine.map((item) => itemView(item, viewer)),
        pending: pending.map((item) => itemView(item, viewer)),
        counts: { approved: approvedCount, pending: access.canModerate ? pendingCount : mine.length },
        viewer: { ...access, limits: limits() }
    };
};

// Upload tickets for a batch of files (one request, so picking 20 photos doesn't hit the upload rate limit).
const createUploadTickets = async (actor, eventId, kinds) => {
    const list = (Array.isArray(kinds) ? kinds : [kinds]).slice(0, MAX_TICKETS);
    if (!list.length || list.some((kind) => !Object.values(media.KINDS).includes(kind))) {
        throw new AppError("Choose photos or videos", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const { event, access } = await assertCanUpload(actor, eventId);
    await assertPendingRoom(actor, event, access, list.length);
    return list.map((kind) => media.createUploadTicket(String(event._id), String(actor._id), kind));
};

// Development storage only: with Cloudinary configured the browser uploads straight to Cloudinary.
const uploadLocalMedia = async (actor, eventId, file) => {
    if (media.providerName() !== "local") {
        throw new AppError("Gallery media is uploaded directly to cloud storage", 400, ERROR_CODES.UPLOAD_ERROR);
    }
    const { event } = await assertCanUpload(actor, eventId);
    return { provider: "local", ...(await media.saveLocalFile(file, String(event._id), String(actor._id))) };
};

const notifyReviewers = async (actor, event, item) => {
    const recent = await EventMedia.countDocuments({
        _id: { $ne: item._id },
        event: event._id,
        uploader: actor._id,
        status: PENDING,
        createdAt: { $gte: new Date(Date.now() - SUBMIT_NOTICE_QUIET_MS) }
    });
    if (recent > 0) {
        return;
    }
    await notify(await clubUsersWithPermission(event.club, MODERATE), {
        type: NOTIFICATION_TYPES.GALLERY_SUBMITTED,
        title: `New photos to review for ${event.title}`,
        message: `${actor.name} added to the event gallery. Approve them to show them on the event page.`,
        link: `/gallery/${event._id}?review=1`,
        exclude: [actor._id]
    });
};

/** Attaches an uploaded file to the gallery: straight in for the president/VP, otherwise waiting for review. */
const addMedia = async (actor, eventId, payload) => {
    const { event, access } = await assertCanUpload(actor, eventId);
    const stored = media.verifyUpload(payload.media, String(event._id), String(actor._id));

    try {
        await assertPendingRoom(actor, event, access);
    } catch (error) {
        await media.deleteMediaQuietly(stored);
        throw error;
    }

    const now = new Date();
    let item;
    try {
        item = await EventMedia.create({
            event: event._id,
            club: event.club,
            uploader: actor._id,
            uploaderRole: access.role,
            media: stored,
            status: access.canModerate ? APPROVED : PENDING,
            reviewedBy: access.canModerate ? actor._id : null,
            reviewedAt: access.canModerate ? now : null
        });
    } catch (error) {
        await media.deleteMediaQuietly(stored);
        throw error;
    }

    await recordAudit({
        action: AUDIT_ACTIONS.GALLERY_MEDIA_ADDED,
        actor: actor._id,
        targetType: "EventMedia",
        targetId: item._id,
        toState: item.status,
        metadata: { eventId: event._id, clubId: event.club, kind: stored.kind, role: access.role }
    });
    if (item.status === PENDING) {
        await notifyReviewers(actor, event, item);
    }

    item.uploader = { _id: actor._id, name: actor.name };
    return itemView(item, { viewerId: actor._id, canModerate: access.canModerate });
};

const pendingCounts = async (event) => ({
    approved: await EventMedia.countDocuments({ event: event._id, status: APPROVED }),
    pending: await EventMedia.countDocuments({ event: event._id, status: PENDING })
});

const byUploader = (items) =>
    items.reduce((groups, item) => {
        const key = String(item.uploader);
        (groups[key] ||= []).push(item);
        return groups;
    }, {});

const loadReviewBatch = async (actor, eventId, ids) => {
    const event = await findEvent(eventId);
    const context = await getClubContext(actor, event.club);
    if (!contextHas(context, MODERATE)) {
        throw new AppError("Only the club president or vice-president can review gallery uploads", 403, ERROR_CODES.FORBIDDEN);
    }
    const unique = [...new Set((ids || []).map(String))].slice(0, MAX_REVIEW_BATCH);
    const items = await EventMedia.find({ _id: { $in: unique }, event: event._id, status: PENDING });
    return { event, items };
};

/** President/VP: makes pending uploads public on the event page. */
const approveMedia = async (actor, eventId, ids) => {
    const { event, items } = await loadReviewBatch(actor, eventId, ids);
    if (items.length) {
        await EventMedia.updateMany({ _id: { $in: items.map((item) => item._id) }, status: PENDING }, { $set: { status: APPROVED, reviewedBy: actor._id, reviewedAt: new Date() } });
        await recordAudit({
            action: AUDIT_ACTIONS.GALLERY_MEDIA_APPROVED,
            actor: actor._id,
            targetType: "Event",
            targetId: event._id,
            fromState: PENDING,
            toState: APPROVED,
            metadata: { clubId: event.club, count: items.length, mediaIds: items.map((item) => item._id) }
        });
        await Promise.all(
            Object.entries(byUploader(items)).map(([uploaderId, theirs]) =>
                notify([uploaderId], {
                    type: NOTIFICATION_TYPES.GALLERY_APPROVED,
                    title: `Your ${theirs.length === 1 ? (theirs[0].media.kind === "VIDEO" ? "video is" : "photo is") : "uploads are"} in the ${event.title} gallery`,
                    message: `${itemsLabel(theirs)} you added ${theirs.length === 1 ? "is" : "are"} now on the event page.`,
                    link: `/gallery/${event._id}`,
                    exclude: [actor._id]
                })
            )
        );
    }
    return { approved: items.length, counts: await pendingCounts(event) };
};

/** President/VP: declines pending uploads. The files are deleted and the uploaders told why. */
const rejectMedia = async (actor, eventId, ids, reason = "") => {
    const { event, items } = await loadReviewBatch(actor, eventId, ids);
    const note = String(reason || "").trim().slice(0, 200);
    if (items.length) {
        await EventMedia.deleteMany({ _id: { $in: items.map((item) => item._id) }, status: PENDING });
        await Promise.all(items.map((item) => media.deleteMediaQuietly(item.media)));
        await recordAudit({
            action: AUDIT_ACTIONS.GALLERY_MEDIA_REJECTED,
            actor: actor._id,
            targetType: "Event",
            targetId: event._id,
            fromState: PENDING,
            reason: note || null,
            metadata: { clubId: event.club, count: items.length, mediaIds: items.map((item) => item._id) }
        });
        await Promise.all(
            Object.entries(byUploader(items)).map(([uploaderId, theirs]) =>
                notify([uploaderId], {
                    type: NOTIFICATION_TYPES.GALLERY_REJECTED,
                    title: `Not added to the ${event.title} gallery`,
                    message: `The club didn't add ${itemsLabel(theirs)} you uploaded.${note ? ` Reason: ${note}` : ""}`,
                    link: `/gallery/${event._id}`,
                    exclude: [actor._id]
                })
            )
        );
    }
    return { rejected: items.length, counts: await pendingCounts(event) };
};

/** Uploaders can delete their own photos and videos; the president and vice-president can remove any. */
const removeMedia = async (actor, eventId, mediaId) => {
    const event = await findEvent(eventId);
    const item = await EventMedia.findOne({ _id: mediaId, event: event._id });
    if (!item) {
        throw new AppError("Photo or video not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const mine = String(item.uploader) === String(actor._id);
    if (!mine) {
        const context = await getClubContext(actor, event.club);
        if (!contextHas(context, MODERATE)) {
            throw new AppError("You can only delete your own photos and videos", 403, ERROR_CODES.FORBIDDEN);
        }
    }

    await EventMedia.deleteOne({ _id: item._id });
    await media.deleteMediaQuietly(item.media);
    await recordAudit({
        action: AUDIT_ACTIONS.GALLERY_MEDIA_REMOVED,
        actor: actor._id,
        targetType: "EventMedia",
        targetId: item._id,
        fromState: item.status,
        metadata: { eventId: event._id, clubId: event.club, uploader: item.uploader, kind: item.media.kind }
    });
    return pendingCounts(event);
};

// Clubs where this person approves gallery uploads (president / vice-president).
const moderatedClubIds = async (actor) => {
    if (!actor) {
        return [];
    }
    return clubIdsWithAnyPermission(actor._id, [MODERATE]);
};

/**
 * The Gallery section: published and completed events, those with the latest photos first, each with its photo and video counts
 * and a cover (the newest approved photo, else the event poster). `show`: all | photos (events that have
 * some) | review (events with uploads waiting for this president / vice-president).
 */
const listGalleries = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 12, maxLimit: 30 });
    const base = { status: { $in: PUBLIC_EVENT_STATUSES } };
    if (String(query.search || "").trim()) {
        base.title = searchRegex(query.search);
    }
    if (query.club) {
        base.club = query.club;
    }

    const moderated = await moderatedClubIds(actor);
    const toReview = moderated.length ? await EventMedia.distinct("event", { status: PENDING, club: { $in: moderated } }) : [];

    // Events with photos come first, most recently updated first; then the rest, newest event first.
    const activity = await EventMedia.aggregate([
        { $match: { status: APPROVED } },
        { $group: { _id: "$event", latest: { $max: "$createdAt" } } },
        { $sort: { latest: -1 } }
    ]);
    const matchingIds = new Set((await Event.find({ ...base, _id: { $in: activity.map((row) => row._id) } }).select("_id")).map((event) => String(event._id)));
    const withPhotosOrdered = activity.map((row) => row._id).filter((id) => matchingIds.has(String(id)));

    const load = (ids) =>
        ids.length
            ? Event.find({ _id: { $in: ids } }).select("title poster category startAt endAt status club").populate("club", "name logo")
            : [];
    const inOrder = (ids, docs) => ids.map((id) => docs.find((doc) => String(doc._id) === String(id))).filter(Boolean);

    let events;
    let total;
    if (query.show === "review") {
        const filter = { ...base, _id: { $in: toReview } };
        [events, total] = await Promise.all([
            Event.find(filter).select("title poster category startAt endAt status club").populate("club", "name logo").sort({ startAt: -1, _id: -1 }).skip(pagination.skip).limit(pagination.limit),
            Event.countDocuments(filter)
        ]);
    } else {
        const firstIds = withPhotosOrdered.slice(pagination.skip, pagination.skip + pagination.limit);
        events = inOrder(firstIds, await load(firstIds));
        const others = { ...base, _id: { $nin: withPhotosOrdered } };
        const othersCount = query.show === "photos" ? 0 : await Event.countDocuments(others);
        total = withPhotosOrdered.length + othersCount;
        const room = pagination.limit - events.length;
        if (room > 0 && othersCount > 0) {
            const skip = Math.max(0, pagination.skip - withPhotosOrdered.length);
            events = events.concat(
                await Event.find(others).select("title poster category startAt endAt status club").populate("club", "name logo").sort({ startAt: -1, _id: -1 }).skip(skip).limit(room)
            );
        }
    }

    const [allCount, reviewCount] = await Promise.all([
        Event.countDocuments(base),
        toReview.length ? Event.countDocuments({ ...base, _id: { $in: toReview } }) : 0
    ]);
    const photosCount = withPhotosOrdered.length;

    const ids = events.map((event) => event._id);
    const [stats, covers] = await Promise.all([
        EventMedia.aggregate([
            { $match: { event: { $in: ids } } },
            {
                $group: {
                    _id: "$event",
                    photos: { $sum: { $cond: [{ $and: [{ $eq: ["$status", APPROVED] }, { $eq: ["$media.kind", "IMAGE"] }] }, 1, 0] } },
                    videos: { $sum: { $cond: [{ $and: [{ $eq: ["$status", APPROVED] }, { $eq: ["$media.kind", "VIDEO"] }] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ["$status", PENDING] }, 1, 0] } },
                    latestAt: { $max: { $cond: [{ $eq: ["$status", APPROVED] }, "$createdAt", null] } }
                }
            }
        ]),
        EventMedia.aggregate([
            { $match: { event: { $in: ids }, status: APPROVED } },
            { $sort: { "media.kind": 1, createdAt: -1 } },
            { $group: { _id: "$event", media: { $first: "$media" }, thumbs: { $push: "$media" } } },
            { $project: { media: 1, thumbs: { $slice: ["$thumbs", 4] } } }
        ])
    ]);
    const statsBy = new Map(stats.map((row) => [String(row._id), row]));
    const coverBy = new Map(covers.map((row) => [String(row._id), row]));
    const moderatedSet = new Set(moderated.map(String));

    const items = events.map((event) => {
        const row = statsBy.get(String(event._id)) || {};
        const cover = coverBy.get(String(event._id));
        return {
            event: {
                _id: event._id,
                title: event.title,
                poster: event.poster || null,
                category: event.category,
                startAt: event.startAt,
                endAt: event.endAt,
                status: event.status,
                club: event.club
            },
            photos: row.photos || 0,
            videos: row.videos || 0,
            latestAt: row.latestAt || null,
            pending: moderatedSet.has(String(event.club?._id)) ? row.pending || 0 : 0,
            cover: cover ? media.mediaUrls(cover.media).thumb : null,
            previews: cover ? cover.thumbs.map((item) => media.mediaUrls(item).thumb).filter(Boolean) : []
        };
    });

    return {
        items,
        meta: { ...paginationMeta(pagination, total), counts: { all: allCount, photos: photosCount, review: reviewCount }, canReview: moderated.length > 0 }
    };
};

/** Waiting-for-review counts per event, for the president's and VP's dashboards. */
const pendingByEvent = async (clubIds) => {
    if (!clubIds.length) {
        return [];
    }
    const rows = await EventMedia.aggregate([
        { $match: { club: { $in: clubIds }, status: PENDING } },
        { $group: { _id: "$event", pending: { $sum: 1 }, club: { $first: "$club" } } }
    ]);
    return rows.map((row) => ({ event: row._id, club: row.club, pending: row.pending }));
};

module.exports = {
    listGalleries,
    galleryAccess,
    getGallery,
    createUploadTickets,
    uploadLocalMedia,
    addMedia,
    approveMedia,
    rejectMedia,
    removeMedia,
    pendingByEvent
};
