const express = require("express");
const e = require("../controllers/EventController");
const registration = require("../controllers/RegistrationController");
const result = require("../controllers/ResultController");
const { protect, optionalAuth, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const {
    mongoIdParam,
    eventDraftRules,
    eventUpdateRules,
    rejectRules,
    commentRules,
    optionalCommentRules,
    resultRules,
    roundRules
} = require("../validators/RequestValidators");
const { body } = require("express-validator");

const router = express.Router();
const auth = [protect, requireVerified];
const id = mongoIdParam("id");
const roundId = mongoIdParam("roundId");

// Discovery and public detail (registration status is included when signed in).
router.get("/", optionalAuth, e.listEvents);
router.get("/manage", ...auth, e.listManaged);
router.get("/:id", optionalAuth, id, validate, e.getEvent);
router.get("/:id/registration-count", id, validate, registration.count);
router.get("/:id/results", optionalAuth, id, validate, result.getOne);

// Lifecycle
router.post("/", ...auth, eventDraftRules, validate, e.createEvent);
router.put("/:id", ...auth, id, eventUpdateRules, validate, e.updateEvent);
router.post("/:id/submit", ...auth, id, validate, e.submitEvent);
router.post("/:id/approve", ...auth, id, optionalCommentRules, validate, e.approveEvent);
router.post("/:id/request-changes", ...auth, id, commentRules, validate, e.requestChanges);
router.post("/:id/reject", ...auth, id, rejectRules, validate, e.rejectEvent);
router.post("/:id/publish", ...auth, id, validate, e.publishEvent);
router.post("/:id/cancel", ...auth, id, body("reason").optional().isString().isLength({ max: 1000 }), validate, e.cancelEvent);
router.post("/:id/complete", ...auth, id, validate, e.completeEvent);

// Registration and participants
router.post("/:id/register", ...auth, id, validate, registration.register);
router.delete("/:id/register", ...auth, id, validate, registration.unregister);
router.get("/:id/registrations", ...auth, id, validate, registration.list);
router.delete("/:id/registrations/:registrationId", ...auth, id, mongoIdParam("registrationId"), validate, registration.removeParticipant);

// Results
router.put("/:id/results", ...auth, id, resultRules, validate, result.upsert);
router.post("/:id/results/publish", ...auth, id, validate, result.publish);
router.post("/:id/results/rounds", ...auth, id, roundRules(false), validate, result.createRound);
router.put("/:id/results/rounds/:roundId", ...auth, id, roundId, roundRules(true), validate, result.updateRound);
router.delete("/:id/results/rounds/:roundId", ...auth, id, roundId, validate, result.deleteRound);
router.post("/:id/results/rounds/:roundId/publish", ...auth, id, roundId, validate, result.publishRound);
router.post("/:id/results/rounds/:roundId/unpublish", ...auth, id, roundId, validate, result.unpublishRound);

module.exports = router;
