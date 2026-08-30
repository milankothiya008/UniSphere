const eventService = require("../services/EventService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const createEvent = asyncHandler(async (req, res) => {
    const event = await eventService.createDraft(req.user, req.body);
    sendSuccess(res, 201, "Event draft created", event);
});

const getFeed = asyncHandler(async (req, res) => {
    const result = await eventService.getAllEvents(req.query, { publicFeed: true });
    sendSuccess(res, 200, "Event feed fetched", result.events, {
        totalEvents: result.totalEvents,
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        limit: result.limit
    });
});

const getAllEvents = asyncHandler(async (req, res) => {
    const result = await eventService.getAllEvents(req.query, { publicFeed: false, actor: req.user });
    sendSuccess(res, 200, "Events fetched", result.events, {
        totalEvents: result.totalEvents,
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        limit: result.limit
    });
});

const getEventById = asyncHandler(async (req, res) => {
    const event = await eventService.getEventById(req.params.id, { actor: req.user });
    sendSuccess(res, 200, "Event fetched", event);
});

const getPublicEvent = asyncHandler(async (req, res) => {
    const event = await eventService.getEventById(req.params.id, { publicOnly: true });
    sendSuccess(res, 200, "Event fetched", event);
});

const updateEvent = asyncHandler(async (req, res) => {
    const event = await eventService.updateDraft(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Event updated", event);
});

const submitEvent = asyncHandler(async (req, res) => {
    const event = await eventService.submitEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Event submitted for approval", event);
});

const approveEvent = asyncHandler(async (req, res) => {
    const event = await eventService.approveEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Event approved", event);
});

const rejectEvent = asyncHandler(async (req, res) => {
    const event = await eventService.rejectEvent(req.user, req.params.id, req.body.reason);
    sendSuccess(res, 200, "Event rejected", event);
});

const publishEvent = asyncHandler(async (req, res) => {
    const event = await eventService.publishEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Event published", event);
});

const cancelEvent = asyncHandler(async (req, res) => {
    const event = await eventService.cancelEvent(req.user, req.params.id, req.body.reason);
    sendSuccess(res, 200, "Event cancelled", event);
});

const completeEvent = asyncHandler(async (req, res) => {
    const event = await eventService.completeEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Event marked as completed", event);
});

const getEventsByClub = asyncHandler(async (req, res) => {
    const events = await eventService.getEventsByClub(req.params.clubId);
    sendSuccess(res, 200, "Club events fetched", events, { count: events.length });
});

module.exports = {
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
};
