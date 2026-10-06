const express = require("express");
const { listFeed, createPost, deletePost } = require("../controllers/FeedController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { mongoIdParam, feedPostRules, audienceRules } = require("../validators/RequestValidators");
const { body } = require("express-validator");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");
const feedService = require("../services/FeedService");
const { query } = require("express-validator");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/", query("club").optional().isMongoId(), query("event").optional().isMongoId(), validate, listFeed);
router.post("/", feedPostRules, validate, createPost);
// How many people an announcement would reach, before sending it.
router.post(
    "/audience-preview",
    body("club").isMongoId().withMessage("Club is required"),
    ...audienceRules,
    validate,
    asyncHandler(async (req, res) => sendSuccess(res, 200, "OK", await feedService.previewAudience(req.user, req.body)))
);
router.delete("/:id", mongoIdParam("id"), validate, deletePost);

module.exports = router;
