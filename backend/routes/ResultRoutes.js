const express = require("express");
const { listPublished } = require("../controllers/ResultController");
const { optionalAuth } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { query } = require("express-validator");

const router = express.Router();

router.get("/", optionalAuth, query("club").optional().isMongoId(), validate, listPublished);

module.exports = router;
