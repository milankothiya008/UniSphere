const express = require("express");
const { query } = require("express-validator");
const controller = require("../controllers/GalleryController");
const { optionalAuth } = require("../middleware/Auth");
const validate = require("../middleware/Validate");

const router = express.Router();

// The Gallery section: events and their photo/video counts. Each event's own gallery lives under /api/events/:id/gallery.
router.get(
    "/",
    optionalAuth,
    query("show").optional().isIn(["all", "photos", "review"]),
    query("club").optional().isMongoId(),
    query("search").optional().isString().isLength({ max: 100 }),
    validate,
    controller.listEvents
);

module.exports = router;
