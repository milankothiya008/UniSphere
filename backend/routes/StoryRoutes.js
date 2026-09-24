const express = require("express");
const { body, query } = require("express-validator");
const controller = require("../controllers/StoryController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { singleStoryFile } = require("../middleware/Upload");
const { uploadLimiter } = require("../middleware/RateLimiter");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/", controller.getTray);
router.post(
    "/uploads",
    uploadLimiter,
    body("club").isMongoId().withMessage("Choose a club"),
    body("kind").isIn(["IMAGE", "VIDEO"]).withMessage("Choose a photo or a video"),
    validate,
    controller.createUploadTicket
);
router.post("/media", uploadLimiter, query("club").isMongoId().withMessage("Choose a club"), validate, singleStoryFile("file"), controller.uploadLocalMedia);
router.post(
    "/",
    body("club").isMongoId().withMessage("Choose a club"),
    body("media").isObject().withMessage("Add a photo or video"),
    body("caption").optional().isString().isLength({ max: 200 }).withMessage("Captions can be up to 200 characters"),
    body("event").optional({ values: "falsy" }).isMongoId().withMessage("Invalid event"),
    validate,
    controller.createStory
);
router.post("/:id/view", mongoIdParam("id"), validate, controller.recordView);
router.post("/:id/like", mongoIdParam("id"), body("liked").isBoolean().withMessage("liked must be true or false"), validate, controller.setLiked);
router.get("/:id/viewers", mongoIdParam("id"), validate, controller.listViewers);
router.delete("/:id", mongoIdParam("id"), validate, controller.deleteStory);

module.exports = router;
