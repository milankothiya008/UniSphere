const express = require("express");
const {
    createEvent,
    getFeed,
    getAllEvents,
    getEventById,
    getPublicEvent,
    updateEvent,
    submitEvent,
    approveEvent,
    rejectEvent,
    publishEvent,
    cancelEvent,
    completeEvent,
    getEventsByClub
} = require("../controllers/EventController");
const { register, unregister, list, count } = require("../controllers/RegistrationController");
const { upsert, publish, getOne, getPublished } = require("../controllers/ResultController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam, eventDraftRules, rejectRules } = require("../validators/RequestValidators");

const router = express.Router();

router.get("/feed", getFeed);
router.get("/club/:clubId", mongoIdParam("clubId"), validate, getEventsByClub);
router.get("/:id/public", mongoIdParam("id"), validate, getPublicEvent);
router.get("/:id/registration-count", mongoIdParam("id"), validate, count);
router.get("/:id/results/public", mongoIdParam("id"), validate, getPublished);

router.use(protect, requireVerified);

router.post("/", eventDraftRules, validate, createEvent);
router.get("/", restrictTo(GLOBAL_ROLES.COORDINATOR, GLOBAL_ROLES.UNIVERSITY_ADMIN), getAllEvents);
router.get("/:id", mongoIdParam("id"), validate, getEventById);
router.put("/:id", mongoIdParam("id"), validate, updateEvent);
router.post("/:id/submit", mongoIdParam("id"), validate, submitEvent);
router.post("/:id/approve", mongoIdParam("id"), validate, approveEvent);
router.post("/:id/reject", mongoIdParam("id"), rejectRules, validate, rejectEvent);
router.post("/:id/publish", mongoIdParam("id"), validate, publishEvent);
router.post("/:id/cancel", mongoIdParam("id"), validate, cancelEvent);
router.post("/:id/complete", mongoIdParam("id"), validate, completeEvent);

router.post("/:id/register", mongoIdParam("id"), validate, register);
router.delete("/:id/register", mongoIdParam("id"), validate, unregister);
router.get("/:id/registrations", mongoIdParam("id"), validate, list);

router.put("/:id/results", mongoIdParam("id"), validate, upsert);
router.post("/:id/results/publish", mongoIdParam("id"), validate, publish);
router.get("/:id/results", mongoIdParam("id"), validate, getOne);

module.exports = router;
