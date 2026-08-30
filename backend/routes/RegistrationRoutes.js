const express = require("express");
const { mine } = require("../controllers/RegistrationController");
const { protect, requireVerified } = require("../middleware/Auth");

const router = express.Router();

router.use(protect, requireVerified);
router.get("/me", mine);

module.exports = router;
