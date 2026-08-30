const userService = require("../services/UserService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getAllUsers = asyncHandler(async (req, res) => {
    const users = await userService.getAllUsers(req.user, req.query);
    sendSuccess(res, 200, "Users fetched successfully", users);
});

const getUserById = asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.user, req.params.id);
    sendSuccess(res, 200, "User fetched successfully", user);
});

const updateUser = asyncHandler(async (req, res) => {
    const user = await userService.updateUser(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "User updated successfully", user);
});

module.exports = {
    getAllUsers,
    getUserById,
    updateUser
};
