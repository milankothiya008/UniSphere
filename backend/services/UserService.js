const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_PUBLIC_FIELDS } = require("../constants/Roles");
const adminService = require("./AdminService");

const getAllUsers = async (actor, query) => adminService.listUsers(actor, query);

const getUserById = async (actor, id) => adminService.getUserById(actor, id);

const updateUser = async (actor, id, data) => {
    if (String(actor._id) !== String(id)) {
        throw new AppError("You can only update your own profile", 403, ERROR_CODES.FORBIDDEN);
    }

    const allowed = {};
    if (data.name !== undefined) {
        allowed.name = data.name;
    }

    const user = await User.findByIdAndUpdate(id, allowed, {
        new: true,
        runValidators: true
    }).select(USER_PUBLIC_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return user;
};

module.exports = {
    getAllUsers,
    getUserById,
    updateUser
};
