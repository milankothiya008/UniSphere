const resultService = require("../services/ResultService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const upsert = asyncHandler(async (req, res) => {
    const result = await resultService.upsertResult(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Event result saved", result);
});

const publish = asyncHandler(async (req, res) => {
    const result = await resultService.publishResult(req.user, req.params.id);
    sendSuccess(res, 200, "Event result published", result);
});

const getOne = asyncHandler(async (req, res) => {
    const result = await resultService.getResult(req.user, req.params.id);
    sendSuccess(res, 200, "Event result fetched", result);
});

const getPublished = asyncHandler(async (req, res) => {
    const result = await resultService.getPublishedResult(req.params.id);
    sendSuccess(res, 200, "Published result fetched", result);
});

module.exports = { upsert, publish, getOne, getPublished };
