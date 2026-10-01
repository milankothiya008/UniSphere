const User = require("../models/User");
const ClubMembership = require("../models/ClubMembership");
const Club = require("../models/Club");
const { roleName, roleRank } = require("../utils/ClubRoles");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { USER_ACCOUNT_FIELDS, ACCOUNT_TYPES, GLOBAL_ROLES } = require("../constants/Roles");
const { searchRegex } = require("../utils/Query");
const { normalizePhone } = require("../utils/Phone");
const { MEMBERSHIP_STATUS, CLUB_STATUS } = require("../constants/Statuses");
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

/**
 * What anyone signed in sees on someone's profile page: name, role, department and batch, and the
 * active clubs they belong to or mentor. Personal details (email, mobile number) and their event
 * schedule, registrations and applications are never included — only the person sees those, on
 * their own profile.
 */
const getPublicProfile = async (actor, id) => {
    const user = await User.findOne({ _id: id, isActive: true, isEmailVerified: true }).select("name accountType globalRole departmentCode batchCode createdAt").lean();
    if (!user) {
        throw new AppError("Profile not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const [memberships, mentored] = await Promise.all([
        ClubMembership.find({ user: user._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club role joinedAt").populate("club", "name logo category status roles").lean(),
        user.globalRole === GLOBAL_ROLES.FACULTY ? Club.find({ mentor: user._id, status: CLUB_STATUS.ACTIVE }).select("name logo category").sort({ name: 1 }).lean() : []
    ]);
    const clubs = memberships
        .filter((membership) => membership.club?.status === CLUB_STATUS.ACTIVE)
        .sort((a, b) => roleRank(a.club, a.role) - roleRank(b.club, b.role))
        .map((membership) => ({
            club: { _id: membership.club._id, name: membership.club.name, logo: membership.club.logo, category: membership.club.category },
            role: membership.role,
            roleName: roleName(membership.club, membership.role)
        }));
    return {
        _id: user._id,
        name: user.name,
        accountType: user.accountType,
        globalRole: user.globalRole,
        departmentCode: user.departmentCode,
        batchCode: user.batchCode,
        joinedAt: user.createdAt,
        isSelf: String(actor._id) === String(user._id),
        clubs,
        mentoredClubs: mentored
    };
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
    getPublicProfile,
    getAllUsers,
    getUserById,
    updateUser,
    searchUsers,
    setUserActive: adminService.setUserActive
};
