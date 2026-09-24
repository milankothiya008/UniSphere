const express = require("express");
const { inbox } = require("../controllers/DevController");

// Mounted only when emails run in preview mode (development without SMTP); see server.js.
const router = express.Router();

router.get("/emails", inbox);

module.exports = router;
