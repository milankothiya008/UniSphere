const express = require("express");
const {
    getAllClubs,
    getClubById,
    updateClub,
    changeStatus,
    assignCoordinator,
    unassignCoordinator,
    listCoordinators,
    assignPresident,
    addMember,
    removeMember,
    getMembers
} = require("../controllers/ClubController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.get("/", getAllClubs);
router.get("/:id", mongoIdParam("id"), validate, getClubById);

router.use(protect, requireVerified);

router.put("/:id", mongoIdParam("id"), validate, updateClub);
router.post("/:id/status", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), mongoIdParam("id"), validate, changeStatus);
router.get("/:id/coordinators", mongoIdParam("id"), validate, listCoordinators);
router.post(
    "/:id/coordinators",
    restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    validate,
    assignCoordinator
);
router.delete(
    "/:id/coordinators/:coordinatorId",
    restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    mongoIdParam("coordinatorId"),
    validate,
    unassignCoordinator
);
router.post(
    "/:id/president",
    restrictTo(GLOBAL_ROLES.COORDINATOR, GLOBAL_ROLES.UNIVERSITY_ADMIN),
    mongoIdParam("id"),
    validate,
    assignPresident
);
router.get("/:id/members", mongoIdParam("id"), validate, getMembers);
router.post("/:id/members", mongoIdParam("id"), validate, addMember);
router.delete("/:id/members/:userId", mongoIdParam("id"), mongoIdParam("userId"), validate, removeMember);

module.exports = router;
