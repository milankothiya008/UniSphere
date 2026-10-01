const userService = require("../services/UserService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getAllUsers = asyncHandler(async (req, res) => {
    const { items, ...meta } = await userService.getAllUsers(req.user, req.query);
    sendSuccess(res, 200, "Users fetched", items, { meta });
});

const searchUsers = asyncHandler(async (req, res) => {
    const users = await userService.searchUsers(req.query);
    sendSuccess(res, 200, "Users found", users);
});

const getProfile = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Profile fetched", await userService.getPublicProfile(req.user, req.params.id));
});

const getUserById = asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.user, req.params.id);
    sendSuccess(res, 200, "User fetched", user);
});

const updateUser = asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Profile updated", user);
});

const setStatus = asyncHandler(async (req, res) => {
    const user = await userService.setUserActive(req.user, req.params.id, req.body.isActive);
    sendSuccess(res, 200, user.isActive ? "Account activated" : "Account deactivated", user);
});

module.exports = {
    getAllUsers,
    searchUsers,
    getUserById,
    getProfile,
    updateUser,
    setStatus
};
