const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const { MEMBERSHIP_STATUS } = require("../constants/Statuses");
const { permissionsFor, roleName } = require("../utils/ClubRoles");

const isAdmin = (user) => user?.globalRole === GLOBAL_ROLES.ADMIN;

const isFaculty = (user) => user?.globalRole === GLOBAL_ROLES.FACULTY;

const isStudent = (user) =>
    user?.globalRole === GLOBAL_ROLES.STUDENT && user?.accountType === ACCOUNT_TYPES.STUDENT;

const forbidden = (message) => new AppError(message, 403, ERROR_CODES.FORBIDDEN);

const assertAdmin = (user) => {
    if (!isAdmin(user)) {
        throw forbidden("University admin access required");
    }
};

const assertFaculty = (user) => {
    if (!isFaculty(user)) {
        throw forbidden("Faculty access required");
    }
};

const assertStudent = (user, message = "Only students can perform this action") => {
    if (!isStudent(user)) {
        throw forbidden(message);
    }
};

const assertVerified = (user) => {
    if (!user?.isEmailVerified) {
        throw new AppError("Email verification required", 403, ERROR_CODES.UNVERIFIED_EMAIL);
    }
};

const loadClub = async (clubOrId) => {
    // Reuse an already-loaded club only when it is a full document (a partial populate may omit the mentor).
    if (clubOrId instanceof Club && clubOrId.isSelected("mentor") && clubOrId.isSelected("status")) {
        return clubOrId;
    }

    const club = await Club.findById(clubOrId?._id || clubOrId);

    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return club;
};

const refId = (value) => String(value?._id || value || "");

const isClubMentor = (user, club) => Boolean(user && club?.mentor && refId(club.mentor) === String(user._id));

const getMembership = async (userId, clubId) => {
    return ClubMembership.findOne({
        club: refId(clubId),
        user: userId,
        status: MEMBERSHIP_STATUS.APPROVED
    });
};

// Resolves everything the backend needs to authorise a user against one club.
const getClubContext = async (user, clubOrId) => {
    const club = await loadClub(clubOrId);
    const membership = user ? await getMembership(user._id, club._id) : null;
    const role = membership?.role || null;

    return {
        club,
        membership,
        role,
        roleName: role ? roleName(club, role) : null,
        isAdmin: isAdmin(user),
        isMentor: isClubMentor(user, club),
        isMember: Boolean(membership),
        permissions: permissionsFor(club, role)
    };
};

// Club permissions come only from the user's own role in that club. The university admin has no
// club-level authority: their club powers are limited to approving club requests, changing club
// status and reassigning the faculty mentor (see ClubRequestService / ClubService).
const contextHas = (context, permission) => context.permissions.includes(permission);

const assertClubPermission = async (user, clubOrId, permission, message = "You do not have permission for this club action") => {
    const context = await getClubContext(user, clubOrId);

    if (!contextHas(context, permission)) {
        throw forbidden(message);
    }

    return context;
};

const assertClubMentor = async (user, clubOrId, message = "Only the club's faculty mentor can perform this action") => {
    const context = await getClubContext(user, clubOrId);

    if (!context.isMentor) {
        throw forbidden(message);
    }

    return context;
};

// Mentors oversee their club, so they can read (not manage) participant and member data.
const assertCanViewParticipants = async (user, clubOrId, permission) => {
    const context = await getClubContext(user, clubOrId);

    if (!context.isMentor && !contextHas(context, permission)) {
        throw forbidden("You do not have access to participant information for this club");
    }

    return context;
};

module.exports = {
    isAdmin,
    isFaculty,
    isStudent,
    assertAdmin,
    assertFaculty,
    assertStudent,
    assertVerified,
    loadClub,
    isClubMentor,
    getMembership,
    getClubContext,
    contextHas,
    assertClubPermission,
    assertClubMentor,
    assertCanViewParticipants
};
