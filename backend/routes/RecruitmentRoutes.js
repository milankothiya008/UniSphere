const express = require("express");
const { body, query } = require("express-validator");
const c = require("../controllers/RecruitmentController");
const { protect, optionalAuth, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { singleRecruitmentFile } = require("../middleware/Upload");
const { uploadLimiter } = require("../middleware/RateLimiter");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();
const auth = [protect, requireVerified];
const id = mongoIdParam("id");
const roundId = mongoIdParam("roundId");

const driveRules = [
    body("title").optional().isString().isLength({ max: 120 }),
    body("description").optional().isString().isLength({ max: 4000 }),
    body("positions").optional().isArray({ max: 10 }).withMessage("Up to 10 positions"),
    body("questions").optional().isArray({ max: 20 }).withMessage("Up to 20 questions"),
    body("applicationStart").optional({ values: "falsy" }).isISO8601().withMessage("Invalid opening time"),
    body("applicationEnd").optional().isISO8601().withMessage("Invalid deadline")
];
const comment = (required) =>
    required ? body("comment").isString().trim().isLength({ min: 5, max: 2000 }).withMessage("Explain in at least 5 characters") : body("comment").optional().isString().isLength({ max: 2000 });

// Discovery and the student's own applications
router.get("/", optionalAuth, c.listOpen);
router.get("/mine", ...auth, c.mine);
router.get("/review", ...auth, c.listToReview);

// A drive
router.get("/:id", optionalAuth, id, validate, c.get);
router.put("/:id", ...auth, id, driveRules, validate, c.update);
router.delete("/:id", ...auth, id, validate, c.remove);
router.post("/:id/submit", ...auth, id, validate, c.submit);
router.post("/:id/approve", ...auth, id, comment(false), validate, c.approve);
router.post("/:id/request-changes", ...auth, id, comment(true), validate, c.requestChanges);
router.post("/:id/reject", ...auth, id, comment(true), validate, c.reject);
router.post("/:id/publish", ...auth, id, validate, c.publish);
router.put("/:id/deadline", ...auth, id, body("applicationEnd").isISO8601().withMessage("Choose a new deadline"), validate, c.extend);
router.post("/:id/close", ...auth, id, validate, c.close);
router.post("/:id/cancel", ...auth, id, body("reason").optional().isString().isLength({ max: 500 }), validate, c.cancel);

// Applying: one application per role
const positionId = mongoIdParam("positionId");
router.get("/:id/applications/mine", ...auth, id, validate, c.myApplications);
router.get("/:id/positions/:positionId/application", ...auth, id, positionId, validate, c.myApplication);
router.post("/:id/positions/:positionId/application", ...auth, id, positionId, body("answers").optional().isArray({ max: 200 }), validate, c.apply);
router.put("/:id/positions/:positionId/application", ...auth, id, positionId, body("answers").optional().isArray({ max: 200 }), validate, c.updateApplication);
router.delete("/:id/positions/:positionId/application", ...auth, id, positionId, validate, c.withdraw);
router.post("/:id/applications/:applicationId/accept", ...auth, id, mongoIdParam("applicationId"), validate, c.accept);
router.post("/:id/applications/:applicationId/decline", ...auth, id, mongoIdParam("applicationId"), validate, c.decline);
router.post(
    "/:id/uploads",
    ...auth,
    uploadLimiter,
    id,
    body("kinds").isArray({ min: 1, max: 10 }),
    body("kinds.*").isIn(["DOCUMENT", "IMAGE"]).withMessage("Attach PDFs or images"),
    validate,
    c.uploadTickets
);
router.post("/:id/media", ...auth, uploadLimiter, id, validate, singleRecruitmentFile("file"), c.uploadLocal);

// Club side: applications, then selection per role
router.get(
    "/:id/applications",
    ...auth,
    id,
    query("search").optional().isString().isLength({ max: 100 }),
    query("position").optional().isMongoId(),
    validate,
    c.listApplications
);
router.get("/:id/applications/:applicationId", ...auth, id, mongoIdParam("applicationId"), validate, c.getApplication);
router.get("/:id/positions/:positionId/rounds", ...auth, id, positionId, validate, c.rounds);
router.post(
    "/:id/positions/:positionId/rounds",
    ...auth,
    id,
    positionId,
    body("name").isString().trim().isLength({ min: 1, max: 80 }).withMessage("Name the round"),
    body("mode").isIn(["SCREENING", "ONLINE", "OFFLINE"]).withMessage("Choose the round type"),
    validate,
    c.createRound
);
router.put(
    "/:id/positions/:positionId/rounds/:roundId/schedule",
    ...auth,
    id,
    positionId,
    roundId,
    body("timing").isIn(["COMMON", "SLOTS"]).withMessage("Choose one common time or individual slots"),
    body("startAt").isISO8601().withMessage("Set the start time"),
    body("endAt").optional({ values: "falsy" }).isISO8601(),
    body("slotMinutes").optional({ values: "falsy" }).isInt({ min: 5, max: 240 }),
    body("venue").optional({ values: "falsy" }).isMongoId(),
    body("meetingLink").optional({ values: "falsy" }).isString().isLength({ max: 500 }),
    body("instructions").optional().isString().isLength({ max: 1000 }),
    validate,
    c.scheduleRound
);
router.patch(
    "/:id/positions/:positionId/rounds/:roundId/slots/:applicationId",
    ...auth,
    id,
    positionId,
    roundId,
    mongoIdParam("applicationId"),
    body("startAt").isISO8601().withMessage("Choose the new time"),
    validate,
    c.updateSlot
);
router.put("/:id/positions/:positionId/rounds/:roundId/outcomes", ...auth, id, positionId, roundId, body("decisions").isArray({ max: 1000 }), validate, c.setOutcomes);
router.post("/:id/positions/:positionId/rounds/:roundId/publish", ...auth, id, positionId, roundId, validate, c.publishRound);
router.post(
    "/:id/positions/:positionId/finalize",
    ...auth,
    id,
    positionId,
    body("decisions").isArray({ max: 1000 }),
    body("offerDays").optional().isInt({ min: 1, max: 14 }).withMessage("Give 1 to 14 days to answer"),
    validate,
    c.finalize
);
router.post("/:id/positions/:positionId/offers/:applicationId", ...auth, id, positionId, mongoIdParam("applicationId"), validate, c.offerToReserve);
router.post("/:id/complete", ...auth, id, validate, c.complete);

module.exports = router;
