const express = require("express");
const { body } = require("express-validator");
const push = require("../services/PushService");
const { protect } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const router = express.Router();

// The public VAPID key browsers need to subscribe (null when push is switched off on the server).
router.get("/public-key", (req, res) => sendSuccess(res, 200, "Push key", { publicKey: push.publicKey() }));
router.post(
    "/subscribe",
    protect,
    body("endpoint").isString().isLength({ min: 10, max: 1000 }),
    body("keys.p256dh").isString().isLength({ max: 200 }),
    body("keys.auth").isString().isLength({ max: 100 }),
    validate,
    asyncHandler(async (req, res) => sendSuccess(res, 200, "Push notifications on", await push.subscribe(req.user, req.body, req.get("user-agent"))))
);
router.post(
    "/unsubscribe",
    protect,
    body("endpoint").isString().isLength({ max: 1000 }),
    validate,
    asyncHandler(async (req, res) => sendSuccess(res, 200, "Push notifications off", await push.unsubscribe(req.user, req.body.endpoint)))
);

module.exports = router;
