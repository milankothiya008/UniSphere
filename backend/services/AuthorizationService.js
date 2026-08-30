const CoordinatorAssignment = require("../models/CoordinatorAssignment");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, MEMBERSHIP_ROLES } = require("../constants/Roles");
const { MEMBERSHIP_STATUS } = require("../constants/Statuses");

const isAdmin = (user) => user.globalRole === GLOBAL_ROLES.UNIVERSITY_ADMIN;

const isCoordinator = (user) => user.globalRole === GLOBAL_ROLES.COORDINATOR;

const assertAdmin = (user) => {
    if (!isAdmin(user)) {
        throw new AppError("University admin access required", 403, ERROR_CODES.FORBIDDEN);
    }
};

const assertCoordinatorRole = (user) => {
    if (!isCoordinator(user) && !isAdmin(user)) {
        throw new AppError("Coordinator access required", 403, ERROR_CODES.FORBIDDEN);
    }
};

const isCoordinatorAssignedToClub = async (userId, clubId) => {
    const assignment = await CoordinatorAssignment.findOne({
        coordinator: userId,
        club: clubId,
        isActive: true
    });

    return Boolean(assignment);
};

const assertCoordinatorAssigned = async (user, clubId) => {
    if (isAdmin(user)) {
        return;
    }

    if (!isCoordinator(user)) {
        throw new AppError("Coordinator access required", 403, ERROR_CODES.FORBIDDEN);
    }

    const assigned = await isCoordinatorAssignedToClub(user._id, clubId);

    if (!assigned) {
        throw new AppError("You are not assigned to this club", 403, ERROR_CODES.FORBIDDEN);
    }
};

const getMembership = async (userId, clubId) => {
    return ClubMembership.findOne({
        club: clubId,
        user: userId,
        status: MEMBERSHIP_STATUS.APPROVED
    });
};

const assertClubPresident = async (user, clubId) => {
    if (isAdmin(user)) {
        return;
    }

    const membership = await getMembership(user._id, clubId);

    if (!membership || membership.role !== MEMBERSHIP_ROLES.PRESIDENT) {
        throw new AppError("Club president access required", 403, ERROR_CODES.FORBIDDEN);
    }
};

const assertClubMemberOrStaff = async (user, clubId) => {
    if (isAdmin(user)) {
        return { kind: "admin" };
    }

    if (isCoordinator(user) && (await isCoordinatorAssignedToClub(user._id, clubId))) {
        return { kind: "coordinator" };
    }

    const membership = await getMembership(user._id, clubId);

    if (!membership) {
        throw new AppError("Club membership required", 403, ERROR_CODES.FORBIDDEN);
    }

    return { kind: "member", membership };
};

const assertVerified = (user) => {
    if (!user.isEmailVerified) {
        throw new AppError("Email verification required", 403, ERROR_CODES.UNVERIFIED_EMAIL);
    }
};

module.exports = {
    isAdmin,
    isCoordinator,
    assertAdmin,
    assertCoordinatorRole,
    isCoordinatorAssignedToClub,
    assertCoordinatorAssigned,
    getMembership,
    assertClubPresident,
    assertClubMemberOrStaff,
    assertVerified
};
