const eventService = require("../services/EventService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const listEvents = asyncHandler(async (req, res) => {
    const { items, ...meta } = await eventService.listEvents(req.user, req.query);
    sendSuccess(res, 200, "Events fetched", items, { meta });
});

const listManaged = asyncHandler(async (req, res) => {
    const { items, ...meta } = await eventService.listManagedEvents(req.user, req.query);
    sendSuccess(res, 200, "Managed events fetched", items, { meta });
});

const listClubEvents = asyncHandler(async (req, res) => {
    const { items, ...meta } = await eventService.listClubEvents(req.user, req.params.clubId, req.query);
    sendSuccess(res, 200, "Club events fetched", items, { meta });
});

const getEvent = asyncHandler(async (req, res) => {
    const event = await eventService.getEventDetail(req.user, req.params.id);
    sendSuccess(res, 200, "Event fetched", event);
});

const createEvent = asyncHandler(async (req, res) => {
    const event = await eventService.createDraft(req.user, req.body);
    sendSuccess(res, 201, "Event draft created", event);
});

const updateEvent = asyncHandler(async (req, res) => {
    const event = await eventService.updateEvent(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Event updated", event);
});

const submitEvent = asyncHandler(async (req, res) => {
    const event = await eventService.submitEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Event submitted to the faculty mentor", event);
});

const approveEvent = asyncHandler(async (req, res) => {
    const event = await eventService.approveEvent(req.user, req.params.id, req.body.comment);
    sendSuccess(res, 200, "Event approved", event);
});

const requestChanges = asyncHandler(async (req, res) => {
    const event = await eventService.requestEventChanges(req.user, req.params.id, req.body.comment);
    sendSuccess(res, 200, "Changes requested", event);
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

module.exports = {
    listEvents,
    listManaged,
    listClubEvents,
    getEvent,
    createEvent,
    updateEvent,
    submitEvent,
    approveEvent,
    requestChanges,
    rejectEvent,
    publishEvent,
    cancelEvent,
    completeEvent
};
