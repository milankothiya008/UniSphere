const clubService = require("../services/ClubService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getAllClubs = asyncHandler(async (req, res) => {
    const result = await clubService.getAllClubs(req.query);
    sendSuccess(res, 200, "Clubs fetched successfully", result.clubs, {
        totalClubs: result.totalClubs,
        currentPage: result.currentPage,
        totalPages: result.totalPages,
        limit: result.limit
    });
});

const getClubById = asyncHandler(async (req, res) => {
    const club = await clubService.getClubById(req.params.id);
    sendSuccess(res, 200, "Club fetched successfully", club);
});

const updateClub = asyncHandler(async (req, res) => {
    const club = await clubService.updateClub(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Club updated successfully", club);
});

const changeStatus = asyncHandler(async (req, res) => {
    const club = await clubService.changeClubStatus(req.user, req.params.id, req.body.status, req.body.reason);
    sendSuccess(res, 200, "Club status updated", club);
});

const assignCoordinator = asyncHandler(async (req, res) => {
    const club = await clubService.assignCoordinator(req.user, req.params.id, req.body.coordinatorId);
    sendSuccess(res, 200, "Coordinator assigned", club);
});

const unassignCoordinator = asyncHandler(async (req, res) => {
    const assignment = await clubService.unassignCoordinator(req.user, req.params.id, req.params.coordinatorId);
    sendSuccess(res, 200, "Coordinator unassigned", assignment);
});

const listCoordinators = asyncHandler(async (req, res) => {
    const coordinators = await clubService.listClubCoordinators(req.params.id);
    sendSuccess(res, 200, "Club coordinators fetched", coordinators);
});

const assignPresident = asyncHandler(async (req, res) => {
    const club = await clubService.assignPresident(req.user, req.params.id, req.body.userId);
    sendSuccess(res, 200, "President assigned", club);
});

const addMember = asyncHandler(async (req, res) => {
    const membership = await clubService.addMember(req.user, req.params.id, req.body.userId);
    sendSuccess(res, 201, "Member added", membership);
});

const removeMember = asyncHandler(async (req, res) => {
    await clubService.removeMember(req.user, req.params.id, req.params.userId);
    sendSuccess(res, 200, "Member removed");
});

const getMembers = asyncHandler(async (req, res) => {
    const members = await clubService.getClubMembers(req.user, req.params.id);
    sendSuccess(res, 200, "Club members fetched", members, { count: members.length });
});

module.exports = {
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
};
