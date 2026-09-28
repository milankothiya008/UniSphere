const clubService = require("../services/ClubService");
const membershipService = require("../services/MembershipService");
const subscriptionService = require("../services/SubscriptionService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const listClubs = asyncHandler(async (req, res) => {
    const { items, ...meta } = await clubService.listClubs(req.user, req.query);
    sendSuccess(res, 200, "Clubs fetched", items, { meta });
});

const myClubs = asyncHandler(async (req, res) => {
    const data = await clubService.getMyClubs(req.user);
    sendSuccess(res, 200, "Your clubs fetched", data);
});

const getClub = asyncHandler(async (req, res) => {
    const club = await clubService.getClub(req.user, req.params.id);
    sendSuccess(res, 200, "Club fetched", club);
});

const updateClub = asyncHandler(async (req, res) => {
    const club = await clubService.updateClub(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Club updated", club);
});

const changeStatus = asyncHandler(async (req, res) => {
    const club = await clubService.changeClubStatus(req.user, req.params.id, req.body.status, req.body.reason);
    sendSuccess(res, 200, "Club status updated", club);
});

const setMentor = asyncHandler(async (req, res) => {
    const club = await clubService.setMentor(req.user, req.params.id, req.body.mentorId);
    sendSuccess(res, 200, "Faculty mentor assigned", club);
});

const assignPresident = asyncHandler(async (req, res) => {
    const club = await clubService.assignPresident(req.user, req.params.id, req.body.userId);
    sendSuccess(res, 200, "President appointed", club);
});

const listMembers = asyncHandler(async (req, res) => {
    const members = await clubService.listClubMembers(req.user, req.params.id);
    sendSuccess(res, 200, "Club members fetched", members, { meta: { total: members.length } });
});

const addMember = asyncHandler(async (req, res) => {
    const membership = await membershipService.addMember(req.user, req.params.id, req.body.userId);
    sendSuccess(res, 201, "Member added", membership);
});

const removeMember = asyncHandler(async (req, res) => {
    await membershipService.removeMember(req.user, req.params.id, req.params.userId);
    sendSuccess(res, 200, "Member removed");
});

const changeMemberRole = asyncHandler(async (req, res) => {
    const membership = await membershipService.changeMemberRole(req.user, req.params.id, req.params.userId, req.body.role);
    sendSuccess(res, 200, "Member role updated", membership);
});

const leaveClub = asyncHandler(async (req, res) => {
    await membershipService.leaveClub(req.user, req.params.id);
    sendSuccess(res, 200, "You left the club");
});

const getSubscription = asyncHandler(async (req, res) => {
    const result = await subscriptionService.getSubscription(req.user, req.params.id);
    sendSuccess(res, 200, "Club notifications fetched", result);
});

const setSubscription = asyncHandler(async (req, res) => {
    const result = await subscriptionService.setSubscription(req.user, req.params.id, req.body.enabled);
    sendSuccess(res, 200, result.subscribed ? "Notifications turned on" : "Notifications turned off", result);
});

module.exports = {
    getSubscription,
    setSubscription,
    listClubs,
    myClubs,
    getClub,
    updateClub,
    changeStatus,
    setMentor,
    assignPresident,
    listMembers,
    addMember,
    removeMember,
    changeMemberRole,
    leaveClub
};
