const Story = require("../models/Story");
const StoryView = require("../models/StoryView");
const Event = require("../models/Event");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { env } = require("../config/env");
const { CLUB_STATUS, MEMBERSHIP_STATUS, PUBLIC_EVENT_STATUSES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS, roleHasPermission } = require("../constants/Permissions");
const { parsePagination, paginationMeta } = require("../utils/Query");
const { assertClubPermission } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const media = require("./StoryMediaService");
const logger = require("../utils/Logger");

// Club stories: photos and short videos that disappear after 24 hours, shown as rings at the top of the feed.
// Anyone signed in can watch them; the club's officers who can post updates (president, vice president,
// marketing coordinator) post them and see who watched.

const MANAGE = CLUB_PERMISSIONS.POST_UPDATES;
const TRAY_CACHE_MS = 30 * 1000;
const SWEEP_EVERY_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 100;
const MAX_CLEANUP_ATTEMPTS = 5;

const notFound = () => new AppError("This story is no longer available", 404, ERROR_CODES.NOT_FOUND);

const lifetimeMs = () => env.stories.lifetimeHours * 60 * 60 * 1000;

// ---------------------------------------------------------------- Tray cache
// Every feed visit asks for the story tray, but the set of live stories changes rarely, so it is kept in
// memory and rebuilt at most every 30 seconds (or as soon as a story is posted, deleted or expires).
// Only per-person details (seen, liked) are looked up on each request, with one indexed query.

let trayCache = null;

const invalidateTray = () => {
    trayCache = null;
};

const publicEvent = (event) =>
    event && PUBLIC_EVENT_STATUSES.includes(event.status) ? { _id: event._id, title: event.title, startAt: event.startAt, endAt: event.endAt } : null;

const toStory = (story) => ({
    _id: story._id,
    kind: story.media.kind,
    ...media.mediaUrls(story.media),
    width: story.media.width,
    height: story.media.height,
    duration: story.media.duration,
    caption: story.caption,
    event: publicEvent(story.event),
    author: String(story.author?._id || story.author),
    viewCount: story.viewCount,
    likeCount: story.likeCount,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt
});

const loadTray = async () => {
    const now = Date.now();
    if (trayCache && trayCache.validUntil > now) {
        return trayCache;
    }

    const stories = await Story.find({ expiresAt: { $gt: new Date(now) } })
        .sort({ createdAt: 1 })
        .populate("club", "name logo category status")
        .populate("event", "title startAt endAt status")
        .lean();

    const groups = new Map();
    let earliestExpiry = now + TRAY_CACHE_MS;

    stories.forEach((story) => {
        if (!story.club || story.club.status !== CLUB_STATUS.ACTIVE) {
            return;
        }
        const key = String(story.club._id);
        if (!groups.has(key)) {
            const { _id, name, logo, category } = story.club;
            groups.set(key, { club: { _id, name, logo, category }, stories: [] });
        }
        groups.get(key).stories.push(toStory(story));
        earliestExpiry = Math.min(earliestExpiry, new Date(story.expiresAt).getTime());
    });

    const list = [...groups.values()].map((group) => ({ ...group, latestAt: group.stories[group.stories.length - 1].createdAt }));
    const byId = new Map(list.flatMap((group) => group.stories.map((story) => [String(story._id), story])));
    trayCache = { groups: list, byId, validUntil: Math.max(now + 1000, earliestExpiry) };
    return trayCache;
};

// Keeps cached counters in step with views and likes between rebuilds.
const bumpCached = (storyId, field, by) => {
    const story = trayCache?.byId.get(String(storyId));
    if (story) {
        story[field] = Math.max(0, story[field] + by);
    }
};

const managedClubIds = async (user) => {
    const memberships = await ClubMembership.find({ user: user._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club role").lean();
    return new Set(memberships.filter((membership) => roleHasPermission(membership.role, MANAGE)).map((membership) => String(membership.club)));
};

// View and like counts are only for the club's story managers.
const forViewer = (story, { seen, liked, canManage }) => {
    const { viewCount, likeCount, author, ...rest } = story;
    return canManage ? { ...rest, seen, liked, viewCount, likeCount } : { ...rest, seen, liked };
};

const getTray = async (user) => {
    const { groups } = await loadTray();
    const storyIds = groups.flatMap((group) => group.stories.map((story) => story._id));

    const [views, managed] = await Promise.all([
        storyIds.length ? StoryView.find({ user: user._id, story: { $in: storyIds } }).select("story liked").lean() : [],
        managedClubIds(user)
    ]);
    const viewed = new Map(views.map((view) => [String(view.story), view]));

    const result = groups.map((group) => {
        const canManage = managed.has(String(group.club._id));
        const stories = group.stories.map((story) => {
            const view = viewed.get(String(story._id));
            return forViewer(story, { seen: Boolean(view), liked: Boolean(view?.liked), canManage });
        });
        return {
            club: group.club,
            canManage,
            latestAt: group.latestAt,
            allSeen: stories.every((story) => story.seen),
            stories
        };
    });

    // Your own clubs first (like "Your story"), then unwatched rings, newest first.
    result.sort((a, b) => Number(b.canManage) - Number(a.canManage) || Number(a.allSeen) - Number(b.allSeen) || new Date(b.latestAt) - new Date(a.latestAt));
    return result;
};

// ---------------------------------------------------------------- Posting

const assertCanPost = async (actor, clubId) => {
    const context = await assertClubPermission(actor, clubId, MANAGE, "Only club officers who post updates can add stories for this club");
    if (context.club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can post stories", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    const active = await Story.countDocuments({ club: context.club._id, expiresAt: { $gt: new Date() } });
    if (active >= env.stories.maxActivePerClub) {
        throw new AppError(`A club can have up to ${env.stories.maxActivePerClub} live stories. Delete one or wait for older ones to expire.`, 409, ERROR_CODES.CONFLICT);
    }
    return context;
};

const createUploadTicket = async (actor, { club: clubId, kind }) => {
    if (!Object.values(media.KINDS).includes(kind)) {
        throw new AppError("Choose a photo or a video", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const { club } = await assertCanPost(actor, clubId);
    return media.createUploadTicket(String(club._id), String(actor._id), kind);
};

// Development storage only: with Cloudinary configured the browser uploads straight to Cloudinary.
const uploadLocalMedia = async (actor, clubId, file) => {
    if (media.providerName() !== "local") {
        throw new AppError("Story media is uploaded directly to cloud storage", 400, ERROR_CODES.UPLOAD_ERROR);
    }
    const { club } = await assertCanPost(actor, clubId);
    return { provider: "local", ...(await media.saveLocalFile(file, String(club._id), String(actor._id))) };
};

const findClubEvent = async (eventId, clubId) => {
    const event = await Event.findById(eventId).select("club title poster status startAt endAt");
    if (!event || String(event.club) !== String(clubId) || !PUBLIC_EVENT_STATUSES.includes(event.status)) {
        throw new AppError("Link a published event of this club", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    return event;
};

const createStory = async (actor, payload) => {
    const { club: clubId, caption = "", event: eventId = null } = payload;
    const { club } = await assertCanPost(actor, clubId);

    const event = eventId ? await findClubEvent(eventId, club._id) : null;

    let storedMedia;
    if (payload.media?.provider === "event") {
        // Sharing an event's poster: reuses the file the event already has, nothing new is uploaded.
        if (!event?.poster) {
            throw new AppError("That event has no poster to share", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        storedMedia = { kind: media.KINDS.IMAGE, provider: "event", key: event.poster };
    } else {
        storedMedia = media.verifyUpload(payload.media, String(club._id), String(actor._id));
    }

    let story;
    try {
        story = await Story.create({
            club: club._id,
            author: actor._id,
            media: storedMedia,
            caption: String(caption || "").trim().slice(0, 200),
            event: event?._id || null,
            expiresAt: new Date(Date.now() + lifetimeMs())
        });
    } catch (error) {
        await media.deleteMediaQuietly(storedMedia);
        throw error;
    }

    invalidateTray();
    await recordAudit({
        action: AUDIT_ACTIONS.STORY_POSTED,
        actor: actor._id,
        targetType: "Story",
        targetId: story._id,
        metadata: { clubId: club._id, kind: storedMedia.kind, provider: storedMedia.provider }
    });

    const created = toStory({ ...story.toObject(), event: event ? event.toObject() : null });
    return { ...forViewer(created, { seen: false, liked: false, canManage: true }), club: { _id: club._id, name: club.name, logo: club.logo } };
};

// ---------------------------------------------------------------- Watching

const findLiveStory = async (storyId) => {
    const story = await Story.findOne({ _id: storyId, expiresAt: { $gt: new Date() } }).select("club author viewCount likeCount").lean();
    if (!story) {
        throw notFound();
    }
    return story;
};

const isAuthor = (story, user) => String(story.author) === String(user._id);

// Records that the person watched the story. The author's own views are kept (so their ring shows as
// seen) but never counted or listed.
const recordView = async (user, storyId) => {
    const story = await findLiveStory(storyId);
    let inserted = false;
    try {
        const result = await StoryView.updateOne({ story: story._id, user: user._id }, { $setOnInsert: { viewedAt: new Date() } }, { upsert: true });
        inserted = result.upsertedCount > 0;
    } catch (error) {
        // Two tabs recording the same view at once: the other one won, which is fine.
        if (error.code !== 11000) {
            throw error;
        }
    }

    if (inserted && !isAuthor(story, user)) {
        await Story.updateOne({ _id: story._id }, { $inc: { viewCount: 1 } });
        bumpCached(story._id, "viewCount", 1);
    }
    return { story, seen: true };
};

const setLiked = async (user, storyId, liked) => {
    const { story } = await recordView(user, storyId);
    if (isAuthor(story, user)) {
        throw new AppError("You can't like your own club's story", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const want = Boolean(liked);
    const changed = await StoryView.updateOne({ story: story._id, user: user._id, liked: { $ne: want } }, { $set: { liked: want, likedAt: want ? new Date() : null } });
    if (changed.modifiedCount) {
        await Story.updateOne({ _id: story._id, ...(want ? {} : { likeCount: { $gt: 0 } }) }, { $inc: { likeCount: want ? 1 : -1 } });
        bumpCached(story._id, "likeCount", want ? 1 : -1);
    }
    return { liked: want };
};

const listViewers = async (actor, storyId, query = {}) => {
    const story = await findLiveStory(storyId);
    await assertClubPermission(actor, story.club, MANAGE, "Only the club's story managers can see who viewed this story");

    const pagination = parsePagination(query, { defaultLimit: 50, maxLimit: 100 });
    const filter = { story: story._id, user: { $ne: story.author } };
    const [views, total] = await Promise.all([
        StoryView.find(filter)
            .sort({ viewedAt: -1 })
            .skip(pagination.skip)
            .limit(pagination.limit)
            .populate("user", "name departmentCode batchCode accountType")
            .lean(),
        StoryView.countDocuments(filter)
    ]);

    return {
        items: views.filter((view) => view.user).map((view) => ({ user: view.user, viewedAt: view.viewedAt, liked: view.liked })),
        meta: { ...paginationMeta(pagination, total), viewCount: story.viewCount, likeCount: story.likeCount }
    };
};

// ---------------------------------------------------------------- Removal and expiry

const removeStoryRecord = async (story) => {
    await StoryView.deleteMany({ story: story._id });
    await Story.deleteOne({ _id: story._id });
};

const deleteStory = async (actor, storyId) => {
    const story = await Story.findById(storyId);
    if (!story) {
        throw notFound();
    }
    await assertClubPermission(actor, story.club, MANAGE, "Only the club's story managers can delete this story");

    if (await media.deleteMediaQuietly(story.media)) {
        await removeStoryRecord(story);
    } else {
        // Hide it now; the sweeper retries removing the file from storage.
        await Story.updateOne({ _id: story._id }, { $set: { expiresAt: new Date() } });
    }
    invalidateTray();

    await recordAudit({
        action: AUDIT_ACTIONS.STORY_DELETED,
        actor: actor._id,
        targetType: "Story",
        targetId: story._id,
        metadata: { clubId: story.club }
    });
};

// Deletes expired stories: first the file in storage, then the story and its views.
const sweepExpiredStories = async ({ now = new Date() } = {}) => {
    const expired = await Story.find({ expiresAt: { $lte: now } }).limit(SWEEP_BATCH);
    let removed = 0;

    for (const story of expired) {
        const cleaned = await media.deleteMediaQuietly(story.media);
        if (cleaned || story.cleanupAttempts + 1 >= MAX_CLEANUP_ATTEMPTS) {
            if (!cleaned) {
                logger.error("Giving up on story media cleanup", { storyId: String(story._id), key: story.media.key });
            }
            await removeStoryRecord(story);
            removed += 1;
        } else {
            await Story.updateOne({ _id: story._id }, { $inc: { cleanupAttempts: 1 } });
        }
    }

    if (expired.length) {
        invalidateTray();
    }
    return { removed, pending: expired.length - removed };
};

let sweeper = null;
let sweeping = false;

const startStorySweeper = () => {
    if (sweeper || env.isTest) {
        return;
    }
    const run = async () => {
        if (sweeping) {
            return;
        }
        sweeping = true;
        try {
            const { removed } = await sweepExpiredStories();
            if (removed) {
                logger.info(`Removed ${removed} expired stor${removed === 1 ? "y" : "ies"}`);
            }
        } catch (error) {
            logger.error("Story sweep failed", { message: error.message });
        } finally {
            sweeping = false;
        }
    };
    run();
    sweeper = setInterval(run, SWEEP_EVERY_MS);
    sweeper.unref();
};

module.exports = {
    getTray,
    createUploadTicket,
    uploadLocalMedia,
    createStory,
    recordView,
    setLiked,
    listViewers,
    deleteStory,
    sweepExpiredStories,
    startStorySweeper,
    invalidateTray
};
