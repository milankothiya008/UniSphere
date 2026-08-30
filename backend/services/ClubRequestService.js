const ClubCreationRequest = require("../models/ClubCreationRequest");
const Club = require("../models/Club");
const Department = require("../models/Department");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_REQUEST_STATUS, CLUB_STATUS, AUDIT_ACTIONS } = require("../constants/Statuses");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const { assertAdmin, assertCoordinatorRole, assertVerified } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { withTransaction, maybeSession } = require("../utils/Transaction");

const submitRequest = async (actor, payload) => {
    assertVerified(actor);

    if (actor.globalRole !== GLOBAL_ROLES.STUDENT || actor.accountType !== ACCOUNT_TYPES.STUDENT) {
        throw new AppError("Only verified students can request a club", 403, ERROR_CODES.FORBIDDEN);
    }

    const {
        name,
        description,
        purpose,
        proposedActivities,
        reason,
        departmentCode,
        category
    } = payload;

    if (!name || !description || !purpose || !proposedActivities || !reason || !departmentCode || !category) {
        throw new AppError(
            "name, description, purpose, proposedActivities, reason, departmentCode and category are required",
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }

    const department = await Department.findOne({
        code: String(departmentCode).toUpperCase(),
        isActive: true
    });

    if (!department) {
        throw new AppError("Department is not recognized", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const existingClub = await Club.findOne({ name: name.trim() });
    if (existingClub) {
        throw new AppError("A club with this name already exists", 409, ERROR_CODES.CONFLICT);
    }

    const request = await ClubCreationRequest.create({
        name: name.trim(),
        description,
        purpose,
        proposedActivities,
        reason,
        departmentCode: department.code,
        category,
        requester: actor._id,
        status: CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW,
        history: [
            {
                action: AUDIT_ACTIONS.CLUB_REQUEST_SUBMITTED,
                fromStatus: null,
                toStatus: CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW,
                actor: actor._id
            }
        ]
    });

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_REQUEST_SUBMITTED,
        actor: actor._id,
        targetType: "ClubCreationRequest",
        targetId: request._id,
        toState: request.status
    });

    return request.populate("requester", "name email");
};

const listRequests = async (actor, query = {}) => {
    const filter = {};

    if (query.status) {
        filter.status = query.status.toUpperCase();
    }

    if (actor.globalRole === GLOBAL_ROLES.STUDENT) {
        filter.requester = actor._id;
    } else if (actor.globalRole === GLOBAL_ROLES.COORDINATOR) {
        if (!query.status) {
            filter.status = {
                $in: [
                    CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW,
                    CLUB_REQUEST_STATUS.COORDINATOR_RECOMMENDED,
                    CLUB_REQUEST_STATUS.PENDING_ADMIN_APPROVAL
                ]
            };
        }
    } else {
        assertAdmin(actor);
    }

    return ClubCreationRequest.find(filter)
        .populate("requester", "name email departmentCode")
        .populate("recommendedBy", "name email")
        .populate("decidedBy", "name email")
        .sort({ createdAt: -1 });
};

const getRequestById = async (actor, id) => {
    const request = await ClubCreationRequest.findById(id)
        .populate("requester", "name email departmentCode")
        .populate("recommendedBy", "name email")
        .populate("decidedBy", "name email")
        .populate("club", "name status");

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (actor.globalRole === GLOBAL_ROLES.STUDENT && String(request.requester._id) !== String(actor._id)) {
        throw new AppError("You cannot view this request", 403, ERROR_CODES.FORBIDDEN);
    }

    return request;
};

const recommendRequest = async (actor, id) => {
    assertCoordinatorRole(actor);
    assertVerified(actor);

    const request = await ClubCreationRequest.findById(id);

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (request.status !== CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW) {
        throw new AppError("Request is not awaiting coordinator review", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.PENDING_ADMIN_APPROVAL;
    request.recommendedBy = actor._id;
    request.recommendedAt = new Date();
    request.history.push({
        action: AUDIT_ACTIONS.CLUB_REQUEST_RECOMMENDED,
        fromStatus: from,
        toStatus: request.status,
        actor: actor._id
    });

    await request.save();

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_REQUEST_RECOMMENDED,
        actor: actor._id,
        targetType: "ClubCreationRequest",
        targetId: request._id,
        fromState: from,
        toState: request.status
    });

    return request;
};

const rejectRequest = async (actor, id, reason) => {
    if (!reason || !String(reason).trim()) {
        throw new AppError("Rejection reason is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const request = await ClubCreationRequest.findById(id);

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const isCoordReview = request.status === CLUB_REQUEST_STATUS.PENDING_COORDINATOR_REVIEW;
    const isAdminReview = request.status === CLUB_REQUEST_STATUS.PENDING_ADMIN_APPROVAL;

    if (isCoordReview) {
        assertCoordinatorRole(actor);
    } else if (isAdminReview) {
        assertAdmin(actor);
    } else {
        throw new AppError("Request cannot be rejected in its current state", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = request.status;
    request.status = CLUB_REQUEST_STATUS.REJECTED;
    request.rejectionReason = String(reason).trim();
    request.decidedBy = actor._id;
    request.decidedAt = new Date();
    request.history.push({
        action: AUDIT_ACTIONS.CLUB_REQUEST_REJECTED,
        fromStatus: from,
        toStatus: request.status,
        actor: actor._id,
        reason: request.rejectionReason
    });

    await request.save();

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_REQUEST_REJECTED,
        actor: actor._id,
        targetType: "ClubCreationRequest",
        targetId: request._id,
        fromState: from,
        toState: request.status,
        reason: request.rejectionReason
    });

    return request;
};

const approveRequest = async (actor, id) => {
    assertAdmin(actor);

    const request = await ClubCreationRequest.findById(id);

    if (!request) {
        throw new AppError("Club request not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (request.status !== CLUB_REQUEST_STATUS.PENDING_ADMIN_APPROVAL) {
        throw new AppError("Request is not awaiting admin approval", 409, ERROR_CODES.INVALID_STATE);
    }

    return withTransaction(async (session) => {
        const from = request.status;
        request.status = CLUB_REQUEST_STATUS.APPROVED;
        request.decidedBy = actor._id;
        request.decidedAt = new Date();

        const club = await Club.create(
            [
                {
                    name: request.name,
                    description: request.description,
                    purpose: request.purpose,
                    category: request.category,
                    departmentCode: request.departmentCode,
                    status: CLUB_STATUS.APPROVED,
                    creationRequest: request._id
                }
            ],
            maybeSession(session)
        );

        const createdClub = Array.isArray(club) ? club[0] : club;
        request.club = createdClub._id;
        request.history.push({
            action: AUDIT_ACTIONS.CLUB_REQUEST_APPROVED,
            fromStatus: from,
            toStatus: request.status,
            actor: actor._id
        });

        await request.save(maybeSession(session));

        await recordAudit({
            action: AUDIT_ACTIONS.CLUB_REQUEST_APPROVED,
            actor: actor._id,
            targetType: "ClubCreationRequest",
            targetId: request._id,
            fromState: from,
            toState: request.status,
            metadata: { clubId: createdClub._id },
            session
        });

        return { request, club: createdClub };
    });
};

module.exports = {
    submitRequest,
    listRequests,
    getRequestById,
    recommendRequest,
    rejectRequest,
    approveRequest
};
