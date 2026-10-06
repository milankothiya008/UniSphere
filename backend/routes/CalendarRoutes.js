const express = require("express");
const calendar = require("../services/CalendarService");
const { protect, requireVerified } = require("../middleware/Auth");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

// Calendar files (see services/CalendarService). The .ics addresses are opened by calendar apps, which
// can't sign in: one event is public anyway, and the personal feed is protected by its private token.
const router = express.Router();

const sendIcs = (res, body, filename = null) => {
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    if (filename) res.set("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    res.send(body);
};

router.get(
    "/events/:file",
    asyncHandler(async (req, res) => {
        const { filename, body } = await calendar.eventCalendar(String(req.params.file).replace(/\.ics$/i, ""));
        sendIcs(res, body, filename);
    })
);
router.get(
    "/feed/:token",
    asyncHandler(async (req, res) => sendIcs(res, await calendar.feedCalendar(req.params.token)))
);

router.get(
    "/link",
    protect,
    requireVerified,
    asyncHandler(async (req, res) => sendSuccess(res, 200, "OK", await calendar.getFeedLink(req.user)))
);
router.post(
    "/link/reset",
    protect,
    requireVerified,
    asyncHandler(async (req, res) => sendSuccess(res, 200, "Calendar link reset", await calendar.resetFeedLink(req.user)))
);

module.exports = router;
