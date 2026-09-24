const feedService = require("../services/FeedService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const listFeed = asyncHandler(async (req, res) => {
    const { items, ...meta } = await feedService.listFeed(req.user, req.query);
    sendSuccess(res, 200, "Feed fetched", items, { meta });
});

const createPost = asyncHandler(async (req, res) => {
    const post = await feedService.createPost(req.user, req.body);
    sendSuccess(res, 201, "Post published", post);
});

const deletePost = asyncHandler(async (req, res) => {
    await feedService.deletePost(req.user, req.params.id);
    sendSuccess(res, 200, "Post deleted");
});

module.exports = { listFeed, createPost, deletePost };
