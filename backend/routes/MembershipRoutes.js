const express = require("express");
const { getMyMemberships, getUserClubs } = require("../controllers/MembershipController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/me", getMyMemberships);
router.get("/users/:userId/clubs", mongoIdParam("userId"), validate, getUserClubs);

module.exports = router;
