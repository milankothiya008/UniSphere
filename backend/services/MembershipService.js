const ClubMembership = require("../models/ClubMembership");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_STATUS, MEMBERSHIP_STATUS, AUDIT_ACTIONS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { CLUB_ROLES, ACCOUNT_TYPES, GLOBAL_ROLES } = require("../constants/Roles");
const { CLUB_PERMISSIONS, CLUB_ROLE_PERMISSIONS, roleHasPermission } = require("../constants/Permissions");
const {
    assertStudent,
    assertVerified,
    contextHas,
    assertClubPermission,
    loadClub
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { assertStudentsMatchScope } = require("../utils/DepartmentScope");

const clubLink = (club) => `/clubs/${club._id}`;

// Approved members whose club role grants the permission (e.g. who should hear about join requests).
const clubUsersWithPermission = async (clubId, permission) => {
    const roles = Object.keys(CLUB_ROLE_PERMISSIONS).filter((role) => roleHasPermission(role, permission));
    const members = await ClubMembership.find({
        club: clubId,
        status: MEMBERSHIP_STATUS.APPROVED,
        role: { $in: roles }
    }).select("user");
    return members.map((member) => member.user);
};

const approvedMemberIds = async (clubId) => {
    const members = await ClubMembership.find({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED }).select("user");
    return members.map((member) => member.user);
};

const auditMembership = (action, actor, club, membership, fromState, toState, reason = null, metadata = {}) =>
    recordAudit({
        action,
        actor: actor._id,
        targetType: "ClubMembership",
        targetId: membership._id,
        fromState,
        toState,
        reason,
        metadata: { clubId: club._id, userId: membership.user?._id || membership.user, ...metadata }
    });

const requestToJoin = async (actor, clubId, message = null) => {
    assertVerified(actor);
    assertStudent(actor, "Only students can join clubs");

    const club = await loadClub(clubId);

    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("This club is not accepting members right now", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    assertStudentsMatchScope([actor], club, { self: true, clubName: club.name });

    let membership = await ClubMembership.findOne({ club: club._id, user: actor._id });

    if (membership?.status === MEMBERSHIP_STATUS.APPROVED) {
        throw new AppError("You are already a member of this club", 409, ERROR_CODES.CONFLICT);
    }

    if (membership?.status === MEMBERSHIP_STATUS.PENDING) {
        throw new AppError("Your membership request is already pending", 409, ERROR_CODES.CONFLICT);
    }

    const from = membership?.status || null;

    if (membership) {
        membership.status = MEMBERSHIP_STATUS.PENDING;
        membership.role = CLUB_ROLES.MEMBER;
        membership.requestMessage = message || null;
        membership.decidedBy = null;
        membership.decidedAt = null;
        membership.decisionReason = null;
        await membership.save();
    } else {
        try {
            membership = await ClubMembership.create({
                club: club._id,
                user: actor._id,
                role: CLUB_ROLES.MEMBER,
                status: MEMBERSHIP_STATUS.PENDING,
                requestMessage: message || null
            });
        } catch (error) {
            if (error.code === 11000) {
                throw new AppError("Your membership request is already pending", 409, ERROR_CODES.CONFLICT);
            }
            throw error;
        }
    }

    await auditMembership(AUDIT_ACTIONS.MEMBERSHIP_REQUESTED, actor, club, membership, from, MEMBERSHIP_STATUS.PENDING);

    await notify(await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MANAGE_MEMBERS), {
        type: NOTIFICATION_TYPES.MEMBERSHIP_REQUEST,
        title: `New membership request for ${club.name}`,
        message: `${actor.name} wants to join.${message ? ` "${message}"` : ""}`,
        link: `/clubs/${club._id}/members`
    });

    return membership;
};

const cancelJoinRequest = async (actor, clubId) => {
    const result = await ClubMembership.deleteOne({
        club: clubId,
        user: actor._id,
        status: MEMBERSHIP_STATUS.PENDING
    });

    if (!result.deletedCount) {
        throw new AppError("No pending membership request found", 404, ERROR_CODES.NOT_FOUND);
    }
};

const leaveClub = async (actor, clubId) => {
    const club = await loadClub(clubId);
    const membership = await ClubMembership.findOne({ club: club._id, user: actor._id, status: MEMBERSHIP_STATUS.APPROVED });

    if (!membership) {
        throw new AppError("You are not a member of this club", 404, ERROR_CODES.NOT_FOUND);
    }

    if (membership.role === CLUB_ROLES.PRESIDENT) {
        throw new AppError("The president cannot leave until the mentor appoints a new president", 409, ERROR_CODES.INVALID_STATE);
    }

    await ClubMembership.deleteOne({ _id: membership._id });
    await auditMembership(AUDIT_ACTIONS.MEMBER_LEFT, actor, club, membership, MEMBERSHIP_STATUS.APPROVED, null);
};

const listJoinRequests = async (actor, clubId, query = {}) => {
    const { club } = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.MANAGE_MEMBERS, "You cannot manage members of this club");
    const status = Object.values(MEMBERSHIP_STATUS).includes(query.status) ? query.status : MEMBERSHIP_STATUS.PENDING;

    return ClubMembership.find({ club: club._id, status })
        .populate("user", "name email departmentCode batchCode")
        .populate("decidedBy", "name")
        .sort({ createdAt: 1 });
};

const decideJoinRequest = async (actor, clubId, membershipId, approve, reason = null) => {
    const { club } = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.MANAGE_MEMBERS, "You cannot manage members of this club");
    const membership = await ClubMembership.findOne({ _id: membershipId, club: club._id });

    if (!membership) {
        throw new AppError("Membership request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (String(membership.user) === String(actor._id)) {
        throw new AppError("You cannot decide your own membership request", 403, ERROR_CODES.FORBIDDEN);
    }

    if (membership.status !== MEMBERSHIP_STATUS.PENDING) {
        throw new AppError("This request has already been decided", 409, ERROR_CODES.INVALID_STATE);
    }

    if (approve) {
        assertStudentsMatchScope([await User.findById(membership.user)], club, { clubName: club.name });
    }

    membership.status = approve ? MEMBERSHIP_STATUS.APPROVED : MEMBERSHIP_STATUS.REJECTED;
    membership.decidedBy = actor._id;
    membership.decidedAt = new Date();
    membership.decisionReason = reason || null;
    if (approve) {
        membership.joinedAt = new Date();
        membership.role = CLUB_ROLES.MEMBER;
    }
    await membership.save();

    await auditMembership(
        approve ? AUDIT_ACTIONS.MEMBERSHIP_APPROVED : AUDIT_ACTIONS.MEMBERSHIP_REJECTED,
        actor,
        club,
        membership,
        MEMBERSHIP_STATUS.PENDING,
        membership.status,
        reason
    );

    await notify(membership.user, {
        type: approve ? NOTIFICATION_TYPES.MEMBERSHIP_APPROVED : NOTIFICATION_TYPES.MEMBERSHIP_REJECTED,
        title: approve ? `Welcome to ${club.name}!` : `Membership request for ${club.name} declined`,
        message: approve ? "Your membership request was approved." : reason || "",
        link: clubLink(club),
        email: true
    });

    return membership.populate("user", "name email departmentCode batchCode");
};

const findApprovedMember = async (clubId, userId) => {
    const membership = await ClubMembership.findOne({ club: clubId, user: userId, status: MEMBERSHIP_STATUS.APPROVED });

    if (!membership) {
        throw new AppError("This user is not a member of the club", 404, ERROR_CODES.NOT_FOUND);
    }

    return membership;
};

const changeMemberRole = async (actor, clubId, userId, role) => {
    const { club } = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.ASSIGN_ROLES, "Only the president can assign club roles");

    if (!Object.values(CLUB_ROLES).includes(role) || role === CLUB_ROLES.PRESIDENT) {
        throw new AppError("Invalid role. The president is appointed by the faculty mentor.", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (String(userId) === String(actor._id)) {
        throw new AppError("You cannot change your own club role", 403, ERROR_CODES.FORBIDDEN);
    }

    const membership = await findApprovedMember(club._id, userId);

    if (membership.role === CLUB_ROLES.PRESIDENT) {
        throw new AppError("The president's role can only change when the mentor appoints a new president", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = membership.role;
    membership.role = role;
    await membership.save();

    await recordAudit({
        action: AUDIT_ACTIONS.MEMBER_ROLE_CHANGED,
        actor: actor._id,
        targetType: "ClubMembership",
        targetId: membership._id,
        fromState: from,
        toState: role,
        metadata: { clubId: club._id, userId }
    });

    await notify(userId, {
        type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
        title: `Your role in ${club.name} changed`,
        message: `You are now ${role.replace(/_/g, " ").toLowerCase()}.`,
        link: clubLink(club)
    });

    return membership.populate("user", "name email departmentCode batchCode");
};

const removeMember = async (actor, clubId, userId) => {
    const context = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.MANAGE_MEMBERS, "You cannot manage members of this club");
    const { club } = context;

    if (String(userId) === String(actor._id)) {
        throw new AppError("Use 'leave club' to remove yourself", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const membership = await findApprovedMember(club._id, userId);

    if (membership.role === CLUB_ROLES.PRESIDENT) {
        throw new AppError("The president cannot be removed", 403, ERROR_CODES.FORBIDDEN);
    }

    // Removing an office-holder is reserved for whoever can assign roles (the president).
    if (membership.role !== CLUB_ROLES.MEMBER && !contextHas(context, CLUB_PERMISSIONS.ASSIGN_ROLES)) {
        throw new AppError("Only the president can remove club officers", 403, ERROR_CODES.FORBIDDEN);
    }

    await ClubMembership.deleteOne({ _id: membership._id });
    await auditMembership(AUDIT_ACTIONS.MEMBER_REMOVED, actor, club, membership, membership.role, null);
};

// Direct add (e.g. founders or students who joined offline); the student still has to be a verified student.
const addMember = async (actor, clubId, userId) => {
    const { club } = await assertClubPermission(actor, clubId, CLUB_PERMISSIONS.MANAGE_MEMBERS, "You cannot manage members of this club");

    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Members can only be added to an active club", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    const user = await User.findById(userId);

    if (!user || !user.isEmailVerified || !user.isActive || user.accountType !== ACCOUNT_TYPES.STUDENT || user.globalRole !== GLOBAL_ROLES.STUDENT) {
        throw new AppError("Only verified students can be added", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    assertStudentsMatchScope([user], club, { clubName: club.name });

    const existing = await ClubMembership.findOne({ club: club._id, user: userId });

    if (existing?.status === MEMBERSHIP_STATUS.APPROVED) {
        throw new AppError("User is already a member", 409, ERROR_CODES.CONFLICT);
    }

    const membership = existing || new ClubMembership({ club: club._id, user: userId });
    const from = existing?.status || null;
    membership.status = MEMBERSHIP_STATUS.APPROVED;
    membership.role = CLUB_ROLES.MEMBER;
    membership.joinedAt = new Date();
    membership.decidedBy = actor._id;
    membership.decidedAt = new Date();
    await membership.save();

    await auditMembership(AUDIT_ACTIONS.MEMBERSHIP_APPROVED, actor, club, membership, from, MEMBERSHIP_STATUS.APPROVED, null, { direct: true });

    await notify(userId, {
        type: NOTIFICATION_TYPES.MEMBERSHIP_APPROVED,
        title: `You were added to ${club.name}`,
        message: `${actor.name} added you as a member.`,
        link: clubLink(club)
    });

    return membership.populate("user", "name email departmentCode batchCode");
};

const getUserClubs = async (actor, userId) => {
    const allowed = String(actor._id) === String(userId) || actor.globalRole === GLOBAL_ROLES.ADMIN;

    if (!allowed) {
        throw new AppError("You cannot view another user's clubs", 403, ERROR_CODES.FORBIDDEN);
    }

    return ClubMembership.find({ user: userId, status: MEMBERSHIP_STATUS.APPROVED })
        .populate("club", "name category logo status")
        .sort({ joinedAt: -1 });
};

module.exports = {
    requestToJoin,
    cancelJoinRequest,
    leaveClub,
    listJoinRequests,
    decideJoinRequest,
    changeMemberRole,
    removeMember,
    addMember,
    getUserClubs,
    clubUsersWithPermission,
    approvedMemberIds
};
