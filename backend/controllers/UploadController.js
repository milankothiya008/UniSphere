const { storeImage } = require("../services/StorageService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const uploadImage = asyncHandler(async (req, res) => {
    const stored = await storeImage(req.file, String(req.query.folder || ""));
    sendSuccess(res, 201, "Image uploaded", stored);
});

module.exports = { uploadImage };
