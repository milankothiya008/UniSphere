const notificationService = require("../services/NotificationService");
const subscriptionService = require("../services/SubscriptionService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const list = asyncHandler(async (req, res) => {
    const { items, ...meta } = await notificationService.listNotifications(req.user, req.query);
    sendSuccess(res, 200, "Notifications fetched", items, { meta });
});

const unreadCount = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Unread count fetched", await notificationService.unreadSummary(req.user));
});

const markRead = asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(req.user, req.params.id);
    sendSuccess(res, 200, "Notification marked as read", notification);
});

const markAllRead = asyncHandler(async (req, res) => {
    const result = await notificationService.markAllRead(req.user);
    sendSuccess(res, 200, "All notifications marked as read", result);
});

const getPreferences = asyncHandler(async (req, res) => {
    const result = await notificationService.getEmailPreferences(req.user);
    sendSuccess(res, 200, "Email preferences fetched", result);
});

const updatePreferences = asyncHandler(async (req, res) => {
    const result = await notificationService.updateEmailPreferences(req.user, req.body);
    sendSuccess(res, 200, "Email preferences saved", result);
});

const mySubscriptions = asyncHandler(async (req, res) => {
    const clubs = await subscriptionService.listMySubscriptions(req.user);
    sendSuccess(res, 200, "Club notifications fetched", clubs);
});

const describeUnsubscribe = asyncHandler(async (req, res) => {
    const result = await notificationService.describeUnsubscribe(req.query.token);
    sendSuccess(res, 200, "Unsubscribe link checked", result);
});

// The token may come in the body (our page) or the query string (mail apps' one-click POST, RFC 8058).
const unsubscribe = asyncHandler(async (req, res) => {
    const result = await notificationService.unsubscribe(req.body?.token || req.query.token);
    sendSuccess(res, 200, "You have been unsubscribed", result);
});

module.exports = { list, unreadCount, markRead, markAllRead, getPreferences, updatePreferences, mySubscriptions, describeUnsubscribe, unsubscribe };
