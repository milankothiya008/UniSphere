const checkIn = require("../services/CheckInService");
const { getMyTicket } = require("../services/TicketService");
const { CHECK_IN_METHODS } = require("../constants/Statuses");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const myTicket = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Ticket fetched", await getMyTicket(req.user, req.params.id));
});

const status = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Check-in status fetched", await checkIn.getCheckInStatus(req.user, req.params.id));
});

const open = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Check-in is open — officers can now scan tickets", await checkIn.openCheckIn(req.user, req.params.id));
});

const close = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Check-in closed", await checkIn.closeCheckIn(req.user, req.params.id));
});

const participants = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Registered students fetched", await checkIn.listForCheckIn(req.user, req.params.id, { search: req.query.search }));
});

// A scanned QR (token) or a typed ticket code.
const scan = asyncHandler(async (req, res) => {
    const { token, code } = req.body;
    const method = token ? CHECK_IN_METHODS.QR : CHECK_IN_METHODS.MANUAL;
    const result = await checkIn.markAttendance(req.user, req.params.id, token ? { token } : { code }, method);
    sendSuccess(res, 200, result.message, result);
});

const mark = asyncHandler(async (req, res) => {
    const result = await checkIn.markAttendance(req.user, req.params.id, { registrationId: req.params.registrationId, note: req.body.note }, CHECK_IN_METHODS.MANUAL);
    sendSuccess(res, 200, result.message, result);
});

const unmark = asyncHandler(async (req, res) => {
    const result = await checkIn.unmarkAttendance(req.user, req.params.id, req.params.registrationId);
    sendSuccess(res, 200, result.message, result);
});

module.exports = { myTicket, status, open, close, participants, scan, mark, unmark };
