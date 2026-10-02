const express = require("express");
const e = require("../controllers/EventController");
const registration = require("../controllers/RegistrationController");
const result = require("../controllers/ResultController");
const team = require("../controllers/TeamController");
const checkIn = require("../controllers/CheckInController");
const gallery = require("../controllers/GalleryController");
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
const { body, query } = require("express-validator");
const { singleGalleryFile } = require("../middleware/Upload");
const { uploadLimiter } = require("../middleware/RateLimiter");
const hackathon = require("../controllers/HackathonController");
const certificates = require("../controllers/CertificateController");

const router = express.Router();
const auth = [protect, requireVerified];
const id = mongoIdParam("id");
const roundId = mongoIdParam("roundId");

// Discovery and public detail (registration status is included when signed in).
router.get("/", optionalAuth, e.listEvents);
router.get("/manage", ...auth, e.listManaged);
// Campus-wide schedule for planning: which slots other clubs have taken (officers, faculty, admin).
router.get(
    "/schedule",
    ...auth,
    query("from").optional().isISO8601().withMessage("from must be a date (YYYY-MM-DD)"),
    query("days").optional().isInt({ min: 1, max: 31 }).withMessage("days must be 1 to 31"),
    validate,
    e.schedule
);
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

// Reminders: officers with SEND_REMINDERS send "registration closing" or "starting soon" by hand.
router.post(
    "/:id/reminders",
    ...auth,
    id,
    body("kind").isIn(["REGISTRATION_CLOSING", "EVENT_STARTING"]).withMessage("Choose which reminder to send"),
    body("note").optional().isString().isLength({ max: 500 }).withMessage("Keep the note under 500 characters"),
    validate,
    e.sendReminder
);

// Feedback after the event: attendees rate it; organisers see the summary.
router.get("/:id/feedback", ...auth, id, validate, e.getFeedback);
router.put(
    "/:id/feedback",
    ...auth,
    id,
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Choose 1 to 5 stars"),
    body("note").optional().isString().isLength({ max: 1000 }).withMessage("Keep the note under 1000 characters"),
    validate,
    e.giveFeedback
);

// Certificates the viewer has for this event (issued on request).
router.get("/:id/certificates", ...auth, id, validate, certificates.forEvent);

// Hackathon mode (HACKATHON events).
const problemId = mongoIdParam("problemId");
router.get("/:id/hackathon", ...auth, id, validate, hackathon.get);
router.put("/:id/hackathon", ...auth, id, body("agenda").optional().isArray({ max: 40 }), body("criteria").optional().isArray({ max: 10 }), body("submissionQuestions").optional().isArray({ max: 25 }), validate, hackathon.updateSettings);
router.post("/:id/hackathon/problems", ...auth, id, validate, hackathon.addProblem);
router.put("/:id/hackathon/problems/:problemId", ...auth, id, problemId, validate, hackathon.updateProblem);
router.delete("/:id/hackathon/problems/:problemId", ...auth, id, problemId, validate, hackathon.deleteProblem);
router.post("/:id/hackathon/judges", ...auth, id, body("userId").isMongoId().withMessage("Choose a judge"), validate, hackathon.addJudge);
router.delete("/:id/hackathon/judges/:userId", ...auth, id, mongoIdParam("userId"), validate, hackathon.removeJudge);
router.put("/:id/hackathon/entry/problem", ...auth, id, body("problemId").isMongoId().withMessage("Choose a problem statement"), validate, hackathon.chooseProblem);
router.put("/:id/hackathon/entry/repo", ...auth, id, body("repoUrl").isString().isLength({ min: 8, max: 500 }).withMessage("Add the repository link"), validate, hackathon.submitRepo);
router.put("/:id/hackathon/entry/project", ...auth, id, validate, hackathon.submitProject);
router.get("/:id/hackathon/judging", ...auth, id, validate, hackathon.judging);
router.put("/:id/hackathon/judging/:entryId", ...auth, id, mongoIdParam("entryId"), body("marks").isArray({ max: 10 }), body("comment").optional().isString().isLength({ max: 1000 }), validate, hackathon.score);
router.get("/:id/hackathon/leaderboard", ...auth, id, validate, hackathon.leaderboard);
router.post("/:id/hackathon/results", ...auth, id, body("winners").optional().isInt({ min: 1, max: 10 }), body("titles").optional().isArray({ max: 10 }), validate, hackathon.draftResults);

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
    body("answers").optional().isArray({ max: 25 }),
    body("teamAnswers").optional().isArray({ max: 25 }),
    validate,
    registration.register
);
// The registration form: the club edits it; registrants change their answers until the event starts.
router.put("/:id/registration-form", ...auth, id, body("enabled").isBoolean(), body("questions").optional().isArray({ max: 25 }), validate, e.updateRegistrationForm);
router.put("/:id/expenses", ...auth, id, body("items").isArray({ max: 60 }), body("note").optional().isString().isLength({ max: 1000 }), validate, e.recordExpenses);
router.put("/:id/register/answers", ...auth, id, body("answers").optional().isArray({ max: 25 }), body("teamAnswers").optional().isArray({ max: 25 }), validate, e.updateMyAnswers);

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

// Photo and video gallery (approved items are public; uploads and review need an account)
const mediaIds = body("ids").isArray({ min: 1, max: 100 }).withMessage("Choose photos or videos").bail().custom((ids) => ids.every((value) => /^[a-f\d]{24}$/i.test(String(value)))).withMessage("Invalid selection");
router.get("/:id/gallery", optionalAuth, id, validate, gallery.list);
router.post(
    "/:id/gallery/uploads",
    ...auth,
    uploadLimiter,
    id,
    body("kinds").isArray({ min: 1, max: 20 }).withMessage("Choose up to 20 photos or videos at a time"),
    body("kinds.*").isIn(["IMAGE", "VIDEO"]).withMessage("Only photos and videos can be added"),
    validate,
    gallery.uploadTickets
);
router.post("/:id/gallery/media", ...auth, uploadLimiter, id, validate, singleGalleryFile("file"), gallery.uploadLocal);
router.post("/:id/gallery", ...auth, id, body("media").isObject().withMessage("Add a photo or video"), validate, gallery.add);
router.post("/:id/gallery/approve", ...auth, id, mediaIds, validate, gallery.approve);
router.post(
    "/:id/gallery/reject",
    ...auth,
    id,
    mediaIds,
    body("reason").optional().isString().isLength({ max: 200 }).withMessage("Keep the reason under 200 characters"),
    validate,
    gallery.reject
);
router.delete("/:id/gallery/:mediaId", ...auth, id, mongoIdParam("mediaId"), validate, gallery.remove);

// Results
router.put("/:id/results", ...auth, id, resultRules, validate, result.upsert);
router.post("/:id/results/publish", ...auth, id, validate, result.publish);
router.post("/:id/results/rounds", ...auth, id, roundRules(false), validate, result.createRound);
router.put("/:id/results/rounds/:roundId", ...auth, id, roundId, roundRules(true), validate, result.updateRound);
router.delete("/:id/results/rounds/:roundId", ...auth, id, roundId, validate, result.deleteRound);
router.post("/:id/results/rounds/:roundId/publish", ...auth, id, roundId, validate, result.publishRound);
router.post("/:id/results/rounds/:roundId/unpublish", ...auth, id, roundId, validate, result.unpublishRound);

module.exports = router;
