const clubRequestService = require("../services/ClubRequestService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const createRequest = asyncHandler(async (req, res) => {
    const request = await clubRequestService.submitRequest(req.user, req.body);
    sendSuccess(res, 201, "Club request submitted for faculty review", request);
});

const listRequests = asyncHandler(async (req, res) => {
    const { items, ...meta } = await clubRequestService.listRequests(req.user, req.query);
    sendSuccess(res, 200, "Club requests fetched", items, { meta });
});

const getRequest = asyncHandler(async (req, res) => {
    const request = await clubRequestService.getRequestById(req.user, req.params.id);
    sendSuccess(res, 200, "Club request fetched", request);
});

const updateRequest = asyncHandler(async (req, res) => {
    const request = await clubRequestService.updateRequest(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Club request updated", request);
});

const resubmit = asyncHandler(async (req, res) => {
    const request = await clubRequestService.resubmitRequest(req.user, req.params.id);
    sendSuccess(res, 200, "Club request resubmitted for faculty review", request);
});

const verify = asyncHandler(async (req, res) => {
    const request = await clubRequestService.verifyRequest(req.user, req.params.id, req.body.comment);
    sendSuccess(res, 200, "Club request verified and sent to the university admin", request);
});

const requestChanges = asyncHandler(async (req, res) => {
    const request = await clubRequestService.requestChanges(req.user, req.params.id, req.body.comment);
    sendSuccess(res, 200, "Changes requested", request);
});

const reject = asyncHandler(async (req, res) => {
    const request = await clubRequestService.rejectRequest(req.user, req.params.id, req.body.reason);
    sendSuccess(res, 200, "Club request rejected", request);
});

const approve = asyncHandler(async (req, res) => {
    const result = await clubRequestService.approveRequest(req.user, req.params.id);
    sendSuccess(res, 200, "Club approved and created", result);
});

module.exports = {
    createRequest,
    listRequests,
    getRequest,
    updateRequest,
    resubmit,
    verify,
    requestChanges,
    reject,
    approve
};
