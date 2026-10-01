const Notification = require("../models/Notification");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");
const { parsePagination, paginationMeta } = require("../utils/Query");
const Club = require("../models/Club");
const { composeEmail } = require("./EmailComposer");
const { enqueueEmails } = require("./EmailQueueService");
const { turnOffForUser } = require("./SubscriptionService");
const { readUnsubscribeToken } = require("../utils/UnsubscribeToken");
const { EMAIL_CATEGORIES, EMAIL_PREFERENCES, OPTIONAL_EMAIL_CATEGORIES } = require("../constants/EmailCategories");

// Queues one personal email per recipient. Inactive or unverified accounts, and anyone who switched
// the category off in their email settings, are skipped. compose(user) returns the EmailComposer options
// for that person; dedupeKey(user) (optional) stops the same email reaching someone twice.
const emailUsers = async (userIds, { category, compose, dedupeKey = null, exclude = [] }) => {
    const excluded = new Set(uniqueIds(exclude));
    const recipients = uniqueIds(userIds).filter((id) => !excluded.has(id));

    if (!recipients.length) {
        return 0;
    }

    try {
        const filter = { _id: { $in: recipients }, isActive: true, isEmailVerified: true };
        if (OPTIONAL_EMAIL_CATEGORIES.includes(category)) {
            filter[`emailPreferences.${category}`] = { $ne: false };
        }

        const users = await User.find(filter).select("name email").lean();
        const jobs = users.map((user) => ({
            ...composeEmail(user, { category, ...compose(user) }),
            dedupeKey: dedupeKey ? dedupeKey(user) : undefined
        }));
        return await enqueueEmails(jobs);
    } catch (error) {
        logger.error("Failed to queue emails", { category, message: error.message });
        return 0;
    }
};


const uniqueIds = (ids) => [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((id) => String(id._id || id)))];

// Notifications are a side effect of a state change; a failure here must never undo the change itself.
// email: true also queues an email; emailCategory decides whether the person's email settings can mute it.
const notify = async (userIds, { type, title, message = "", link = null, email = false, emailCategory = EMAIL_CATEGORIES.ACCOUNT, exclude = [] }) => {
    const excluded = uniqueIds(exclude);
    const recipients = uniqueIds(userIds).filter((id) => !excluded.includes(id));

    if (!recipients.length) {
        return;
    }

    try {
        await Notification.insertMany(
            recipients.map((user) => ({ user, type, title, message, link }))
        );

        if (email) {
            await emailUsers(recipients, {
                category: emailCategory,
                compose: () => ({
                    subject: title,
                    heading: title,
                    paragraphs: message ? [message] : [],
                    action: link ? { label: "Open in CampusConnect", url: link } : null
                })
            });
        }
    } catch (error) {
        logger.error("Failed to create notifications", { type, message: error.message });
    }
};

const BROADCAST_BATCH = 1000;

// Campus-wide activity (new events, announcements, results, new clubs) reaches every active user in-app.
// Deliberately no email: mailing the whole university would be spam and exceed SMTP sending limits.
const notifyAllUsers = async ({ type, title, message = "", link = null, exclude = [] }) => {
    const excluded = new Set(uniqueIds(exclude));

    try {
        const users = await User.find({ isActive: true, isEmailVerified: true }).select("_id").lean();
        const recipients = users.map((user) => String(user._id)).filter((id) => !excluded.has(id));

        for (let i = 0; i < recipients.length; i += BROADCAST_BATCH) {
            await Notification.insertMany(
                recipients.slice(i, i + BROADCAST_BATCH).map((user) => ({ user, type, title, message, link })),
                { ordered: false }
            );
        }
    } catch (error) {
        logger.error("Failed to broadcast notifications", { type, message: error.message });
    }
};

const listNotifications = async (user, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 20 });
    const filter = { user: user._id };

    if (query.unread === "true") {
        filter.readAt = null;
    }

    const [items, total, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
        Notification.countDocuments(filter),
        Notification.countDocuments({ user: user._id, readAt: null })
    ]);

    return { items, unread, ...paginationMeta(pagination, total) };
};

const unreadCount = async (user) => Notification.countDocuments({ user: user._id, readAt: null });

// The kinds shown in the Activity bubble (like Instagram's likes / comments / follows counts).
const KIND_OF = {
    recruitment: ["RECRUITMENT_REVIEW", "RECRUITMENT_UPDATE", "RECRUITMENT_OPEN", "APPLICATION_UPDATE", "INTERVIEW_SCHEDULED", "INTERVIEW_REMINDER", "RECRUITMENT_OFFER"],
    clubs: ["CLUB_REQUEST_UPDATE", "CLUB_UPDATE", "MEMBERSHIP_REQUEST", "MEMBERSHIP_APPROVED", "MEMBERSHIP_REJECTED", "CLUB_ROLE_CHANGED", "ANNOUNCEMENT", "NEW_CLUB", "GALLERY_SUBMITTED", "GALLERY_APPROVED", "GALLERY_REJECTED"]
};
const kindOf = (type) => Object.keys(KIND_OF).find((kind) => KIND_OF[kind].includes(type)) || "events";

/** Unread notifications: the total, plus how many are about events, clubs and recruitment. */
const unreadSummary = async (user) => {
    const rows = await Notification.aggregate([{ $match: { user: user._id, readAt: null } }, { $group: { _id: "$type", count: { $sum: 1 } } }]);
    const kinds = { events: 0, clubs: 0, recruitment: 0 };
    rows.forEach((row) => {
        kinds[kindOf(row._id)] += row.count;
    });
    return { count: rows.reduce((sum, row) => sum + row.count, 0), kinds };
};

const markRead = async (user, id) => {
    const notification = await Notification.findOneAndUpdate(
        { _id: id, user: user._id },
        { $set: { readAt: new Date() } },
        { returnDocument: "after" }
    );

    if (!notification) {
        throw new AppError("Notification not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return notification;
};

const markAllRead = async (user) => {
    const result = await Notification.updateMany({ user: user._id, readAt: null }, { $set: { readAt: new Date() } });
    return { updated: result.modifiedCount };
};

const preferencesOf = (user) =>
    Object.fromEntries(OPTIONAL_EMAIL_CATEGORIES.map((key) => [key, user.emailPreferences?.[key] !== false]));

const getEmailPreferences = async (actor) => {
    const user = await User.findById(actor._id).select("emailPreferences");
    return {
        preferences: preferencesOf(user),
        categories: EMAIL_PREFERENCES
    };
};

const updateEmailPreferences = async (actor, changes = {}) => {
    const update = {};
    OPTIONAL_EMAIL_CATEGORIES.forEach((key) => {
        if (changes[key] !== undefined) {
            update[`emailPreferences.${key}`] = Boolean(changes[key]);
        }
    });

    if (!Object.keys(update).length) {
        throw new AppError("Nothing to update", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    await User.updateOne({ _id: actor._id }, { $set: update });
    return getEmailPreferences(actor);
};

// The unsubscribe page is public, so it only hints at which address the link belongs to.
const maskEmail = (email) => String(email).replace(/^(.{2})[^@]*(@.*)$/, "$1***$2");

const readToken = (token) => {
    const parsed = readUnsubscribeToken(token);
    const valid =
        parsed && (parsed.scope === "club" ? /^[a-f0-9]{24}$/i.test(parsed.key) : OPTIONAL_EMAIL_CATEGORIES.includes(parsed.key));

    if (!valid) {
        throw new AppError("This unsubscribe link is invalid or has been changed", 400, ERROR_CODES.TOKEN_INVALID);
    }
    return parsed;
};

const describeUnsubscribe = async (token) => {
    const { userId, scope, key } = readToken(token);
    const user = await User.findById(userId).select("email");
    if (!user) {
        throw new AppError("This unsubscribe link is invalid", 400, ERROR_CODES.TOKEN_INVALID);
    }

    if (scope === "club") {
        const club = await Club.findById(key).select("name");
        return { scope, email: maskEmail(user.email), label: `Emails from ${club?.name || "this club"}`, clubId: key };
    }

    const preference = EMAIL_PREFERENCES.find((item) => item.key === key);
    return { scope, email: maskEmail(user.email), label: preference.label, description: preference.description, category: key };
};

// Works without signing in, from the email link or the mail app's one-click unsubscribe button.
const unsubscribe = async (token) => {
    const { userId, scope, key } = readToken(token);
    const summary = await describeUnsubscribe(token);

    if (scope === "club") {
        await turnOffForUser(userId, key);
    } else {
        await User.updateOne({ _id: userId }, { $set: { [`emailPreferences.${key}`]: false } });
    }

    return { ...summary, unsubscribed: true };
};

module.exports = {
    notify,
    notifyAllUsers,
    emailUsers,
    listNotifications,
    unreadCount,
    unreadSummary,
    markRead,
    markAllRead,
    getEmailPreferences,
    updateEmailPreferences,
    describeUnsubscribe,
    unsubscribe
};

