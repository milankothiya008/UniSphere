const ClubCreationRequest = require("../models/ClubCreationRequest");
const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    CLUB_REQUEST_STATUS,
    CLUB_STATUS,
    AUDIT_ACTIONS,
    MEMBERSHIP_STATUS,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { GLOBAL_ROLES, ACCOUNT_TYPES, CLUB_ROLES } = require("../constants/Roles");
const { escapeRegex, parsePagination, paginationMeta } = require("../utils/Query");
const {
    isAdmin,
    isFaculty,
    assertAdmin,
    assertFaculty,
    assertStudent,
    assertVerified
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { withTransaction, maybeSession } = require("../utils/Transaction");
const { describeScope, belongsToScope, resolveScope, assertMentorMatchesScope, assertStudentsMatchScope } = require("../utils/DepartmentScope");

const EDITABLE_FIELDS = ["name", "description", "purpose", "proposedActivities", "reason", "category"];

const REQUEST_LINK = (request) => `/club-requests/${request._id}`;

const populateRequest = (query) =>
    query
        .populate("requester", "name email departmentCode batchCode")
        .populate("foundingMembers", "name email departmentCode batchCode")
        .populate("proposedMentor", "name email departmentCode")
        .populate("verifiedBy", "name email departmentCode")
        .populate("decidedBy", "name email")
        .populate("club", "name status")
        .populate("history.actor", "name");

const findRequest = async (id) => {
    const request = await ClubCreationRequest.findById(id);

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return request;
};

const assertClubNameAvailable = async (name, excludeRequestId = null) => {
    const exact = new RegExp(`^${escapeRegex(String(name).trim())}$`, "i");

    if (await Club.exists({ name: exact })) {
        throw new AppError("A club with this name already exists", 409, ERROR_CODES.CONFLICT);
    }

    const openRequest = await ClubCreationRequest.exists({
        name: exact,
        status: { $nin: [CLUB_REQUEST_STATUS.REJECTED, CLUB_REQUEST_STATUS.APPROVED] },
        ...(excludeRequestId ? { _id: { $ne: excludeRequestId } } : {})
    });

    if (openRequest) {
        throw new AppError("Another request for a club with this name is already in progress", 409, ERROR_CODES.CONFLICT);
    }
};

const resolveFoundingMembers = async (emails = [], requesterId) => {
    const normalized = [...new Set(emails.map((email) => String(email).trim().toLowerCase()).filter(Boolean))];

    if (!normalized.length) {
        return [];
    }

    const users = await User.find({
        email: { $in: normalized },
        accountType: ACCOUNT_TYPES.STUDENT,
        globalRole: GLOBAL_ROLES.STUDENT,
        isEmailVerified: true,
        isActive: true
    }).select("_id name email departmentCode");

    const found = users.map((user) => user.email);
    const missing = normalized.filter((email) => !found.includes(email));

    if (missing.length) {
        throw new AppError(
            `These founding members are not verified CampusConnect students: ${missing.join(", ")}`,
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }

    return users.filter((user) => String(user._id) !== String(requesterId));
};

// The requester and founding members become members on approval, so they must be from the club's departments.
const assertFoundersMatchScope = (requester, founders, scope) => {
    if (!belongsToScope(requester, scope)) {
        throw new AppError(
            `You are in ${requester.departmentCode}, so the club must include ${requester.departmentCode} or be open to all departments.`,
            403,
            ERROR_CODES.NOT_ELIGIBLE
        );
    }
    assertStudentsMatchScope(founders, scope, { clubName: "The club" });
};

// The proposed mentor must be faculty from one of the club's departments (any faculty for an all-departments club).
const resolveProposedMentor = async (mentorId, scope) => {
    if (!mentorId) {
        return null;
    }

    const mentor = await User.findOne({ _id: mentorId, globalRole: GLOBAL_ROLES.FACULTY, isActive: true });

    if (!mentor) {
        throw new AppError("Proposed mentor must be an active faculty member", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    assertMentorMatchesScope(mentor, scope);
    return mentor._id;
};

const pushHistory = (request, action, fromStatus, actor, reason = null) => {
    request.history.push({
        action,
        fromStatus,
        toStatus: request.status,
        actor: actor._id,
        reason
    });
};

const audit = (request, action, actor, fromState, reason = null, metadata = {}, session = null) =>
    recordAudit({
        action,
        actor: actor._id,
        targetType: "ClubCreationRequest",
        targetId: request._id,
        fromState,
        toState: request.status,
        reason,
        metadata,
        session
    });

const studentsOf = (request) => [request.requester, ...(request.foundingMembers || [])];

const submitRequest = async (actor, payload) => {
    assertVerified(actor);
    assertStudent(actor, "Only verified students can request a club");

    const missing = EDITABLE_FIELDS.filter((field) => !payload[field] || !String(payload[field]).trim());
    if (missing.length) {
        throw new AppError(`Missing required fields: ${missing.join(", ")}`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    await assertClubNameAvailable(payload.name);
    const scope = await resolveScope(payload);
    const founders = await resolveFoundingMembers(payload.foundingMemberEmails, actor._id);
    assertFoundersMatchScope(actor, founders, scope);

    const request = new ClubCreationRequest({
        name: String(payload.name).trim(),
        description: payload.description,
        purpose: payload.purpose,
        proposedActivities: payload.proposedActivities,
        reason: payload.reason,
        ...scope,
        category: payload.category,
        requester: actor._id,
        foundingMembers: founders.map((founder) => founder._id),
        proposedMentor: await resolveProposedMentor(payload.proposedMentor, scope),
        status: CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW
    });

    pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_SUBMITTED, null, actor);
    await request.save();

    await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_SUBMITTED, actor, null);

    if (request.proposedMentor) {
        await notify(request.proposedMentor, {
            type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
            title: "New club request to review",
            message: `${actor.name} proposed "${request.name}" and named you as faculty mentor.`,
            link: REQUEST_LINK(request),
            email: true
        });
    }

    return populateRequest(ClubCreationRequest.findById(request._id));
};

// Faculty see requests addressed to them plus open requests nobody has been named for, as long as
// the club is for their department (or for all departments).
const facultyVisibilityFilter = (actor) => ({
    $or: [
        { proposedMentor: actor._id },
        { verifiedBy: actor._id },
        {
            proposedMentor: null,
            status: CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW,
            $or: [{ allDepartments: true }, { departmentCodes: actor.departmentCode }]
        }
    ]
});

const listRequests = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 20 });
    const conditions = [];

    if (query.status) {
        conditions.push({ status: String(query.status).toUpperCase() });
    }

    if (isAdmin(actor)) {
        // Admins see everything.
    } else if (isFaculty(actor)) {
        conditions.push(facultyVisibilityFilter(actor));
    } else {
        conditions.push({ $or: [{ requester: actor._id }, { foundingMembers: actor._id }] });
    }

    const filter = conditions.length ? { $and: conditions } : {};

    const [items, total] = await Promise.all([
        populateRequest(ClubCreationRequest.find(filter).sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        ClubCreationRequest.countDocuments(filter)
    ]);

    return { items, ...paginationMeta(pagination, total) };
};

const canViewRequest = (actor, request) => {
    if (isAdmin(actor)) {
        return true;
    }

    const id = String(actor._id);
    const ref = (value) => String(value?._id || value || "");

    if (isFaculty(actor)) {
        return (
            ref(request.proposedMentor) === id ||
            ref(request.verifiedBy) === id ||
            (!request.proposedMentor && request.status === CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW && belongsToScope(actor, request))
        );
    }

    return ref(request.requester) === id || (request.foundingMembers || []).some((member) => ref(member) === id);
};

const getRequestById = async (actor, id) => {
    const request = await populateRequest(ClubCreationRequest.findById(id));

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (!canViewRequest(actor, request)) {
        throw new AppError("You cannot view this request", 403, ERROR_CODES.FORBIDDEN);
    }

    return request;
};

const assertFacultyReviewer = (actor, request) => {
    assertFaculty(actor);

    if (request.proposedMentor && String(request.proposedMentor) !== String(actor._id)) {
        throw new AppError("This request is assigned to another faculty member", 403, ERROR_CODES.FORBIDDEN);
    }

    if (!request.proposedMentor && !belongsToScope(actor, request)) {
        throw new AppError(`This club is for ${describeScope(request)}; only faculty from those departments can review it`, 403, ERROR_CODES.FORBIDDEN);
    }

    if (request.status !== CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW) {
        throw new AppError("Request is not awaiting faculty review", 409, ERROR_CODES.INVALID_STATE);
    }
};

const updateRequest = async (actor, id, payload) => {
    const request = await findRequest(id);

    if (String(request.requester) !== String(actor._id)) {
        throw new AppError("Only the requesting student can edit this request", 403, ERROR_CODES.FORBIDDEN);
    }

    if (request.status !== CLUB_REQUEST_STATUS.NEEDS_CHANGES) {
        throw new AppError("Requests can only be edited when changes are requested", 409, ERROR_CODES.INVALID_STATE);
    }

    if (payload.name !== undefined && String(payload.name).trim().toLowerCase() !== request.name.toLowerCase()) {
        await assertClubNameAvailable(payload.name, request._id);
    }

    for (const field of EDITABLE_FIELDS) {
        if (payload[field] !== undefined) {
            request[field] = payload[field];
        }
    }

    const scopeChanged = payload.allDepartments !== undefined || payload.departmentCodes !== undefined;

    if (scopeChanged || payload.foundingMemberEmails !== undefined) {
        const scope = scopeChanged
            ? await resolveScope({
                  allDepartments: payload.allDepartments ?? request.allDepartments,
                  departmentCodes: payload.departmentCodes ?? request.departmentCodes
              })
            : { allDepartments: request.allDepartments, departmentCodes: request.departmentCodes };

        const founders =
            payload.foundingMemberEmails !== undefined
                ? await resolveFoundingMembers(payload.foundingMemberEmails, actor._id)
                : await User.find({ _id: { $in: request.foundingMembers } }).select("_id name email departmentCode");

        assertFoundersMatchScope(actor, founders, scope);

        if (request.proposedMentor) {
            assertMentorMatchesScope(await User.findById(request.proposedMentor), scope);
        }

        request.allDepartments = scope.allDepartments;
        request.departmentCodes = scope.departmentCodes;
        request.foundingMembers = founders.map((founder) => founder._id);
    }

    await request.save();
    return populateRequest(ClubCreationRequest.findById(request._id));
};

const resubmitRequest = async (actor, id) => {
    const request = await findRequest(id);

    if (String(request.requester) !== String(actor._id)) {
        throw new AppError("Only the requesting student can resubmit this request", 403, ERROR_CODES.FORBIDDEN);
    }

    if (request.status !== CLUB_REQUEST_STATUS.NEEDS_CHANGES) {
        throw new AppError("Only requests with requested changes can be resubmitted", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW;
    pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_RESUBMITTED, from, actor);
    await request.save();

    await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_RESUBMITTED, actor, from);

    // Faculty who asked for the changes (or the named mentor) is told the request is back.
    const reviewer = request.proposedMentor || [...request.history].reverse().find(
        (entry) => entry.action === AUDIT_ACTIONS.CLUB_REQUEST_CHANGES_REQUESTED
    )?.actor;

    await notify(reviewer, {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Club request resubmitted",
        message: `"${request.name}" was updated and is ready for review again.`,
        link: REQUEST_LINK(request)
    });

    return populateRequest(ClubCreationRequest.findById(request._id));
};

const verifyRequest = async (actor, id, comment = null) => {
    const request = await findRequest(id);
    assertFacultyReviewer(actor, request);

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.FACULTY_VERIFIED;
    request.verifiedBy = actor._id;
    request.verifiedAt = new Date();
    request.reviewComment = comment || null;
    pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_VERIFIED, from, actor, comment || null);
    await request.save();

    await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_VERIFIED, actor, from, comment || null);

    await notify(studentsOf(request), {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Club request verified by faculty",
        message: `${actor.name} verified "${request.name}". It is now awaiting university admin approval.`,
        link: REQUEST_LINK(request)
    });

    const admins = await User.find({ globalRole: GLOBAL_ROLES.ADMIN, isActive: true }).select("_id");
    await notify(admins.map((admin) => admin._id), {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Club request awaiting approval",
        message: `"${request.name}" was verified by ${actor.name}.`,
        link: REQUEST_LINK(request)
    });

    return populateRequest(ClubCreationRequest.findById(request._id));
};

const requestChanges = async (actor, id, comment) => {
    if (!comment || !String(comment).trim()) {
        throw new AppError("Describe the changes you need", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const request = await findRequest(id);
    assertFacultyReviewer(actor, request);

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.NEEDS_CHANGES;
    request.reviewComment = String(comment).trim();
    pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_CHANGES_REQUESTED, from, actor, request.reviewComment);
    await request.save();

    await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_CHANGES_REQUESTED, actor, from, request.reviewComment);

    await notify(studentsOf(request), {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Changes requested on your club request",
        message: `${actor.name}: ${request.reviewComment}`,
        link: REQUEST_LINK(request),
        email: true
    });

    return populateRequest(ClubCreationRequest.findById(request._id));
};

const rejectRequest = async (actor, id, reason) => {
    if (!reason || !String(reason).trim()) {
        throw new AppError("Rejection reason is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const request = await findRequest(id);

    if (request.status === CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW) {
        assertFacultyReviewer(actor, request);
    } else if (request.status === CLUB_REQUEST_STATUS.FACULTY_VERIFIED) {
        assertAdmin(actor);
    } else {
        throw new AppError("Request cannot be rejected in its current state", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.REJECTED;
    request.rejectionReason = String(reason).trim();
    request.decidedBy = actor._id;
    request.decidedAt = new Date();
    pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_REJECTED, from, actor, request.rejectionReason);
    await request.save();

    await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_REJECTED, actor, from, request.rejectionReason);

    await notify(studentsOf(request), {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Club request rejected",
        message: `"${request.name}" was rejected: ${request.rejectionReason}`,
        link: REQUEST_LINK(request),
        email: true
    });

    return populateRequest(ClubCreationRequest.findById(request._id));
};

const approveRequest = async (actor, id) => {
    assertAdmin(actor);

    const request = await findRequest(id);

    if (request.status !== CLUB_REQUEST_STATUS.FACULTY_VERIFIED) {
        throw new AppError("Request is not awaiting admin approval", 409, ERROR_CODES.INVALID_STATE);
    }

    const exact = new RegExp(`^${escapeRegex(request.name)}$`, "i");
    if (await Club.exists({ name: exact })) {
        throw new AppError("A club with this name already exists", 409, ERROR_CODES.CONFLICT);
    }

    const result = await withTransaction(async (session) => {
        const from = request.status;
        request.status = CLUB_REQUEST_STATUS.APPROVED;
        request.decidedBy = actor._id;
        request.decidedAt = new Date();

        // The faculty member who verified the request becomes the club's mentor.
        const [club] = await Club.create(
            [
                {
                    name: request.name,
                    description: request.description,
                    purpose: request.purpose,
                    category: request.category,
                    allDepartments: request.allDepartments,
                    departmentCodes: request.departmentCodes,
                    mentor: request.verifiedBy,
                    status: CLUB_STATUS.APPROVED,
                    creationRequest: request._id
                }
            ],
            maybeSession(session)
        );

        // Founding students join as members; the mentor then chooses the president.
        const founders = studentsOf(request);
        if (founders.length) {
            await ClubMembership.insertMany(
                founders.map((user) => ({
                    club: club._id,
                    user,
                    role: CLUB_ROLES.MEMBER,
                    status: MEMBERSHIP_STATUS.APPROVED,
                    joinedAt: new Date(),
                    decidedBy: actor._id,
                    decidedAt: new Date()
                })),
                maybeSession(session)
            );
        }

        request.club = club._id;
        pushHistory(request, AUDIT_ACTIONS.CLUB_REQUEST_APPROVED, from, actor);
        await request.save(maybeSession(session));

        await audit(request, AUDIT_ACTIONS.CLUB_REQUEST_APPROVED, actor, from, null, { clubId: club._id }, session);
        await recordAudit({
            action: AUDIT_ACTIONS.MENTOR_ASSIGNED,
            actor: actor._id,
            targetType: "Club",
            targetId: club._id,
            toState: CLUB_STATUS.APPROVED,
            metadata: { mentorId: request.verifiedBy },
            session
        });

        return { request, club };
    });

    await notify(studentsOf(request), {
        type: NOTIFICATION_TYPES.CLUB_REQUEST_UPDATE,
        title: "Your club was approved!",
        message: `"${request.name}" is officially a CampusConnect club. Your faculty mentor will now select the president.`,
        link: `/clubs/${result.club._id}`,
        email: true
    });

    await notify(request.verifiedBy, {
        type: NOTIFICATION_TYPES.CLUB_UPDATE,
        title: "You are now a faculty mentor",
        message: `"${request.name}" was approved. Select a student as club president to activate it.`,
        link: `/clubs/${result.club._id}`,
        email: true
    });

    return {
        request: await populateRequest(ClubCreationRequest.findById(request._id)),
        club: result.club
    };
};

module.exports = {
    submitRequest,
    listRequests,
    getRequestById,
    updateRequest,
    resubmitRequest,
    verifyRequest,
    requestChanges,
    rejectRequest,
    approveRequest
};
