const express = require("express");
const { createVenue, listVenues, updateVenue, available } = require("../controllers/VenueController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam, availabilityRules, venueRules } = require("../validators/RequestValidators");

const router = express.Router();

router.get("/", listVenues);
router.get("/available", protect, requireVerified, availabilityRules, validate, available);

router.use(protect, requireVerified, restrictTo(GLOBAL_ROLES.ADMIN));

router.post("/", venueRules(false), validate, createVenue);
router.put("/:id", mongoIdParam("id"), venueRules(true), validate, updateVenue);

module.exports = router;
