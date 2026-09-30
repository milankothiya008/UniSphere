const User = require("../models/User");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_ACCOUNT_FIELDS, ACCOUNT_TYPES, GLOBAL_ROLES } = require("../constants/Roles");
const { searchRegex } = require("../utils/Query");
const { normalizePhone } = require("../utils/Phone");
const { MEMBERSHIP_STATUS } = require("../constants/Statuses");
const adminService = require("./AdminService");

const getAllUsers = async (actor, query) => adminService.listUsers(actor, query);

const getUserById = async (actor, id) => adminService.getUserById(actor, id);

// Club members must keep a mobile number on file, so they can change it but not remove it.
const phoneUpdate = async (userId, value) => {
    if (value === null || String(value).trim() === "") {
        if (await ClubMembership.exists({ user: userId, status: MEMBERSHIP_STATUS.APPROVED })) {
            throw new AppError("Club members need a mobile number, so it can be changed but not removed", 400, ERROR_CODES.PHONE_REQUIRED);
        }
        return null;
    }
    const phone = normalizePhone(value);
    if (!phone) {
        throw new AppError("Enter a valid 10-digit Indian mobile number", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    return phone;
};

const updateUser = async (actor, id, data) => {
    if (String(actor._id) !== String(id)) {
        throw new AppError("You can only update your own profile", 403, ERROR_CODES.FORBIDDEN);
    }

    const allowed = {};
    if (data.name !== undefined) {
        allowed.name = String(data.name).trim();
    }
    if (data.phone !== undefined) {
        allowed.phone = await phoneUpdate(id, data.phone);
    }

    const user = await User.findByIdAndUpdate(id, allowed, {
        returnDocument: "after",
        runValidators: true
    }).select(USER_ACCOUNT_FIELDS);

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
