const membershipService =
    require("../services/membershipService");

const asyncHandler =
    require("../utils/asyncHandler");


// JOIN CLUB
const joinClub = asyncHandler(async (req, res) => {

    const membership =
        await membershipService.joinClub(
            req.params.clubId,
            req.body.userId
        );


    res.status(201).json({
        success: true,
        message: "Membership request submitted successfully",
        membership
    });
});


// GET CLUB MEMBERS
const getClubMembers = asyncHandler(async (req, res) => {

    const members =
        await membershipService.getClubMembers(
            req.params.clubId
        );


    res.status(200).json({
        success: true,
        count: members.length,
        members
    });
});


// LEAVE CLUB
const leaveClub = asyncHandler(async (req, res) => {

    await membershipService.leaveClub(
        req.params.clubId,
        req.body.userId
    );


    res.status(200).json({
        success: true,
        message: "Successfully left the club"
    });
});


// GET USER CLUBS
const getUserClubs = asyncHandler(async (req, res) => {

    const memberships =
        await membershipService.getUserClubs(
            req.params.userId
        );


    res.status(200).json({
        success: true,
        count: memberships.length,
        memberships
    });
});


module.exports = {
    joinClub,
    getClubMembers,
    leaveClub,
    getUserClubs
};