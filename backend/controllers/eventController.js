const eventService = require("../services/eventService");
const asyncHandler = require("../utils/asyncHandler");


// Create event (sends approval request)
const createEvent = asyncHandler(async (req, res) => {
    const event = await eventService.createEvent(req.body);

    res.status(201).json({
        success: true,
        message: "Event request created. Pending approval.",
        data: event
    });
});


// Get all events
const getAllEvents = asyncHandler(async (req, res) => {
    const result = await eventService.getAllEvents(req.query);

    res.status(200).json({
        success: true,
        message: "Events fetched successfully",
        ...result
    });
});


// Get event by ID
const getEventById = asyncHandler(async (req, res) => {
    const event = await eventService.getEventById(req.params.id);

    res.status(200).json({
        success: true,
        data: event
    });
});


// Update event
const updateEvent = asyncHandler(async (req, res) => {
    const event = await eventService.updateEvent(
        req.params.id,
        req.body
    );

    res.status(200).json({
        success: true,
        message: "Event updated successfully",
        data: event
    });
});


// Approve / Reject / Cancel event
const updateEventStatus = asyncHandler(async (req, res) => {
    const event = await eventService.updateEventStatus(
        req.params.id,
        req.body.status
    );

    res.status(200).json({
        success: true,
        message: `Event ${req.body.status.toLowerCase()} successfully`,
        data: event
    });
});


// Delete event
const deleteEvent = asyncHandler(async (req, res) => {
    await eventService.deleteEvent(req.params.id);

    res.status(200).json({
        success: true,
        message: "Event deleted successfully"
    });
});


// Register for event
const registerForEvent = asyncHandler(async (req, res) => {
    const event = await eventService.registerForEvent(
        req.params.id,
        req.body.userId
    );

    res.status(200).json({
        success: true,
        message: "Successfully registered for event",
        data: event
    });
});


// Unregister from event
const unregisterFromEvent = asyncHandler(async (req, res) => {
    await eventService.unregisterFromEvent(
        req.params.id,
        req.body.userId
    );

    res.status(200).json({
        success: true,
        message: "Successfully unregistered from event"
    });
});


// Get events by club
const getEventsByClub = asyncHandler(async (req, res) => {
    const events = await eventService.getEventsByClub(
        req.params.clubId
    );

    res.status(200).json({
        success: true,
        count: events.length,
        data: events
    });
});


module.exports = {
    createEvent,
    getAllEvents,
    getEventById,
    updateEvent,
    updateEventStatus,
    deleteEvent,
    registerForEvent,
    unregisterFromEvent,
    getEventsByClub
};
