const express = require("express");
const e = require("../controllers/EventController");
const registration = require("../controllers/RegistrationController");
const result = require("../controllers/ResultController");
const team = require("../controllers/TeamController");
const checkIn = require("../controllers/CheckInController");
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

// Changes to a published event (the live event is untouched until they are published)
router.post("/:id/changes/approve", ...auth, id, optionalCommentRules, validate, e.approveChanges);
router.post("/:id/changes/request-changes", ...auth, id, commentRules, validate, e.requestChangesToEdit);
router.post("/:id/changes/reject", ...auth, id, rejectRules, validate, e.rejectChanges);
router.post("/:id/changes/publish", ...auth, id, validate, e.publishChanges);
router.delete("/:id/changes", ...auth, id, validate, e.discardChanges);

// Registration and participants
router.post(
    "/:id/register",
    ...auth,
    id,
    body("teamName").optional().isString().isLength({ max: 60 }),
    body("invitees").optional().isArray({ max: 19 }).withMessage("Too many invites"),
    body("invitees.*").isMongoId().withMessage("Invalid student"),
    validate,
    registration.register
);

// Teams (team events): the leader invites and manages members; invitees accept or decline.
router.get("/:id/team/candidates", ...auth, id, validate, team.candidates);
router.post("/:id/team/invites", ...auth, id, body("users").isArray({ min: 1, max: 19 }).withMessage("Choose students to invite"), body("users.*").isMongoId(), validate, team.invite);
router.delete("/:id/team/members/:userId", ...auth, id, mongoIdParam("userId"), validate, team.removeMember);
router.post("/:id/teams/:teamId/accept", ...auth, id, mongoIdParam("teamId"), validate, team.accept);
router.post("/:id/teams/:teamId/decline", ...auth, id, mongoIdParam("teamId"), validate, team.decline);
router.delete("/:id/register", ...auth, id, validate, registration.unregister);
router.get("/:id/registrations", ...auth, id, validate, registration.list);
router.delete("/:id/registrations/:registrationId", ...auth, id, mongoIdParam("registrationId"), validate, registration.removeParticipant);

// Tickets and check-in at the door
router.get("/:id/ticket", ...auth, id, validate, checkIn.myTicket);
router.get("/:id/check-in", ...auth, id, validate, checkIn.status);
router.post("/:id/check-in/open", ...auth, id, validate, checkIn.open);
router.post("/:id/check-in/close", ...auth, id, validate, checkIn.close);
router.get("/:id/check-in/participants", ...auth, id, validate, checkIn.participants);
router.post(
    "/:id/check-in/scan",
    ...auth,
    id,
    body("token").optional().isString().isLength({ min: 40, max: 200 }).withMessage("Invalid ticket"),
    body("code").optional().isString().isLength({ min: 1, max: 20 }).withMessage("Invalid ticket code"),
    body().custom((value) => Boolean(value?.token || value?.code !== undefined) || Promise.reject(new Error("Scan a QR code or enter a ticket code"))),
    validate,
    checkIn.scan
);
router.post("/:id/check-in/attendance/:registrationId", ...auth, id, mongoIdParam("registrationId"), body("note").optional().isString().isLength({ max: 200 }), validate, checkIn.mark);
router.delete("/:id/check-in/attendance/:registrationId", ...auth, id, mongoIdParam("registrationId"), validate, checkIn.unmark);

// Results
router.put("/:id/results", ...auth, id, resultRules, validate, result.upsert);
router.post("/:id/results/publish", ...auth, id, validate, result.publish);
router.post("/:id/results/rounds", ...auth, id, roundRules(false), validate, result.createRound);
router.put("/:id/results/rounds/:roundId", ...auth, id, roundId, roundRules(true), validate, result.updateRound);
router.delete("/:id/results/rounds/:roundId", ...auth, id, roundId, validate, result.deleteRound);
router.post("/:id/results/rounds/:roundId/publish", ...auth, id, roundId, validate, result.publishRound);
router.post("/:id/results/rounds/:roundId/unpublish", ...auth, id, roundId, validate, result.unpublishRound);

module.exports = router;
