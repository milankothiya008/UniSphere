const express = require("express");
const c = require("../controllers/ClubController");
const { listClubEvents } = require("../controllers/EventController");
const { protect, optionalAuth, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const {
    mongoIdParam,
    mongoIdBody,
    clubUpdateRules,
    clubStatusRules,
    joinRules,
    roleRules,
    optionalReasonRules,
    subscriptionRules
} = require("../validators/RequestValidators");

const router = express.Router();
const auth = [protect, requireVerified];
const id = [...mongoIdParam("id")];

router.get("/", optionalAuth, c.listClubs);
router.get("/mine", ...auth, c.myClubs);
router.get("/:id", optionalAuth, id, validate, c.getClub);
router.get("/:clubId/events", optionalAuth, mongoIdParam("clubId"), validate, listClubEvents);

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

router.post("/:id/join", ...auth, id, joinRules, validate, c.requestToJoin);
router.delete("/:id/join", ...auth, id, validate, c.cancelJoinRequest);
router.post("/:id/leave", ...auth, id, validate, c.leaveClub);

router.get("/:id/membership-requests", ...auth, id, validate, c.listJoinRequests);
router.post(
    "/:id/membership-requests/:membershipId/approve",
    ...auth,
    id,
    mongoIdParam("membershipId"),
    validate,
    c.approveJoinRequest
);
router.post(
    "/:id/membership-requests/:membershipId/reject",
    ...auth,
    id,
    mongoIdParam("membershipId"),
    optionalReasonRules,
    validate,
    c.rejectJoinRequest
);

module.exports = router;
