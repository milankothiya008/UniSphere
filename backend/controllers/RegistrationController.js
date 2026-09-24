const registrationService = require("../services/RegistrationService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const register = asyncHandler(async (req, res) => {
    const result = await registrationService.registerForEvent(req.user, req.params.id);
    const message = result.waitlisted
        ? `This event is full. You're #${result.waitlistPosition} on the waitlist.`
        : "You're registered for this event";
    sendSuccess(res, 201, message, result);
});

const unregister = asyncHandler(async (req, res) => {
    const result = await registrationService.cancelRegistration(req.user, req.params.id);
    sendSuccess(res, 200, result.leftWaitlist ? "You left the waitlist" : "Your registration was cancelled", result);
});

const list = asyncHandler(async (req, res) => {
    const { items, waitlist, event } = await registrationService.listParticipants(req.user, req.params.id, req.query);
    sendSuccess(res, 200, "Participants fetched", items, { meta: { total: items.length, event, waitlist } });
});

const removeParticipant = asyncHandler(async (req, res) => {
    await registrationService.removeParticipant(req.user, req.params.id, req.params.registrationId, req.body?.reason);
    sendSuccess(res, 200, "Participant removed");
});

const count = asyncHandler(async (req, res) => {
    const data = await registrationService.getPublicRegistrationCount(req.params.id);
    sendSuccess(res, 200, "Registration count fetched", data);
});

const mine = asyncHandler(async (req, res) => {
    const registrations = await registrationService.getMyRegistrations(req.user, req.query);
    sendSuccess(res, 200, "Your registrations fetched", registrations);
});

module.exports = { register, unregister, list, removeParticipant, count, mine };
