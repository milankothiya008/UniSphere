const registrationService = require("../services/RegistrationService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const register = asyncHandler(async (req, res) => {
    const result = await registrationService.registerForEvent(req.user, req.params.id);
    sendSuccess(res, 200, "Successfully registered for event", result);
});

const unregister = asyncHandler(async (req, res) => {
    await registrationService.cancelRegistration(req.user, req.params.id);
    sendSuccess(res, 200, "Successfully unregistered from event");
});

const list = asyncHandler(async (req, res) => {
    const registrations = await registrationService.listRegistrations(req.user, req.params.id);
    sendSuccess(res, 200, "Registrations fetched", registrations, { count: registrations.length });
});

const count = asyncHandler(async (req, res) => {
    const data = await registrationService.getPublicRegistrationCount(req.params.id);
    sendSuccess(res, 200, "Registration count fetched", data);
});

const mine = asyncHandler(async (req, res) => {
    const registrations = await registrationService.getMyRegistrations(req.user);
    sendSuccess(res, 200, "Your registrations fetched", registrations);
});

module.exports = { register, unregister, list, count, mine };
