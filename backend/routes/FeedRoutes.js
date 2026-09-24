const express = require("express");
const { listFeed, createPost, deletePost } = require("../controllers/FeedController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { mongoIdParam, feedPostRules } = require("../validators/RequestValidators");
const { query } = require("express-validator");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/", query("club").optional().isMongoId(), query("event").optional().isMongoId(), validate, listFeed);
router.post("/", feedPostRules, validate, createPost);
router.delete("/:id", mongoIdParam("id"), validate, deletePost);

module.exports = router;
