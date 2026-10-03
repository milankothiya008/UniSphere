const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");
const { env } = require("../config/env");

// Web Push: notifications on phones and laptops, even when CampusConnect isn't open. Free — the browser
// makers (Google, Mozilla, Apple) deliver them. Needs VAPID keys (npx web-push generate-vapid-keys); without
// them push is simply off and everything else works as before.

const CONCURRENCY = 20;
const MAX_FAILURES = 5;
let configured = false;

const isEnabled = () => {
    if (configured) return true;
    if (!env.push.publicKey || !env.push.privateKey) return false;
    webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
    configured = true;
    return true;
};

const publicKey = () => (isEnabled() ? env.push.publicKey : null);

const subscribe = async (actor, subscription = {}, userAgent = "") => {
    if (!isEnabled()) throw new AppError("Push notifications aren't set up on this server", 503, ERROR_CODES.INVALID_STATE);
    const endpoint = String(subscription.endpoint || "");
    const keys = subscription.keys || {};
    if (!/^https:\/\//.test(endpoint) || !keys.p256dh || !keys.auth) {
        throw new AppError("This browser sent an invalid push subscription", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    // An endpoint belongs to one browser; if another account used it before, it moves to this one.
    await PushSubscription.findOneAndUpdate(
        { endpoint },
        { $set: { user: actor._id, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) }, userAgent: String(userAgent || "").slice(0, 300), failures: 0 } },
        { upsert: true }
    );
    return { subscribed: true };
};

const unsubscribe = async (actor, endpoint) => {
    await PushSubscription.deleteOne({ endpoint: String(endpoint || ""), user: actor._id });
    return { subscribed: false };
};

const sendOne = async (subscription, payload) => {
    try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, { TTL: 24 * 60 * 60, urgency: "normal" });
        await PushSubscription.updateOne({ _id: subscription._id }, { $set: { lastSuccessAt: new Date(), failures: 0 } });
        return true;
    } catch (error) {
        // 404/410: the browser dropped the subscription (app uninstalled, permission revoked).
        if (error.statusCode === 404 || error.statusCode === 410 || subscription.failures + 1 >= MAX_FAILURES) {
            await PushSubscription.deleteOne({ _id: subscription._id });
        } else {
            await PushSubscription.updateOne({ _id: subscription._id }, { $inc: { failures: 1 } });
        }
        return false;
    }
};

/**
 * Pushes one notification to every device of these users. Runs in the background: callers never wait for
 * the browser vendors, and a failure never affects the action that caused the notification.
 */
const pushToUsers = (userIds, { title, body = "", url = "/activity", tag = null, icon = null, kind = null, conversationId = null }) => {
    if (!isEnabled() || !userIds?.length) return;
    setImmediate(async () => {
        try {
            const subscriptions = await PushSubscription.find({ user: { $in: userIds } }).lean();
            const payload = JSON.stringify({ title, body: String(body || "").slice(0, 240), url: url || "/activity", tag, icon, kind, conversationId });
            for (let i = 0; i < subscriptions.length; i += CONCURRENCY) {
                await Promise.all(subscriptions.slice(i, i + CONCURRENCY).map((subscription) => sendOne(subscription, payload)));
            }
        } catch (error) {
            logger.error("Push delivery failed", { message: error.message });
        }
    });
};

module.exports = { publicKey, subscribe, unsubscribe, pushToUsers, isEnabled };
