const express = require("express");
const { createVenue, listVenues, updateVenue, available } = require("../controllers/VenueController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam, availabilityRules } = require("../validators/RequestValidators");

const router = express.Router();

router.get("/", listVenues);
router.get("/available", protect, requireVerified, availabilityRules, validate, available);

router.use(protect, requireVerified, restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN));

router.post("/", createVenue);
router.put("/:id", mongoIdParam("id"), validate, updateVenue);

module.exports = router;
