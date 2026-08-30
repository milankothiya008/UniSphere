const express = require("express");
const { getUserClubs } = require("../controllers/MembershipController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.use(protect, requireVerified);

router.get("/users/:userId/clubs", mongoIdParam("userId"), validate, getUserClubs);

module.exports = router;
