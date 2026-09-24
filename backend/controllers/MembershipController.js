const membershipService = require("../services/MembershipService");
const clubService = require("../services/ClubService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getMyMemberships = asyncHandler(async (req, res) => {
    const data = await clubService.getMyClubs(req.user);
    sendSuccess(res, 200, "Your memberships fetched", data);
});

const getUserClubs = asyncHandler(async (req, res) => {
    const memberships = await membershipService.getUserClubs(req.user, req.params.userId);
    sendSuccess(res, 200, "User clubs fetched", memberships, { meta: { total: memberships.length } });
});

module.exports = { getMyMemberships, getUserClubs };
