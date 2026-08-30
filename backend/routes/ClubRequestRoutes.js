const express = require("express");
const {
    createRequest,
    listRequests,
    getRequest,
    recommend,
    reject,
    approve
} = require("../controllers/ClubRequestController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { clubRequestRules, mongoIdParam, rejectRules } = require("../validators/RequestValidators");

const router = express.Router();

router.use(protect, requireVerified);

router.post("/", clubRequestRules, validate, createRequest);
router.get("/", listRequests);
router.get("/:id", mongoIdParam("id"), validate, getRequest);
router.post(
    "/:id/recommend",
    restrictTo(GLOBAL_ROLES.COORDINATOR, GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    validate,
    recommend
);
router.post(
    "/:id/reject",
    restrictTo(GLOBAL_ROLES.COORDINATOR, GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    rejectRules,
    validate,
    reject
);
router.post(
    "/:id/approve",
    restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    validate,
    approve
);

module.exports = router;
