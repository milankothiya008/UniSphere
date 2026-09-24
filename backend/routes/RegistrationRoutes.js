const express = require("express");
const { mine } = require("../controllers/RegistrationController");
const { protect, requireVerified } = require("../middleware/Auth");
const { myInvites } = require("../controllers/TeamController");

const router = express.Router();

router.use(protect, requireVerified);
router.get("/me", mine);
router.get("/invites", myInvites);

module.exports = router;
