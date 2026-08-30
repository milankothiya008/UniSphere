const Event = require("../models/Event");
const Club = require("../models/Club");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    EVENT_STATUS,
    CLUB_STATUS,
    PUBLIC_EVENT_STATUSES,
    VENUE_STATUS,
    AUDIT_ACTIONS
} = require("../constants/Statuses");
const CoordinatorAssignment = require("../models/CoordinatorAssignment");
const { GLOBAL_ROLES } = require("../constants/Roles");
const {
    assertClubPresident,
    assertCoordinatorAssigned,
    assertClubMemberOrStaff,
    isAdmin
} = require("./AuthorizationService");
const { combineDateAndTime } = require("../utils/UniversityRules");
const { assertVenueAvailable } = require("./VenueService");
const { recordAudit } = require("./AuditService");

const assertClubCanHostEvents = (club) => {
    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError(
            "Only active clubs can create or publish events",
            409,
            ERROR_CODES.CLUB_NOT_ACTIVE
        );
    }
};

const hydrateSchedule = (payload) => {
    const startAt = combineDateAndTime(payload.eventDate, payload.startTime);
    const endAt = combineDateAndTime(payload.eventDate, payload.endTime);

    if (startAt >= endAt) {
        throw new AppError("Event end must be after event start", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const registrationStart = new Date(payload.registrationStart);
    const registrationEnd = new Date(payload.registrationEnd);

    if (Number.isNaN(registrationStart.getTime()) || Number.isNaN(registrationEnd.getTime())) {
        throw new AppError("Invalid registration window", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (registrationStart >= registrationEnd) {
        throw new AppError("registrationStart must be before registrationEnd", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (registrationEnd > startAt) {
        throw new AppError("Registration must close before the event starts", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return { startAt, endAt, registrationStart, registrationEnd };
};

const populateEvent = (query) => {
    return query
        .populate("club", "name category status")
        .populate("venue", "name location capacity")
        .populate("createdBy", "name email");
};

const createDraft = async (actor, payload) => {
    const club = await Club.findById(payload.club);

    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, club._id);
    assertClubCanHostEvents(club);

    const required = [
        "title",
        "shortDescription",
        "description",
        "category",
        "eventDate",
        "startTime",
        "endTime",
        "venue",
        "registrationStart",
        "registrationEnd"
    ];

    const missing = required.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
    if (missing.length) {
        throw new AppError(`Missing required fields: ${missing.join(", ")}`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const venue = await Venue.findById(payload.venue);
    if (!venue || venue.status !== VENUE_STATUS.ACTIVE) {
        throw new AppError("Venue is not available", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const schedule = hydrateSchedule(payload);
    await assertVenueAvailable({
        venueId: venue._id,
        startAt: schedule.startAt,
        endAt: schedule.endAt
    });

    const event = await Event.create({
        title: payload.title,
        shortDescription: payload.shortDescription,
        description: payload.description,
        category: payload.category,
        poster: payload.poster || null,
        club: club._id,
        venue: venue._id,
        eventDate: payload.eventDate,
        startTime: payload.startTime,
        endTime: payload.endTime,
        ...schedule,
        maxParticipants: payload.maxParticipants || null,
        eligibility: payload.eligibility || { departments: [], batches: [], notes: "" },
        createdBy: actor._id,
        updatedBy: actor._id,
        status: EVENT_STATUS.DRAFT
    });

    return populateEvent(Event.findById(event._id));
};

const getEventById = async (eventId, { publicOnly = false, actor = null } = {}) => {
    const event = await populateEvent(Event.findById(eventId));

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (publicOnly && !PUBLIC_EVENT_STATUSES.includes(event.status)) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (actor && !PUBLIC_EVENT_STATUSES.includes(event.status)) {
        const clubId = event.club._id || event.club;
        await assertClubMemberOrStaff(actor, clubId);
    }

    return event;
};

const getAllEvents = async (query = {}, { publicFeed = false, actor = null } = {}) => {
    const { search, status, clubId, upcoming, page = 1, limit = 10 } = query;
    const filter = {};

    if (publicFeed) {
        filter.status = { $in: PUBLIC_EVENT_STATUSES };
    } else if (status) {
        filter.status = status.toUpperCase();
    }

    if (actor && actor.globalRole === GLOBAL_ROLES.COORDINATOR) {
        const assignments = await CoordinatorAssignment.find({
            coordinator: actor._id,
            isActive: true
        }).select("club");
        filter.club = { $in: assignments.map((item) => item.club) };
    }

    if (search) {
        filter.title = { $regex: search, $options: "i" };
    }

    if (clubId) {
        if (filter.club && filter.club.$in) {
            const allowed = filter.club.$in.map((id) => String(id));
            if (!allowed.includes(String(clubId))) {
                filter.club = { $in: [] };
            } else {
                filter.club = clubId;
            }
        } else {
            filter.club = clubId;
        }
    }

    if (upcoming === "true") {
        filter.startAt = { $gte: new Date() };
    }

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const events = await populateEvent(
        Event.find(filter).sort({ startAt: 1 }).skip(skip).limit(limitNumber)
    );

    const totalEvents = await Event.countDocuments(filter);

    return {
        events,
        totalEvents,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalEvents / limitNumber) || 1,
        limit: limitNumber
    };
};

const updateDraft = async (actor, eventId, payload) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club);

    if (![EVENT_STATUS.DRAFT, EVENT_STATUS.REJECTED].includes(event.status)) {
        throw new AppError("Only draft or rejected events can be edited", 409, ERROR_CODES.INVALID_STATE);
    }

    const fields = [
        "title",
        "shortDescription",
        "description",
        "category",
        "poster",
        "maxParticipants",
        "eligibility"
    ];

    fields.forEach((field) => {
        if (payload[field] !== undefined) {
            event[field] = payload[field];
        }
    });

    const nextDate = payload.eventDate || event.eventDate;
    const nextStart = payload.startTime || event.startTime;
    const nextEnd = payload.endTime || event.endTime;
    const nextRegStart = payload.registrationStart || event.registrationStart;
    const nextRegEnd = payload.registrationEnd || event.registrationEnd;
    const nextVenue = payload.venue || event.venue;

    const schedule = hydrateSchedule({
        eventDate: nextDate,
        startTime: nextStart,
        endTime: nextEnd,
        registrationStart: nextRegStart,
        registrationEnd: nextRegEnd
    });

    await assertVenueAvailable({
        venueId: nextVenue,
        startAt: schedule.startAt,
        endAt: schedule.endAt,
        excludeEventId: event._id
    });

    event.venue = nextVenue;
    event.eventDate = nextDate;
    event.startTime = nextStart;
    event.endTime = nextEnd;
    Object.assign(event, schedule);
    event.status = EVENT_STATUS.DRAFT;
    event.updatedBy = actor._id;

    await event.save();
    return populateEvent(Event.findById(event._id));
};

const submitEvent = async (actor, eventId) => {
    const event = await Event.findById(eventId).populate("club");

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club._id);
    assertClubCanHostEvents(event.club);

    if (![EVENT_STATUS.DRAFT, EVENT_STATUS.REJECTED].includes(event.status)) {
        throw new AppError("Event cannot be submitted from its current state", 409, ERROR_CODES.INVALID_STATE);
    }

    await assertVenueAvailable({
        venueId: event.venue,
        startAt: event.startAt,
        endAt: event.endAt,
        excludeEventId: event._id
    });

    const from = event.status;
    event.status = EVENT_STATUS.PENDING_APPROVAL;
    event.updatedBy = actor._id;
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_SUBMITTED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: from,
        toState: event.status
    });

    return populateEvent(Event.findById(event._id));
};

const approveEvent = async (actor, eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertCoordinatorAssigned(actor, event.club);

    if (event.status !== EVENT_STATUS.PENDING_APPROVAL) {
        throw new AppError("Event is not pending approval", 409, ERROR_CODES.INVALID_STATE);
    }

    await assertVenueAvailable({
        venueId: event.venue,
        startAt: event.startAt,
        endAt: event.endAt,
        excludeEventId: event._id
    });

    event.status = EVENT_STATUS.APPROVED;
    event.reviewedBy = actor._id;
    event.reviewedAt = new Date();
    event.rejectionReason = null;
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_APPROVED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: EVENT_STATUS.PENDING_APPROVAL,
        toState: event.status
    });

    return populateEvent(Event.findById(event._id));
};

const rejectEvent = async (actor, eventId, reason) => {
    if (!reason || !String(reason).trim()) {
        throw new AppError("Rejection reason is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertCoordinatorAssigned(actor, event.club);

    if (event.status !== EVENT_STATUS.PENDING_APPROVAL) {
        throw new AppError("Event is not pending approval", 409, ERROR_CODES.INVALID_STATE);
    }

    event.status = EVENT_STATUS.REJECTED;
    event.rejectionReason = String(reason).trim();
    event.reviewedBy = actor._id;
    event.reviewedAt = new Date();
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_REJECTED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: EVENT_STATUS.PENDING_APPROVAL,
        toState: event.status,
        reason: event.rejectionReason
    });

    return populateEvent(Event.findById(event._id));
};

const publishEvent = async (actor, eventId) => {
    const event = await Event.findById(eventId).populate("club");

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club._id);
    assertClubCanHostEvents(event.club);

    if (event.status !== EVENT_STATUS.APPROVED) {
        throw new AppError("Only approved events can be published", 409, ERROR_CODES.INVALID_STATE);
    }

    event.status = EVENT_STATUS.PUBLISHED;
    event.publishedAt = new Date();
    event.updatedBy = actor._id;
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_PUBLISHED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: EVENT_STATUS.APPROVED,
        toState: event.status
    });

    return populateEvent(Event.findById(event._id));
};

const cancelEvent = async (actor, eventId, reason = null) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const cancellable = [
        EVENT_STATUS.DRAFT,
        EVENT_STATUS.PENDING_APPROVAL,
        EVENT_STATUS.APPROVED,
        EVENT_STATUS.PUBLISHED
    ];

    if (!cancellable.includes(event.status)) {
        throw new AppError("Event cannot be cancelled", 409, ERROR_CODES.INVALID_STATE);
    }

    if (!isAdmin(actor)) {
        await assertClubPresident(actor, event.club);
    }

    const from = event.status;
    event.status = EVENT_STATUS.CANCELLED;
    event.updatedBy = actor._id;
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_CANCELLED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: from,
        toState: event.status,
        reason
    });

    return populateEvent(Event.findById(event._id));
};

const completeEvent = async (actor, eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club);

    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Only published events can be marked completed", 409, ERROR_CODES.INVALID_STATE);
    }

    event.status = EVENT_STATUS.COMPLETED;
    event.completedAt = new Date();
    event.updatedBy = actor._id;
    await event.save();

    await recordAudit({
        action: AUDIT_ACTIONS.EVENT_COMPLETED,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState: EVENT_STATUS.PUBLISHED,
        toState: event.status
    });

    return populateEvent(Event.findById(event._id));
};

const getEventsByClub = async (clubId, { publicOnly = false } = {}) => {
    const filter = { club: clubId };
    if (publicOnly) {
        filter.status = { $in: PUBLIC_EVENT_STATUSES };
    }

    return populateEvent(Event.find(filter).sort({ startAt: 1 }));
};

module.exports = {
    createDraft,
    getEventById,
    getAllEvents,
    updateDraft,
    submitEvent,
    approveEvent,
    rejectEvent,
    publishEvent,
    cancelEvent,
    completeEvent,
    getEventsByClub
};
