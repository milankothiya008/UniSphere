const Department = require("../models/Department");
const { referenceCache } = require("../utils/Caches");
const AcademicBatch = require("../models/AcademicBatch");
const User = require("../models/User");
const Club = require("../models/Club");
const ClubCreationRequest = require("../models/ClubCreationRequest");
const ClubMembership = require("../models/ClubMembership");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, ACCOUNT_TYPES, USER_PUBLIC_FIELDS, USER_ACCOUNT_FIELDS } = require("../constants/Roles");
const {
    AUDIT_ACTIONS,
    CLUB_REQUEST_STATUS,
    EVENT_STATUS,
    MEMBERSHIP_STATUS,
    REGISTRATION_STATUS
} = require("../constants/Statuses");
const { hashPassword } = require("../utils/Password");
const { parsePagination, paginationMeta, searchRegex } = require("../utils/Query");
const { assertAdmin } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { emailQueueStats } = require("./EmailQueueService");
const { logoutAll } = require("./AuthService");

const pick = (source, fields) =>
    fields.reduce((acc, field) => {
        if (source[field] !== undefined) {
            acc[field] = source[field];
        }
        return acc;
    }, {});

const createDepartment = async (actor, { code, name, isActive = true }) => {
    assertAdmin(actor);

    if (!code || !name) {
        throw new AppError("Code and name are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return Department.create({ code: String(code).toUpperCase(), name, isActive });
};

const listDepartmentsUncached = async (query = {}) => {
    const filter = {};
    if (query.active === "true") {
        filter.isActive = true;
    }
    return Department.find(filter).sort({ code: 1 }).lean();
};

const listDepartments = (query = {}) => referenceCache.remember(`listDepartments:${JSON.stringify(query)}`, () => listDepartmentsUncached(query));

const updateDepartment = async (actor, id, data) => {
    assertAdmin(actor);
    const update = pick(data, ["name", "isActive"]);
    const department = await Department.findByIdAndUpdate(id, update, { returnDocument: "after", runValidators: true });

    if (!department) {
        throw new AppError("Department not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return department;
};

const createBatch = async (actor, { code, label, isActive = true }) => {
    assertAdmin(actor);

    if (!code || !label) {
        throw new AppError("Code and label are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return AcademicBatch.create({ code, label, isActive });
};

const listBatchesUncached = async (query = {}) => {
    const filter = {};
    if (query.active === "true") {
        filter.isActive = true;
    }
    return AcademicBatch.find(filter).sort({ code: -1 }).lean();
};

const listBatches = (query = {}) => referenceCache.remember(`listBatches:${JSON.stringify(query)}`, () => listBatchesUncached(query));

const updateBatch = async (actor, id, data) => {
    assertAdmin(actor);
    const update = pick(data, ["label", "isActive"]);
    const batch = await AcademicBatch.findByIdAndUpdate(id, update, { returnDocument: "after", runValidators: true });

    if (!batch) {
        throw new AppError("Academic batch not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return batch;
};

const listUsers = async (actor, query = {}) => {
    assertAdmin(actor);

    const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 100 });
    const filter = {};

    if (query.role) {
        filter.globalRole = String(query.role).toUpperCase();
    }
    if (query.accountType) {
        filter.accountType = String(query.accountType).toUpperCase();
    }
    if (query.department) {
        filter.departmentCode = String(query.department).toUpperCase();
    }
    if (query.active === "true" || query.active === "false") {
        filter.isActive = query.active === "true";
    }
    if (query.search) {
        filter.$or = [{ name: searchRegex(query.search) }, { email: searchRegex(query.search) }];
    }

    const [items, total] = await Promise.all([
        User.find(filter).select(USER_ACCOUNT_FIELDS).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit),
        User.countDocuments(filter)
    ]);

    return { items, ...paginationMeta(pagination, total) };
};

const getUserById = async (actor, id) => {
    if (!actor || String(actor._id) !== String(id)) {
        assertAdmin(actor);
    }

    const user = await User.findById(id).select(USER_ACCOUNT_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return user;
};

const setUserActive = async (actor, id, isActive) => {
    assertAdmin(actor);

    if (String(actor._id) === String(id)) {
        throw new AppError("You cannot change your own account status", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const user = await User.findById(id).select(USER_ACCOUNT_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const from = user.isActive;
    user.isActive = Boolean(isActive);
    await user.save();

    if (!user.isActive) {
        await logoutAll(user._id);
    }

    await recordAudit({
        action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
        actor: actor._id,
        targetType: "User",
        targetId: user._id,
        fromState: from ? "ACTIVE" : "INACTIVE",
        toState: user.isActive ? "ACTIVE" : "INACTIVE"
    });

    return user;
};

const listFaculty = async (actor, query = {}) => {
    assertAdmin(actor);

    const filter = { globalRole: GLOBAL_ROLES.FACULTY };
    if (query.search) {
        filter.$or = [{ name: searchRegex(query.search) }, { email: searchRegex(query.search) }];
    }

    const faculty = await User.find(filter).select(USER_PUBLIC_FIELDS).sort({ name: 1 }).lean();
    const clubs = await Club.find({ mentor: { $in: faculty.map((f) => f._id) } }).select("name status mentor").lean();

    return faculty.map((member) => ({
        ...member,
        mentoredClubs: clubs.filter((club) => String(club.mentor) === String(member._id))
    }));
};

const getStats = async (actor) => {
    assertAdmin(actor);

    const now = new Date();
    const [
        users,
        students,
        faculty,
        clubsByStatus,
        pendingFacultyReview,
        awaitingAdmin,
        eventsByStatus,
        upcomingEvents,
        registrations,
        memberships,
        venues,
        emails
    ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ globalRole: GLOBAL_ROLES.STUDENT }),
        User.countDocuments({ globalRole: GLOBAL_ROLES.FACULTY }),
        Club.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        ClubCreationRequest.countDocuments({ status: CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW }),
        ClubCreationRequest.countDocuments({ status: CLUB_REQUEST_STATUS.FACULTY_VERIFIED }),
        Event.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        Event.countDocuments({ status: EVENT_STATUS.PUBLISHED, startAt: { $gte: now } }),
        EventRegistration.countDocuments({ status: REGISTRATION_STATUS.REGISTERED }),
        ClubMembership.countDocuments({ status: MEMBERSHIP_STATUS.APPROVED }),
        Venue.countDocuments(),
        emailQueueStats()
    ]);

    const toMap = (rows) => Object.fromEntries(rows.map((row) => [row._id, row.count]));

    return {
        users: { total: users, students, faculty },
        clubs: { total: clubsByStatus.reduce((sum, row) => sum + row.count, 0), byStatus: toMap(clubsByStatus) },
        clubRequests: { pendingFacultyReview, awaitingAdmin },
        events: {
            total: eventsByStatus.reduce((sum, row) => sum + row.count, 0),
            byStatus: toMap(eventsByStatus),
            upcoming: upcomingEvents
        },
        registrations,
        memberships,
        venues,
        emails
    };
};


// Maps role values from the earlier COORDINATOR/UNIVERSITY_ADMIN model onto STUDENT/FACULTY/ADMIN.
const migrateLegacyRoles = async () => {
    await User.collection.updateMany({ globalRole: "UNIVERSITY_ADMIN" }, { $set: { globalRole: GLOBAL_ROLES.ADMIN } });
    await User.collection.updateMany({ globalRole: "COORDINATOR" }, { $set: { globalRole: GLOBAL_ROLES.FACULTY } });
    await User.collection.updateMany(
        { globalRole: { $in: [null, GLOBAL_ROLES.STUDENT] }, accountType: ACCOUNT_TYPES.FACULTY },
        { $set: { globalRole: GLOBAL_ROLES.FACULTY } }
    );
    await User.collection.updateMany({ globalRole: null }, { $set: { globalRole: GLOBAL_ROLES.STUDENT } });
};

// Clubs and club requests used to have a single `departmentCode`; they now have allDepartments + departmentCodes.
const migrateDepartmentScope = async () => {
    const pipeline = [
        {
            $set: {
                allDepartments: { $not: [{ $ifNull: ["$departmentCode", false] }] },
                departmentCodes: { $cond: [{ $ifNull: ["$departmentCode", false] }, ["$departmentCode"], []] }
            }
        },
        { $unset: "departmentCode" }
    ];
    await Club.collection.updateMany({ departmentCode: { $exists: true } }, pipeline);
    await ClubCreationRequest.collection.updateMany({ departmentCode: { $exists: true } }, pipeline);
};

// Join requests were replaced by recruitment drives: requests still waiting are closed with an explanation.
const migrateJoinRequests = async () => {
    await ClubMembership.collection.updateMany(
        { status: "PENDING" },
        { $set: { status: "REJECTED", decidedAt: new Date(), decisionReason: "Clubs now take new members through recruitment drives. Watch the club page for the next one." } }
    );
};

// Clubs get their own editable roles, and duplicate presidents or vice-presidents (possible before) are
// reduced to one — the earliest appointed keeps the seat — before the uniqueness index is built.
const migrateClubRoles = async () => {
    const { DEFAULT_ROLES } = require("../utils/ClubRoles");
    await Club.collection.updateMany({ $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }] }, { $set: { roles: DEFAULT_ROLES() } });
    for (const role of ["PRESIDENT", "VICE_PRESIDENT"]) {
        const duplicates = await ClubMembership.aggregate([
            { $match: { role, status: "APPROVED" } },
            { $sort: { decidedAt: 1, joinedAt: 1, _id: 1 } },
            { $group: { _id: "$club", ids: { $push: "$_id" }, count: { $sum: 1 } } },
            { $match: { count: { $gt: 1 } } }
        ]);
        for (const row of duplicates) {
            await ClubMembership.collection.updateMany({ _id: { $in: row.ids.slice(1) } }, { $set: { role: "MEMBER" } });
        }
    }
    await ClubMembership.syncIndexes();
};

// Drives created before recruitment became role-wise (one shared form and rounds) can't be continued in
// the new shape: they are cancelled, and their applications closed. Indexes are rebuilt for the new shape.
// Venues stored before venue types existed: the auditorium is an auditorium, the rest are halls.
const migrateVenueTypes = async () => {
    const Venue = require("../models/Venue");
    await Venue.updateMany({ type: { $exists: false }, name: /auditorium/i }, { $set: { type: "AUDITORIUM", departmentCodes: [] } });
    await Venue.updateMany({ type: { $exists: false } }, { $set: { type: "HALL", departmentCodes: [] } });
};

const migrateRecruitmentShape = async () => {
    const RecruitmentDrive = require("../models/RecruitmentDrive");
    const RecruitmentApplication = require("../models/RecruitmentApplication");
    const legacy = await RecruitmentDrive.collection.find({ $or: [{ questions: { $exists: true } }, { rounds: { $exists: true } }] }).project({ _id: 1, status: 1 }).toArray();
    if (legacy.length) {
        const ids = legacy.map((drive) => drive._id);
        await RecruitmentDrive.collection.updateMany(
            { _id: { $in: ids }, status: { $nin: ["COMPLETED", "CANCELLED", "REJECTED"] } },
            { $set: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Recruitment was upgraded to role-wise forms and rounds" } }
        );
        await RecruitmentDrive.collection.updateMany({ _id: { $in: ids } }, { $unset: { questions: "", rounds: "" } });
        await RecruitmentApplication.collection.updateMany(
            { drive: { $in: ids }, status: { $nin: ["SELECTED", "ACCEPTED"] } },
            { $set: { status: "WITHDRAWN", closedReason: "Recruitment was upgraded" } }
        );
        await RecruitmentApplication.collection.updateMany({ status: "SELECTED" }, { $set: { status: "ACCEPTED" } });
    }
    await RecruitmentApplication.collection.updateMany({ position: { $exists: false }, positions: { $exists: true } }, [{ $set: { position: { $arrayElemAt: ["$positions", 0] } } }, { $unset: "positions" }]);
    await RecruitmentApplication.syncIndexes();
    await RecruitmentDrive.syncIndexes();
};

const bootstrapAdminIfNeeded = async () => {
    const { env } = require("../config/env");
    const logger = require("../utils/Logger");

    await migrateLegacyRoles();
    await migrateDepartmentScope();
    await migrateJoinRequests();
    await migrateClubRoles();
    await migrateRecruitmentShape();
    await migrateVenueTypes();

    if (!env.bootstrapAdminEmail || !env.bootstrapAdminPassword) {
        return;
    }

    const existingAdmin = await User.findOne({ globalRole: GLOBAL_ROLES.ADMIN });
    if (existingAdmin) {
        return;
    }

    const existing = await User.findOne({ email: env.bootstrapAdminEmail.toLowerCase() });
    if (existing) {
        existing.globalRole = GLOBAL_ROLES.ADMIN;
        existing.accountType = ACCOUNT_TYPES.FACULTY;
        existing.isEmailVerified = true;
        await existing.save();
        logger.info("Existing user promoted to university admin");
        return;
    }

    await User.create({
        name: env.bootstrapAdminName,
        email: env.bootstrapAdminEmail.toLowerCase(),
        password: await hashPassword(env.bootstrapAdminPassword),
        accountType: ACCOUNT_TYPES.FACULTY,
        globalRole: GLOBAL_ROLES.ADMIN,
        isEmailVerified: true
    });

    logger.info("Bootstrap university admin created");
};

module.exports = {
    createDepartment,
    listDepartments,
    updateDepartment,
    createBatch,
    listBatches,
    updateBatch,
    listUsers,
    getUserById,
    setUserActive,
    listFaculty,
    getStats,
    migrateLegacyRoles,
    migrateDepartmentScope,
    migrateJoinRequests,
    migrateClubRoles,
    migrateRecruitmentShape,
    migrateVenueTypes,
    bootstrapAdminIfNeeded
};
