const express = require("express");
const { getDashboard } = require("../controllers/DashboardController");
const { protect, requireVerified } = require("../middleware/Auth");

const router = express.Router();

router.get("/", protect, requireVerified, getDashboard);

module.exports = router;
