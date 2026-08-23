const express = require("express");

const {
    createEvent,
    getAllEvents,
    getEventById,
    updateEvent,
    updateEventStatus,
    deleteEvent,
    registerForEvent,
    unregisterFromEvent,
    getEventsByClub
} = require("../controllers/EventController");

const router = express.Router();


// CRUD
router.post("/", createEvent);

router.get("/", getAllEvents);

router.get("/:id", getEventById);

router.put("/:id", updateEvent);

router.delete("/:id", deleteEvent);


// Approve / Reject / Cancel
router.patch("/:id/status", updateEventStatus);


// Registration
router.post("/:id/register", registerForEvent);

router.delete("/:id/register", unregisterFromEvent);


// Club's events
router.get("/club/:clubId", getEventsByClub);


module.exports = router;
