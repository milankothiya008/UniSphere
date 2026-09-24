const express = require("express");
const { uploadImage } = require("../controllers/UploadController");
const { protect, requireVerified } = require("../middleware/Auth");
const { singleImage } = require("../middleware/Upload");
const { uploadLimiter } = require("../middleware/RateLimiter");

const router = express.Router();

router.post("/image", protect, requireVerified, uploadLimiter, singleImage("file"), uploadImage);

module.exports = router;
