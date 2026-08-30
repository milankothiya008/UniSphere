const clubRequestService = require("../services/ClubRequestService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const createRequest = asyncHandler(async (req, res) => {
    const request = await clubRequestService.submitRequest(req.user, req.body);
    sendSuccess(res, 201, "Club creation request submitted", request);
});

const listRequests = asyncHandler(async (req, res) => {
    const requests = await clubRequestService.listRequests(req.user, req.query);
    sendSuccess(res, 200, "Club requests fetched", requests);
});

const getRequest = asyncHandler(async (req, res) => {
    const request = await clubRequestService.getRequestById(req.user, req.params.id);
    sendSuccess(res, 200, "Club request fetched", request);
});

const recommend = asyncHandler(async (req, res) => {
    const request = await clubRequestService.recommendRequest(req.user, req.params.id);
    sendSuccess(res, 200, "Club request recommended for admin approval", request);
});

const reject = asyncHandler(async (req, res) => {
    const request = await clubRequestService.rejectRequest(req.user, req.params.id, req.body.reason);
    sendSuccess(res, 200, "Club request rejected", request);
});

const approve = asyncHandler(async (req, res) => {
    const result = await clubRequestService.approveRequest(req.user, req.params.id);
    sendSuccess(res, 200, "Club request approved and club created", result);
});

module.exports = {
    createRequest,
    listRequests,
    getRequest,
    recommend,
    reject,
    approve
};
