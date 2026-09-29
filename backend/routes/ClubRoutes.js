const express = require("express");
const c = require("../controllers/ClubController");
const { listClubEvents } = require("../controllers/EventController");
const recruitment = require("../controllers/RecruitmentController");
const { protect, optionalAuth, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const {
    mongoIdParam,
    mongoIdBody,
    clubUpdateRules,
    clubStatusRules,
    roleRules,
    clubRoleRules,
    subscriptionRules
} = require("../validators/RequestValidators");

const router = express.Router();
const auth = [protect, requireVerified];
const id = [...mongoIdParam("id")];

router.get("/", optionalAuth, c.listClubs);
router.get("/mine", ...auth, c.myClubs);
router.get("/:id", optionalAuth, id, validate, c.getClub);
router.get("/:clubId/events", optionalAuth, mongoIdParam("clubId"), validate, listClubEvents);
// Joining happens through recruitment drives (see RecruitmentRoutes).
router.get("/:clubId/recruitment", optionalAuth, mongoIdParam("clubId"), validate, recruitment.listForClub);
router.post("/:clubId/recruitment", ...auth, mongoIdParam("clubId"), validate, recruitment.create);

router.put("/:id", ...auth, id, clubUpdateRules, validate, c.updateClub);
router.get("/:id/subscription", ...auth, id, validate, c.getSubscription);
router.put("/:id/subscription", ...auth, id, subscriptionRules, validate, c.setSubscription);
router.post("/:id/status", ...auth, restrictTo(GLOBAL_ROLES.ADMIN), id, clubStatusRules, validate, c.changeStatus);
router.put("/:id/mentor", ...auth, restrictTo(GLOBAL_ROLES.ADMIN), id, mongoIdBody("mentorId"), validate, c.setMentor);
router.post("/:id/president", ...auth, id, mongoIdBody("userId"), validate, c.assignPresident);

router.get("/:id/members", ...auth, id, validate, c.listMembers);
router.post("/:id/members", ...auth, id, mongoIdBody("userId"), validate, c.addMember);
router.patch("/:id/members/:userId/role", ...auth, id, mongoIdParam("userId"), roleRules, validate, c.changeMemberRole);
router.delete("/:id/members/:userId", ...auth, id, mongoIdParam("userId"), validate, c.removeMember);

router.post("/:id/leave", ...auth, id, validate, c.leaveClub);

// The club's own roles and the presidency handover.
router.get("/:id/roles", ...auth, id, validate, c.listRoles);
router.post("/:id/roles", ...auth, id, clubRoleRules(true), validate, c.createRole);
router.put("/:id/roles/:key", ...auth, id, clubRoleRules(false), validate, c.updateRole);
router.delete("/:id/roles/:key", ...auth, id, validate, c.deleteRole);
router.post("/:id/president/transfer", ...auth, id, mongoIdBody("userId"), validate, c.transferPresidency);

module.exports = router;
