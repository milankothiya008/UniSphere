const Club = require("../models/Club");
const CoordinatorAssignment = require("../models/CoordinatorAssignment");
const ClubMembership = require("../models/ClubMembership");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_STATUS, MEMBERSHIP_STATUS, AUDIT_ACTIONS } = require("../constants/Statuses");
const { GLOBAL_ROLES, MEMBERSHIP_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const {
    assertAdmin,
    assertCoordinatorAssigned,
    assertClubPresident,
    isAdmin
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { withTransaction, maybeSession } = require("../utils/Transaction");

const getAllClubs = async (query = {}) => {
    const { search, category, status, page = 1, limit = 10 } = query;
    const filter = {};

    if (search) {
        filter.name = { $regex: search, $options: "i" };
    }

    if (category) {
        filter.category = category.toUpperCase();
    }

    if (status) {
        filter.status = status.toUpperCase();
    }

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const clubs = await Club.find(filter)
        .populate("president", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber);

    const totalClubs = await Club.countDocuments(filter);

    return {
        clubs,
        totalClubs,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalClubs / limitNumber) || 1,
        limit: limitNumber
    };
};

const getClubById = async (clubId) => {
    const club = await Club.findById(clubId).populate("president", "name email");

    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return club;
};

const updateClub = async (actor, clubId, clubData) => {
    const club = await getClubById(clubId);

    if (!isAdmin(actor)) {
        await assertCoordinatorAssigned(actor, clubId);
    }

    const allowed = ["description", "purpose", "logo", "category"];
    allowed.forEach((field) => {
        if (clubData[field] !== undefined) {
            club[field] = clubData[field];
        }
    });

    if (clubData.name !== undefined && isAdmin(actor)) {
        club.name = clubData.name;
    }

    await club.save();
    return club.populate("president", "name email");
};

const changeClubStatus = async (actor, clubId, status, reason = null) => {
    assertAdmin(actor);

    const allowed = [CLUB_STATUS.ACTIVE, CLUB_STATUS.SUSPENDED, CLUB_STATUS.ARCHIVED, CLUB_STATUS.APPROVED];

    if (!allowed.includes(status)) {
        throw new AppError("Invalid club status transition", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const club = await getClubById(clubId);
    const from = club.status;

    if (status === CLUB_STATUS.ACTIVE && !club.president) {
        throw new AppError("A president must be assigned before the club can become active", 409, ERROR_CODES.INVALID_STATE);
    }

    club.status = status;
    await club.save();

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_STATUS_CHANGED,
        actor: actor._id,
        targetType: "Club",
        targetId: club._id,
        fromState: from,
        toState: status,
        reason
    });

    return club;
};

const assignCoordinator = async (actor, clubId, coordinatorId) => {
    assertAdmin(actor);

    const club = await getClubById(clubId);
    const coordinator = await User.findById(coordinatorId);

    if (!coordinator) {
        throw new AppError("Coordinator user not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (coordinator.globalRole !== GLOBAL_ROLES.COORDINATOR) {
        throw new AppError("User is not a coordinator", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    await CoordinatorAssignment.findOneAndUpdate(
        { coordinator: coordinatorId, club: clubId },
        { isActive: true, assignedBy: actor._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recordAudit({
        action: AUDIT_ACTIONS.COORDINATOR_ASSIGNED,
        actor: actor._id,
        targetType: "Club",
        targetId: club._id,
        metadata: { coordinatorId }
    });

    return club;
};

const unassignCoordinator = async (actor, clubId, coordinatorId) => {
    assertAdmin(actor);

    const assignment = await CoordinatorAssignment.findOne({ coordinator: coordinatorId, club: clubId });

    if (!assignment) {
        throw new AppError("Assignment not found", 404, ERROR_CODES.NOT_FOUND);
    }

    assignment.isActive = false;
    await assignment.save();

    await recordAudit({
        action: AUDIT_ACTIONS.COORDINATOR_UNASSIGNED,
        actor: actor._id,
        targetType: "Club",
        targetId: clubId,
        metadata: { coordinatorId }
    });

    return assignment;
};

const listClubCoordinators = async (clubId) => {
    await getClubById(clubId);

    return CoordinatorAssignment.find({ club: clubId, isActive: true }).populate(
        "coordinator",
        "name email departmentCode"
    );
};

const assignPresident = async (actor, clubId, userId) => {
    await assertCoordinatorAssigned(actor, clubId);

    const club = await getClubById(clubId);
    const user = await User.findById(userId);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (!user.isEmailVerified || user.accountType !== ACCOUNT_TYPES.STUDENT) {
        throw new AppError("President must be a verified student", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return withTransaction(async (session) => {
        if (club.president) {
            await ClubMembership.updateOne(
                { club: clubId, user: club.president, role: MEMBERSHIP_ROLES.PRESIDENT },
                { role: MEMBERSHIP_ROLES.MEMBER },
                maybeSession(session)
            );
        }

        await ClubMembership.findOneAndUpdate(
            { club: clubId, user: userId },
            {
                role: MEMBERSHIP_ROLES.PRESIDENT,
                status: MEMBERSHIP_STATUS.APPROVED,
                joinedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true, ...maybeSession(session) }
        );

        const previous = club.president;
        club.president = userId;

        if (club.status === CLUB_STATUS.APPROVED) {
            club.status = CLUB_STATUS.ACTIVE;
        }

        await club.save(maybeSession(session));

        await recordAudit({
            action: AUDIT_ACTIONS.PRESIDENT_ASSIGNED,
            actor: actor._id,
            targetType: "Club",
            targetId: club._id,
            metadata: { previousPresident: previous, presidentId: userId },
            session
        });

        return club.populate("president", "name email");
    });
};

const addMember = async (actor, clubId, userId) => {
    await assertClubPresident(actor, clubId);

    const club = await getClubById(clubId);

    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Members can only be added to an active club", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    const user = await User.findById(userId);

    if (!user || !user.isEmailVerified) {
        throw new AppError("Only verified university users can be added", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const existing = await ClubMembership.findOne({ club: clubId, user: userId });

    if (existing) {
        if (existing.status === MEMBERSHIP_STATUS.APPROVED) {
            throw new AppError("User is already a member", 409, ERROR_CODES.CONFLICT);
        }

        existing.status = MEMBERSHIP_STATUS.APPROVED;
        existing.role = MEMBERSHIP_ROLES.MEMBER;
        existing.joinedAt = new Date();
        await existing.save();
        return existing.populate("user", "name email");
    }

    const membership = await ClubMembership.create({
        club: clubId,
        user: userId,
        role: MEMBERSHIP_ROLES.MEMBER,
        status: MEMBERSHIP_STATUS.APPROVED,
        joinedAt: new Date()
    });

    return membership.populate("user", "name email");
};

const removeMember = async (actor, clubId, userId) => {
    await assertClubPresident(actor, clubId);

    const membership = await ClubMembership.findOne({ club: clubId, user: userId });

    if (!membership || membership.status !== MEMBERSHIP_STATUS.APPROVED) {
        throw new AppError("User is not a member of this club", 404, ERROR_CODES.NOT_FOUND);
    }

    if (membership.role === MEMBERSHIP_ROLES.PRESIDENT) {
        throw new AppError("President cannot be removed by membership management", 400, ERROR_CODES.FORBIDDEN);
    }

    await ClubMembership.deleteOne({ _id: membership._id });
};

const getClubMembers = async (actor, clubId) => {
    await getClubById(clubId);

    if (!isAdmin(actor)) {
        try {
            await assertCoordinatorAssigned(actor, clubId);
        } catch (error) {
            await assertClubPresident(actor, clubId);
        }
    }

    return ClubMembership.find({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED })
        .populate("user", "name email departmentCode batchCode")
        .sort({ role: 1, joinedAt: -1 });
};

const getUserClubs = async (userId) => {
    return ClubMembership.find({ user: userId, status: MEMBERSHIP_STATUS.APPROVED })
        .populate("club", "name category logo status")
        .sort({ joinedAt: -1 });
};

const getAssignedClubs = async (actor) => {
    if (isAdmin(actor)) {
        return Club.find({ status: { $in: [CLUB_STATUS.APPROVED, CLUB_STATUS.ACTIVE] } }).populate(
            "president",
            "name email"
        );
    }

    const assignments = await CoordinatorAssignment.find({
        coordinator: actor._id,
        isActive: true
    }).populate({
        path: "club",
        populate: { path: "president", select: "name email" }
    });

    return assignments.map((item) => item.club).filter(Boolean);
};

module.exports = {
    getAllClubs,
    getClubById,
    updateClub,
    changeClubStatus,
    assignCoordinator,
    unassignCoordinator,
    listClubCoordinators,
    assignPresident,
    addMember,
    removeMember,
    getClubMembers,
    getUserClubs,
    getAssignedClubs
};
