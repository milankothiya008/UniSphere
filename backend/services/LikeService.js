const Event = require("../models/Event");
const EventMedia = require("../models/EventMedia");
const Like = require("../models/Like");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { PUBLIC_EVENT_STATUSES, GALLERY_STATUS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { getClubContext, contextHas } = require("./AuthorizationService");

// Likes (♥) on event posts and gallery photos/videos, like Instagram. Club stories have their own likes
// (StoryView.liked). Each item keeps a likeCount; who liked is visible to the people the item belongs to.

const TYPES = {
    EVENT: {
        model: Event,
        load: (id) => Event.findById(id).select("club status likeCount"),
        visible: (item) => PUBLIC_EVENT_STATUSES.includes(item.status),
        // The club's event organisers and the mentor see who liked an event.
        canSeeLikers: async (actor, item) => {
            const context = await getClubContext(actor, item.club);
            return context.isMentor || contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS);
        }
    },
    MEDIA: {
        model: EventMedia,
        load: (id) => EventMedia.findById(id).select("club uploader status likeCount"),
        visible: (item) => item.status === GALLERY_STATUS.APPROVED,
        // The person who posted it and the gallery moderators.
        canSeeLikers: async (actor, item) => {
            if (String(item.uploader) === String(actor._id)) return true;
            return contextHas(await getClubContext(actor, item.club), CLUB_PERMISSIONS.MODERATE_GALLERY);
        }
    }
};

const kindOf = (type) => {
    const kind = TYPES[String(type || "").toUpperCase()];
    if (!kind) throw new AppError("Unknown item", 400, ERROR_CODES.VALIDATION_ERROR);
    return kind;
};

const loadVisible = async (type, id) => {
    const item = await kindOf(type).load(id);
    if (!item || !kindOf(type).visible(item)) throw new AppError("Post not found", 404, ERROR_CODES.NOT_FOUND);
    return item;
};

/** Likes or unlikes. The count changes only when the like really changes, so double taps never double-count. */
const setLiked = async (actor, type, id, liked) => {
    const key = String(type).toUpperCase();
    const item = await loadVisible(key, id);
    const { model } = kindOf(key);
    if (liked) {
        const result = await Like.updateOne({ targetType: key, target: item._id, user: actor._id }, { $setOnInsert: { targetType: key, target: item._id, user: actor._id } }, { upsert: true });
        if (result.upsertedCount) await model.updateOne({ _id: item._id }, { $inc: { likeCount: 1 } });
    } else {
        const result = await Like.deleteOne({ targetType: key, target: item._id, user: actor._id });
        if (result.deletedCount) await model.updateOne({ _id: item._id, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
    }
    const fresh = await model.findById(item._id).select("likeCount").lean();
    return { liked: Boolean(liked), likeCount: fresh?.likeCount || 0 };
};

/** Who liked it, newest first — for the people the item belongs to. */
const listLikers = async (actor, type, id) => {
    const key = String(type).toUpperCase();
    const item = await loadVisible(key, id);
    if (!(await kindOf(key).canSeeLikers(actor, item))) throw new AppError("Only the organisers can see who liked this", 403, ERROR_CODES.FORBIDDEN);
    const likes = await Like.find({ targetType: key, target: item._id }).sort({ createdAt: -1 }).limit(200).lean();
    const users = new Map((await User.find({ _id: { $in: likes.map((like) => like.user) } }).select("name avatar departmentCode batchCode accountType").lean()).map((user) => [String(user._id), user]));
    return { likeCount: item.likeCount, items: likes.map((like) => ({ user: users.get(String(like.user)) || null, at: like.createdAt })).filter((row) => row.user) };
};

/** Which of these items the user has liked (ids as strings). */
const likedAmong = async (user, type, ids) => {
    if (!user || !ids.length) return new Set();
    const rows = await Like.find({ targetType: type, user: user._id, target: { $in: ids } }).select("target").lean();
    return new Set(rows.map((row) => String(row.target)));
};

module.exports = { setLiked, listLikers, likedAmong };
