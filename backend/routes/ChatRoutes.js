const express = require("express");
const { body, param, query } = require("express-validator");
const chat = require("../services/ChatService");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");
const { singleChatFile } = require("../middleware/Upload");
const { uploadLimiter } = require("../middleware/RateLimiter");

// Chats (see services/ChatService). Live updates arrive over Socket.IO; these are the reads and writes.
const router = express.Router();
router.use(protect, requireVerified);

const ok = (handler, message = "OK") => asyncHandler(async (req, res) => sendSuccess(res, 200, message, await handler(req)));
const id = (name = "id") => param(name).isMongoId().withMessage("Invalid id");

// Chat list, unread badge, people search, settings
router.get("/conversations", query("filter").optional().isIn(["all", "unread", "groups", "clubs", "direct"]), validate, ok((req) => chat.listConversations(req.user, { filter: req.query.filter })));
router.get("/unread", ok((req) => chat.unreadSummary(req.user)));
router.get("/people", query("q").optional().isString().isLength({ max: 80 }), validate, ok((req) => chat.searchPeople(req.user, req.query.q)));
router.get("/settings", ok((req) => chat.getSettings(req.user)));
router.put("/settings", body("showActivityStatus").optional().isBoolean(), validate, ok((req) => chat.updateSettings(req.user, req.body)));
router.get("/blocks", ok((req) => chat.listBlocked(req.user)));
router.put("/blocks/:userId", id("userId"), body("blocked").isBoolean(), validate, ok((req) => chat.setBlocked(req.user, req.params.userId, req.body.blocked)));

// Starting chats
router.post("/direct", body("userId").isMongoId().withMessage("Choose someone"), validate, ok((req) => chat.openDirect(req.user, req.body.userId)));
router.post(
    "/groups",
    body("name").isString().trim().isLength({ min: 1, max: 80 }).withMessage("Name the group"),
    body("members").isArray({ min: 1, max: 255 }).withMessage("Add people to the group"),
    body("members.*").isMongoId(),
    validate,
    ok((req) => chat.createGroup(req.user, req.body))
);

// One conversation
router.get("/conversations/:id", id(), validate, ok((req) => chat.getConversation(req.user, req.params.id)));
router.patch(
    "/conversations/:id",
    id(),
    body("name").optional().isString().isLength({ max: 80 }),
    body("description").optional().isString().isLength({ max: 500 }),
    body("announceOnly").optional().isBoolean(),
    validate,
    ok((req) => chat.updateConversation(req.user, req.params.id, req.body))
);
router.get("/conversations/:id/messages", id(), query("before").optional().isMongoId(), validate, ok((req) => chat.listMessages(req.user, req.params.id, req.query)));
router.post(
    "/conversations/:id/messages",
    id(),
    body("text").optional().isString().isLength({ max: 4000 }).withMessage("Messages can be up to 4000 characters"),
    body("attachments").optional().isArray({ max: 10 }).withMessage("Up to 10 files at a time"),
    body("replyTo").optional({ values: "null" }).isMongoId(),
    body("clientId").optional().isString().isLength({ max: 64 }),
    validate,
    ok((req) => chat.sendMessage(req.user, req.params.id, req.body), "Sent")
);
router.post("/conversations/:id/read", id(), validate, ok((req) => chat.markRead(req.user, req.params.id)));
router.put("/conversations/:id/mute", id(), body("duration").optional({ values: "null" }).isIn(["8h", "1w", "always"]), validate, ok((req) => chat.mute(req.user, req.params.id, req.body.duration)));
router.post("/conversations/:id/clear", id(), validate, ok((req) => chat.clearChat(req.user, req.params.id)));
router.post("/conversations/:id/leave", id(), validate, ok((req) => chat.leaveGroup(req.user, req.params.id)));
router.post("/conversations/:id/members", id(), body("userIds").isArray({ min: 1, max: 100 }), body("userIds.*").isMongoId(), validate, ok((req) => chat.addMembers(req.user, req.params.id, req.body.userIds)));
router.delete("/conversations/:id/members/:userId", id(), id("userId"), validate, ok((req) => chat.removeMember(req.user, req.params.id, req.params.userId)));
router.put("/conversations/:id/members/:userId/admin", id(), id("userId"), body("admin").isBoolean(), validate, ok((req) => chat.setAdmin(req.user, req.params.id, req.params.userId, req.body.admin)));
router.put("/conversations/:id/pins/:messageId", id(), id("messageId"), body("pinned").isBoolean(), validate, ok((req) => chat.setPinned(req.user, req.params.id, req.params.messageId, req.body.pinned)));
router.get("/conversations/:id/shared", id(), query("kind").optional().isIn(["media", "links", "docs"]), validate, ok((req) => chat.sharedItems(req.user, req.params.id, req.query.kind)));

// Uploads: a signed ticket for Cloudinary (or the local endpoint in development), then attach on send.
router.post(
    "/conversations/:id/uploads",
    uploadLimiter,
    id(),
    body("kind").isIn(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]).withMessage("Unsupported file"),
    body("ext").optional().isString().isLength({ max: 5 }),
    validate,
    ok((req) => chat.uploadTicket(req.user, req.params.id, req.body))
);
router.post(
    "/media",
    uploadLimiter,
    query("conversation").isMongoId(),
    query("kind").optional().isIn(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]),
    query("ext").optional().isAlphanumeric().isLength({ max: 5 }),
    validate,
    singleChatFile("file"),
    ok((req) => chat.uploadLocal(req.user, req.query.conversation, req.file, { kind: req.query.kind, ext: req.query.ext }))
);

// One message
router.patch("/messages/:messageId", id("messageId"), body("text").isString().isLength({ max: 4000 }), validate, ok((req) => chat.editMessage(req.user, req.params.messageId, req.body.text)));
router.delete("/messages/:messageId", id("messageId"), query("for").optional().isIn(["me", "everyone"]), validate, ok((req) => chat.deleteMessage(req.user, req.params.messageId, req.query.for)));
router.put("/messages/:messageId/reaction", id("messageId"), body("emoji").optional({ values: "null" }).isString().isLength({ max: 32 }), validate, ok((req) => chat.react(req.user, req.params.messageId, req.body.emoji)));
router.post("/messages/:messageId/forward", id("messageId"), body("conversationIds").isArray({ min: 1, max: 5 }), body("conversationIds.*").isMongoId(), validate, ok((req) => chat.forward(req.user, req.params.messageId, req.body.conversationIds)));
router.post("/messages/:messageId/report", id("messageId"), body("reason").optional().isString().isLength({ max: 500 }), validate, ok((req) => chat.report(req.user, req.params.messageId, req.body.reason)));

// University admin: reported messages
router.get("/reports", query("status").optional().isIn(["OPEN", "RESOLVED", "ALL"]), validate, ok((req) => chat.listReports(req.user, req.query)));
router.put("/reports/:reportId", id("reportId"), body("note").optional().isString().isLength({ max: 500 }), validate, ok((req) => chat.resolveReport(req.user, req.params.reportId, req.body)));

module.exports = router;
