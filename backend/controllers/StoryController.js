const storyService = require("../services/StoryService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getTray = asyncHandler(async (req, res) => {
    // Personal (seen/liked) data: browsers may keep it but must revalidate; unchanged trays come back as 304.
    res.set("Cache-Control", "private, no-cache");
    sendSuccess(res, 200, "Stories fetched", await storyService.getTray(req.user));
});

const createUploadTicket = asyncHandler(async (req, res) => {
    sendSuccess(res, 201, "Upload ready", await storyService.createUploadTicket(req.user, req.body));
});

const uploadLocalMedia = asyncHandler(async (req, res) => {
    sendSuccess(res, 201, "Media uploaded", await storyService.uploadLocalMedia(req.user, req.query.club, req.file));
});

const createStory = asyncHandler(async (req, res) => {
    sendSuccess(res, 201, "Story posted", await storyService.createStory(req.user, req.body));
});

const recordView = asyncHandler(async (req, res) => {
    await storyService.recordView(req.user, req.params.id);
    sendSuccess(res, 200, "Story viewed", { seen: true });
});

const setLiked = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, req.body.liked ? "Story liked" : "Like removed", await storyService.setLiked(req.user, req.params.id, req.body.liked));
});

const listViewers = asyncHandler(async (req, res) => {
    const { items, meta } = await storyService.listViewers(req.user, req.params.id, req.query);
    sendSuccess(res, 200, "Viewers fetched", items, { meta });
});

const deleteStory = asyncHandler(async (req, res) => {
    await storyService.deleteStory(req.user, req.params.id);
    sendSuccess(res, 200, "Story deleted");
});

module.exports = { getTray, createUploadTicket, uploadLocalMedia, createStory, recordView, setLiked, listViewers, deleteStory };
