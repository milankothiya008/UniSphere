const registrationService = require("../services/RegistrationService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const register = asyncHandler(async (req, res) => {
    const result = await registrationService.registerForEvent(req.user, req.params.id, req.body);
    const invited = result.team?.invites?.length || 0;
    const invites = invited ? ` Invites sent to ${invited} teammate${invited === 1 ? "" : "s"}.` : "";
    const message = result.team
        ? result.waitlisted
            ? `This event is full. Your team is #${result.waitlistPosition} on the waitlist.${invites}`
            : `Team "${result.team.name}" is registered.${invites}`
        : result.waitlisted
          ? `This event is full. You're #${result.waitlistPosition} on the waitlist.`
          : "You're registered for this event";
    sendSuccess(res, 201, message, result);
});

const unregister = asyncHandler(async (req, res) => {
    const result = await registrationService.cancelRegistration(req.user, req.params.id);
    const message = result.leftTeam
        ? "You left the team"
        : result.disbandedTeam
          ? "Your team's registration was cancelled"
          : result.leftWaitlist
            ? "You left the waitlist"
            : "Your registration was cancelled";
    sendSuccess(res, 200, message, result);
});

const list = asyncHandler(async (req, res) => {
    const { items, waitlist, teams, event } = await registrationService.listParticipants(req.user, req.params.id, req.query);
    sendSuccess(res, 200, "Participants fetched", items, { meta: { total: items.length, event, waitlist, teams } });
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
