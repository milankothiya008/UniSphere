const express = require("express");

const {
    joinClub,
    getClubMembers,
    leaveClub,
    getUserClubs
} = require("../controllers/membershipController");

const router = express.Router();


// Join club
router.post(
    "/clubs/:clubId/join",
    joinClub
);


// Get club members
router.get(
    "/clubs/:clubId/members",
    getClubMembers
);


// Leave club
router.delete(
    "/clubs/:clubId/leave",
    leaveClub
);


// Get user's clubs
router.get(
    "/users/:userId/clubs",
    getUserClubs
);


module.exports = router;