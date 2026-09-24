const express = require("express");
const {
    list,
    unreadCount,
    markRead,
    markAllRead,
    getPreferences,
    updatePreferences,
    mySubscriptions,
    describeUnsubscribe,
    unsubscribe
} = require("../controllers/NotificationController");
const { authLimiter } = require("../middleware/RateLimiter");
const { protect } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { mongoIdParam, emailPreferenceRules, unsubscribeRules } = require("../validators/RequestValidators");

const router = express.Router();

// Unsubscribe links work without signing in, like every mailing list.
router.get("/unsubscribe", authLimiter, unsubscribeRules, validate, describeUnsubscribe);
router.post("/unsubscribe", authLimiter, express.urlencoded({ extended: false }), unsubscribeRules, validate, unsubscribe);

router.use(protect);

router.get("/preferences", getPreferences);
router.put("/preferences", emailPreferenceRules, validate, updatePreferences);
router.get("/subscriptions", mySubscriptions);

router.get("/", list);
router.get("/unread-count", unreadCount);
router.post("/read-all", markAllRead);
router.patch("/:id/read", mongoIdParam("id"), validate, markRead);

module.exports = router;
