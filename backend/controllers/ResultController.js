const resultService = require("../services/ResultService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const upsert = asyncHandler(async (req, res) => {
    const result = await resultService.upsertResult(req.user, req.params.id, req.body);
    sendSuccess(res, 200, result.status === "PUBLISHED" ? "Published results corrected" : "Final results draft saved", result);
});

const publish = asyncHandler(async (req, res) => {
    const result = await resultService.publishResult(req.user, req.params.id);
    sendSuccess(res, 200, "Final results published", result);
});

const createRound = asyncHandler(async (req, res) => {
    const result = await resultService.createRound(req.user, req.params.id, req.body);
    sendSuccess(res, 201, "Round created", result);
});

const updateRound = asyncHandler(async (req, res) => {
    const result = await resultService.updateRound(req.user, req.params.id, req.params.roundId, req.body);
    sendSuccess(res, 200, "Round saved", result);
});

const deleteRound = asyncHandler(async (req, res) => {
    const result = await resultService.deleteRound(req.user, req.params.id, req.params.roundId);
    sendSuccess(res, 200, "Round deleted", result);
});

const publishRound = asyncHandler(async (req, res) => {
    const result = await resultService.publishRound(req.user, req.params.id, req.params.roundId);
    sendSuccess(res, 200, "Round results published", result);
});

const unpublishRound = asyncHandler(async (req, res) => {
    const result = await resultService.unpublishRound(req.user, req.params.id, req.params.roundId);
    sendSuccess(res, 200, "Round results withdrawn", result);
});

const getOne = asyncHandler(async (req, res) => {
    const result = await resultService.getResult(req.user, req.params.id);
    sendSuccess(res, 200, "Results fetched", result);
});

const listPublished = asyncHandler(async (req, res) => {
    const { items, ...meta } = await resultService.listPublishedResults(req.query);
    sendSuccess(res, 200, "Published results fetched", items, { meta });
});

module.exports = { upsert, publish, getOne, listPublished, createRound, updateRound, deleteRound, publishRound, unpublishRound };
