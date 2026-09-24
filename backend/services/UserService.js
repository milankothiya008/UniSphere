const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_PUBLIC_FIELDS, ACCOUNT_TYPES, GLOBAL_ROLES } = require("../constants/Roles");
const { searchRegex } = require("../utils/Query");
const adminService = require("./AdminService");

const getAllUsers = async (actor, query) => adminService.listUsers(actor, query);

const getUserById = async (actor, id) => adminService.getUserById(actor, id);

const updateUser = async (actor, id, data) => {
    if (String(actor._id) !== String(id)) {
        throw new AppError("You can only update your own profile", 403, ERROR_CODES.FORBIDDEN);
    }

    const allowed = {};
    if (data.name !== undefined) {
        allowed.name = String(data.name).trim();
    }

    const user = await User.findByIdAndUpdate(id, allowed, {
        returnDocument: "after",
        runValidators: true
    }).select(USER_PUBLIC_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return user;
};

// Lightweight directory lookup used by pickers (founding members, president, award recipients).
const searchUsers = async (query = {}) => {
    const filter = {
        isActive: true,
        isEmailVerified: true,
        $or: [{ name: searchRegex(query.q) }, { email: searchRegex(query.q) }]
    };

    if (query.accountType) {
        filter.accountType = String(query.accountType).toUpperCase();
    }

    // Faculty searches pick mentors, and the university admin cannot be one.
    if (filter.accountType === ACCOUNT_TYPES.FACULTY) {
        filter.globalRole = GLOBAL_ROLES.FACULTY;
    }

    if (query.departments) {
        filter.departmentCode = { $in: String(query.departments).toUpperCase().split(",").filter(Boolean) };
    }

    return User.find(filter).select("name email accountType departmentCode batchCode").sort({ name: 1 }).limit(10);
};

module.exports = {
    getAllUsers,
    getUserById,
    updateUser,
    searchUsers,
    setUserActive: adminService.setUserActive
};
