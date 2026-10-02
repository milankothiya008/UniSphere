const express = require("express");
const { body, param } = require("express-validator");
const likes = require("../services/LikeService");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const router = express.Router();
const target = [param("type").isIn(["event", "media", "EVENT", "MEDIA"]).withMessage("Unknown item"), param("id").isMongoId()];

router.use(protect, requireVerified);
// Like or unlike: { liked: true | false }.
router.put("/:type/:id", ...target, body("liked").isBoolean(), validate, asyncHandler(async (req, res) => sendSuccess(res, 200, "Saved", await likes.setLiked(req.user, req.params.type, req.params.id, req.body.liked))));
// Who liked it (for the people the post belongs to).
router.get("/:type/:id", ...target, validate, asyncHandler(async (req, res) => sendSuccess(res, 200, "Likes", await likes.listLikers(req.user, req.params.type, req.params.id))));

module.exports = router;
