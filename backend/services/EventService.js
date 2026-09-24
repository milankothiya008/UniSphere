const Event = require("../models/Event");
const Club = require("../models/Club");
const Venue = require("../models/Venue");
const ClubMembership = require("../models/ClubMembership");
const EventRegistration = require("../models/EventRegistration");
const EventResult = require("../models/EventResult");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    EVENT_STATUS,
    CLUB_STATUS,
    PUBLIC_EVENT_STATUSES,
    EDITABLE_EVENT_STATUSES,
    VENUE_STATUS,
    AUDIT_ACTIONS,
    MEMBERSHIP_STATUS,
    REGISTRATION_STATUS,
    RESULT_STATUS,
    FEED_POST_TYPES,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { CLUB_PERMISSIONS, CLUB_ROLE_PERMISSIONS } = require("../constants/Permissions");
const { searchRegex, parsePagination, paginationMeta } = require("../utils/Query");
const { combineDateAndTime, dateKeyToDate, toDateKey } = require("../utils/UniversityRules");
const {
    isFaculty,
    getClubContext,
    contextHas,
    assertClubPermission,
    assertClubMentor
} = require("./AuthorizationService");
const { assertVenueAvailable, withVenueLock } = require("./VenueService");
const { sendEventLaunchEmails } = require("./CampusMailer");
const { promoteFromWaitlist, waitlistPosition } = require("./WaitlistService");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { recordAudit } = require("./AuditService");
const { notify, notifyAllUsers } = require("./NotificationService");
const { createSystemPost } = require("./FeedService");
const { clubUsersWithPermission } = require("./MembershipService");

const EVENT_LINK = (event) => `/events/${event._id}`;

// Fields that can still change once an event is approved or published (no schedule/venue changes).
const LIVE_EDITABLE_FIELDS = ["shortDescription", "description", "rules", "contact", "poster", "registrationClosed"];
const DRAFT_FIELDS = [
    "title",
    "shortDescription",
    "description",
    "category",
    "poster",
    "rules",
    "contact",
    "maxParticipants",
    "eligibility"
];

const populateEvent = (query) =>
    query
        .populate("club", "name logo category status mentor president")
        .populate("venue", "name location capacity")
        .populate("createdBy", "name")
        .populate("organizer", "name email")
        .populate("reviewedBy", "name");

const findEvent = async (eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return event;
};

const assertClubCanHostEvents = (club) => {
    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can create or publish events", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }
};

const assertStatus = (event, allowed, message) => {
    if (!allowed.includes(event.status)) {
        throw new AppError(message, 409, ERROR_CODES.INVALID_STATE);
    }
};

const assertInFuture = (event, message = "This event has already started") => {
    if (event.startAt <= new Date()) {
        throw new AppError(message, 409, ERROR_CODES.INVALID_STATE);
    }
};

const assertRegistrationOpenAhead = (event, message) => {
    if (event.registrationEnd <= new Date()) {
        throw new AppError(message, 409, ERROR_CODES.INVALID_STATE);
    }
};

const buildSchedule = (payload) => {
    const startAt = combineDateAndTime(payload.eventDate, payload.startTime);
    const endAt = combineDateAndTime(payload.eventDate, payload.endTime);

    if (startAt >= endAt) {
        throw new AppError("Event end time must be after the start time", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (startAt <= new Date()) {
        throw new AppError("Event must be scheduled in the future", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const registrationStart = payload.registrationStart ? new Date(payload.registrationStart) : new Date();
    const registrationEnd = new Date(payload.registrationEnd);

    if (Number.isNaN(registrationStart.getTime()) || Number.isNaN(registrationEnd.getTime())) {
        throw new AppError("Invalid registration window", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (registrationStart >= registrationEnd) {
        throw new AppError("Registration deadline must be after registration opens", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (registrationEnd > startAt) {
        throw new AppError("Registration must close before the event starts", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    // An opening time in the past just means "open as soon as it is published"; a past deadline is never valid.
    if (registrationEnd <= new Date()) {
        throw new AppError("Registration deadline must be in the future", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return {
        eventDate: dateKeyToDate(payload.eventDate),
        startTime: payload.startTime,
        endTime: payload.endTime,
        startAt,
        endAt,
        registrationStart,
        registrationEnd
    };
};

const normalizeEligibility = (eligibility = {}) => ({
    departments: [...new Set((eligibility.departments || []).map((d) => String(d).trim().toUpperCase()).filter(Boolean))],
    batches: [...new Set((eligibility.batches || []).map((b) => String(b).trim()).filter((b) => /^\d{2}$/.test(b)))],
    notes: String(eligibility.notes || "").trim()
});

const normalizeContact = (contact = {}) => ({
    name: String(contact.name || "").trim(),
    email: String(contact.email || "").trim().toLowerCase(),
    phone: String(contact.phone || "").trim()
});

// Schedule, venue and identity fields are locked once the mentor has approved the event.
const lockedFieldChanges = (event, payload) => {
    const same = {
        title: (v) => String(v).trim() === event.title,
        category: (v) => v === event.category,
        venue: (v) => String(v) === String(event.venue),
        eventDate: (v) => toDateKey(v) === toDateKey(event.eventDate),
        startTime: (v) => v === event.startTime,
        endTime: (v) => v === event.endTime,
        eligibility: (v) => JSON.stringify(normalizeEligibility(v)) === JSON.stringify(normalizeEligibility(event.eligibility))
    };

    return Object.keys(same).filter((field) => payload[field] !== undefined && !same[field](payload[field]));
};

const loadActiveVenue = async (venueId) => {
    const venue = await Venue.findById(venueId);

    if (!venue || venue.status !== VENUE_STATUS.ACTIVE) {
        throw new AppError("Selected venue is not available", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return venue;
};

const assertCapacityFits = (maxParticipants, venue, registeredCount = 0) => {
    if (maxParticipants === null || maxParticipants === undefined || maxParticipants === "") {
        return null;
    }

    const value = Number(maxParticipants);

    if (!Number.isInteger(value) || value < 1) {
        throw new AppError("Participant limit must be a positive whole number", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (venue && value > venue.capacity) {
        throw new AppError(`Participant limit exceeds ${venue.name}'s capacity of ${venue.capacity}`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (value < registeredCount) {
        throw new AppError(`Participant limit cannot be lower than current registrations (${registeredCount})`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return value;
};

const resolveOrganizer = async (clubId, organizerId, actor) => {
    const candidate = organizerId || actor._id;
    const membership = await ClubMembership.findOne({ club: clubId, user: candidate, status: MEMBERSHIP_STATUS.APPROVED });

    if (!membership) {
        if (organizerId) {
            throw new AppError("Organizer must be a member of the club", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        return null;
    }

    return candidate;
};

const eventManagers = async (event) => clubUsersWithPermission(event.club?._id || event.club, CLUB_PERMISSIONS.MANAGE_EVENTS);

const eventPublishers = async (event) => clubUsersWithPermission(event.club?._id || event.club, CLUB_PERMISSIONS.PUBLISH_EVENTS);

// Everyone holding or queuing for a seat hears about changes to the event.
const registeredUserIds = async (eventId) => {
    const registrations = await EventRegistration.find({
        event: eventId,
        status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] }
    }).select("user");
    return registrations.map((registration) => registration.user);
};

// Registered students hear about it by email as well (unless they muted "Your events"); everyone else in-app.
const broadcastEventNews = async (event, actor, { type, title, message }) => {
    const registrants = await registeredUserIds(event._id);
    const link = EVENT_LINK(event);

    await notify(registrants, { type, title, message, link, email: true, emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY, exclude: [actor._id] });
    await notifyAllUsers({ type, title, message, link, exclude: [actor._id, ...registrants] });
};

const audit = (event, action, actor, fromState, reason = null, metadata = {}) =>
    recordAudit({
        action,
        actor: actor._id,
        targetType: "Event",
        targetId: event._id,
        fromState,
        toState: event.status,
        reason,
        metadata: { clubId: event.club?._id || event.club, ...metadata }
    });

const registrationWindowState = (event, now = new Date()) => {
    if (event.status !== EVENT_STATUS.PUBLISHED) {
        return "UNAVAILABLE";
    }
    if (event.registrationClosed || now > event.registrationEnd || now >= event.startAt) {
        return "CLOSED";
    }
    if (now < event.registrationStart) {
        return "NOT_OPEN";
    }
    if (event.maxParticipants && event.registeredCount >= event.maxParticipants) {
        return "FULL";
    }
    return "OPEN";
};

const serialize = (event, extra = {}) => {
    const obj = event.toObject ? event.toObject() : event;
    return { ...obj, registrationState: registrationWindowState(obj), ...extra };
};

const viewerFor = (context, event, registration) => ({
    isMentor: context.isMentor,
    isAdmin: context.isAdmin,
    role: context.role,
    canManage: contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS),
    canPublish: contextHas(context, CLUB_PERMISSIONS.PUBLISH_EVENTS),
    canViewParticipants: context.isMentor || contextHas(context, CLUB_PERMISSIONS.VIEW_PARTICIPANTS),
    canManageParticipants: contextHas(context, CLUB_PERMISSIONS.MANAGE_PARTICIPANTS),
    canManageResults: contextHas(context, CLUB_PERMISSIONS.MANAGE_RESULTS),
    canPublishResults: contextHas(context, CLUB_PERMISSIONS.PUBLISH_RESULTS),
    canReview: context.isMentor && event.status === EVENT_STATUS.PENDING_APPROVAL,
    registration: registration
        ? {
              _id: registration._id,
              status: registration.status,
              registeredAt: registration.registeredAt,
              promotedAt: registration.promotedAt || null,
              waitlistPosition: registration.waitlistPosition ?? null
          }
        : null
});

const getEventDetail = async (actor, eventId) => {
    const event = await populateEvent(Event.findById(eventId));

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const context = await getClubContext(actor, event.club._id);
    const isPublic = PUBLIC_EVENT_STATUSES.includes(event.status) || (event.status === EVENT_STATUS.CANCELLED && Boolean(event.publishedAt));

    if (!isPublic && !context.isMentor && !contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS) && !contextHas(context, CLUB_PERMISSIONS.PUBLISH_EVENTS)) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const found = actor ? await EventRegistration.findOne({ event: event._id, user: actor._id }) : null;
    const registration = found ? { ...found.toObject(), waitlistPosition: await waitlistPosition(found) } : null;

    return serialize(event, { viewer: actor ? viewerFor(context, event, registration) : null });
};

const createDraft = async (actor, payload) => {
    const { club } = await assertClubPermission(actor, payload.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot create events for this club");
    assertClubCanHostEvents(club);

    const venue = await loadActiveVenue(payload.venue);
    const schedule = buildSchedule(payload);

    await assertVenueAvailable({ venueId: venue._id, startAt: schedule.startAt, endAt: schedule.endAt });

    const event = await Event.create({
        title: payload.title,
        shortDescription: payload.shortDescription,
        description: payload.description,
        category: payload.category,
        poster: payload.poster || null,
        club: club._id,
        venue: venue._id,
        ...schedule,
        maxParticipants: assertCapacityFits(payload.maxParticipants, venue),
        eligibility: normalizeEligibility(payload.eligibility),
        rules: payload.rules || "",
        contact: normalizeContact(payload.contact),
        organizer: await resolveOrganizer(club._id, payload.organizer, actor),
        createdBy: actor._id,
        updatedBy: actor._id,
        status: EVENT_STATUS.DRAFT
    });

    await audit(event, AUDIT_ACTIONS.EVENT_CREATED, actor, null);

    return getEventDetail(actor, event._id);
};

const updateEvent = async (actor, eventId, payload) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot edit this club's events");
    const changed = [];
    let promoteAfterSave = false;

    if (EDITABLE_EVENT_STATUSES.includes(event.status)) {
        const venue = await loadActiveVenue(payload.venue || event.venue);

        DRAFT_FIELDS.forEach((field) => {
            if (payload[field] === undefined) {
                return;
            }
            changed.push(field);
            if (field === "eligibility") {
                event.eligibility = normalizeEligibility(payload.eligibility);
            } else if (field === "contact") {
                event.contact = normalizeContact(payload.contact);
            } else if (field === "maxParticipants") {
                event.maxParticipants = assertCapacityFits(payload.maxParticipants, venue);
            } else {
                event[field] = payload[field];
            }
        });

        if (payload.organizer !== undefined) {
            event.organizer = await resolveOrganizer(event.club, payload.organizer, actor);
            changed.push("organizer");
        }

        const schedule = buildSchedule({
            eventDate: payload.eventDate || toDateKey(event.eventDate),
            startTime: payload.startTime || event.startTime,
            endTime: payload.endTime || event.endTime,
            registrationStart: payload.registrationStart || event.registrationStart,
            registrationEnd: payload.registrationEnd || event.registrationEnd
        });

        if (payload.maxParticipants === undefined && event.maxParticipants) {
            assertCapacityFits(event.maxParticipants, venue);
        }

        await assertVenueAvailable({ venueId: venue._id, startAt: schedule.startAt, endAt: schedule.endAt, excludeEventId: event._id });

        event.venue = venue._id;
        Object.assign(event, schedule);
    } else if ([EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED].includes(event.status)) {
        LIVE_EDITABLE_FIELDS.forEach((field) => {
            if (payload[field] === undefined) {
                return;
            }
            changed.push(field);
            event[field] = field === "contact" ? normalizeContact(payload.contact) : payload[field];
        });

        if (payload.maxParticipants !== undefined) {
            const venue = await Venue.findById(event.venue);
            event.maxParticipants = assertCapacityFits(payload.maxParticipants, venue, event.registeredCount);
            changed.push("maxParticipants");
            promoteAfterSave = true;
        }

        if (payload.registrationEnd !== undefined) {
            const registrationEnd = new Date(payload.registrationEnd);
            if (Number.isNaN(registrationEnd.getTime()) || registrationEnd <= event.registrationStart || registrationEnd > event.startAt) {
                throw new AppError("Registration deadline must be after registration opens and before the event starts", 400, ERROR_CODES.VALIDATION_ERROR);
            }
            if (registrationEnd <= new Date()) {
                throw new AppError("Registration deadline must be in the future", 400, ERROR_CODES.VALIDATION_ERROR);
            }
            event.registrationEnd = registrationEnd;
            changed.push("registrationEnd");
        }

        const locked = lockedFieldChanges(event, payload);
        if (locked.length) {
            throw new AppError(
                `Approved events cannot change ${locked.join(", ")}. Cancel and create a new event instead.`,
                409,
                ERROR_CODES.INVALID_STATE
            );
        }
    } else {
        throw new AppError("This event can no longer be edited", 409, ERROR_CODES.INVALID_STATE);
    }

    event.updatedBy = actor._id;
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_UPDATED, actor, event.status, null, { fields: changed });

    // More seats (or no limit any more): move waiting students in straight away.
    if (promoteAfterSave && event.status === EVENT_STATUS.PUBLISHED) {
        await promoteFromWaitlist(event._id, { reason: "capacity_increased" });
    }

    const note = payload.updateNote && String(payload.updateNote).trim();
    if (event.status === EVENT_STATUS.PUBLISHED && note) {
        // Kept on the event page's "Updates" section (not in the campus feed).
        await createSystemPost({
            type: FEED_POST_TYPES.EVENT_UPDATE,
            club: event.club,
            event: event._id,
            author: actor._id,
            title: `Update: ${event.title}`,
            body: note
        });

        await broadcastEventNews(event, actor, {
            type: NOTIFICATION_TYPES.EVENT_UPDATED,
            title: `Update for ${event.title}`,
            message: note
        });
    }

    return getEventDetail(actor, event._id);
};

const submitEvent = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const { club } = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot submit this club's events");

    assertClubCanHostEvents(club);
    assertStatus(event, EDITABLE_EVENT_STATUSES, "Only draft events or events with requested changes can be submitted");
    assertInFuture(event, "Events must be scheduled in the future before submission");

    if (!club.mentor) {
        throw new AppError("This club has no faculty mentor to review events. Contact the university admin.", 409, ERROR_CODES.INVALID_STATE);
    }

    assertRegistrationOpenAhead(event, "The registration deadline has passed. Set a new deadline before submitting.");

    const from = event.status;
    // Submitting reserves the venue, so the check and the claim happen under the venue lock.
    await withVenueLock(event.venue, async () => {
        await assertVenueAvailable({ venueId: event.venue, startAt: event.startAt, endAt: event.endAt, excludeEventId: event._id });
        event.status = EVENT_STATUS.PENDING_APPROVAL;
        event.submittedAt = new Date();
        event.updatedBy = actor._id;
        await event.save();
    });

    await audit(event, AUDIT_ACTIONS.EVENT_SUBMITTED, actor, from);

    await notify(club.mentor, {
        type: NOTIFICATION_TYPES.EVENT_REVIEW,
        title: `Event awaiting your approval`,
        message: `${club.name} submitted "${event.title}"${from === EVENT_STATUS.NEEDS_CHANGES ? " with the changes you requested" : ""}.`,
        link: EVENT_LINK(event),
        email: true
    });

    return getEventDetail(actor, event._id);
};

const loadForReview = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const context = await assertClubMentor(actor, event.club, "Only the club's faculty mentor can review its events");
    assertStatus(event, [EVENT_STATUS.PENDING_APPROVAL], "Event is not pending approval");
    return { event, context };
};

const markReviewed = (event, actor, comment) => {
    event.reviewedBy = actor._id;
    event.reviewedAt = new Date();
    event.reviewComment = comment ? String(comment).trim() : null;
};

const approveEvent = async (actor, eventId, comment = null) => {
    const { event } = await loadForReview(actor, eventId);
    assertInFuture(event, "This event's start time has passed; request changes to reschedule it");

    await withVenueLock(event.venue, async () => {
        await assertVenueAvailable({ venueId: event.venue, startAt: event.startAt, endAt: event.endAt, excludeEventId: event._id });
        event.status = EVENT_STATUS.APPROVED;
        markReviewed(event, actor, comment);
        await event.save();
    });

    await audit(event, AUDIT_ACTIONS.EVENT_APPROVED, actor, EVENT_STATUS.PENDING_APPROVAL, comment);

    await notify([event.createdBy, ...(await eventPublishers(event))], {
        type: NOTIFICATION_TYPES.EVENT_APPROVED,
        title: `"${event.title}" was approved`,
        message: comment ? `Mentor note: ${comment}` : "It is ready to be published.",
        link: EVENT_LINK(event),
        email: true
    });

    return getEventDetail(actor, event._id);
};

const requestEventChanges = async (actor, eventId, comment) => {
    if (!comment || !String(comment).trim()) {
        throw new AppError("Describe the changes you need", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const { event } = await loadForReview(actor, eventId);

    event.status = EVENT_STATUS.NEEDS_CHANGES;
    markReviewed(event, actor, comment);
    await event.save();

    await audit(event, AUDIT_ACTIONS.EVENT_CHANGES_REQUESTED, actor, EVENT_STATUS.PENDING_APPROVAL, event.reviewComment);

    await notify([event.createdBy, ...(await eventManagers(event))], {
        type: NOTIFICATION_TYPES.EVENT_CHANGES_REQUESTED,
        title: `Changes requested for "${event.title}"`,
        message: event.reviewComment,
        link: EVENT_LINK(event),
        email: true
    });

    return getEventDetail(actor, event._id);
};

const rejectEvent = async (actor, eventId, reason) => {
    if (!reason || !String(reason).trim()) {
        throw new AppError("Rejection reason is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const { event } = await loadForReview(actor, eventId);

    event.status = EVENT_STATUS.REJECTED;
    markReviewed(event, actor, reason);
    await event.save();

    await audit(event, AUDIT_ACTIONS.EVENT_REJECTED, actor, EVENT_STATUS.PENDING_APPROVAL, event.reviewComment);

    await notify([event.createdBy, ...(await eventManagers(event))], {
        type: NOTIFICATION_TYPES.EVENT_REJECTED,
        title: `"${event.title}" was rejected`,
        message: event.reviewComment,
        link: EVENT_LINK(event),
        email: true
    });

    return getEventDetail(actor, event._id);
};

const publishEvent = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const { club } = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.PUBLISH_EVENTS, "You cannot publish this club's events");

    assertClubCanHostEvents(club);
    assertStatus(event, [EVENT_STATUS.APPROVED], "Only approved events can be published");
    assertInFuture(event, "This event's start time has passed and it can no longer be published");

    assertRegistrationOpenAhead(event, "The registration deadline has passed. Set a new deadline before publishing.");

    await withVenueLock(event.venue, async () => {
        await assertVenueAvailable({ venueId: event.venue, startAt: event.startAt, endAt: event.endAt, excludeEventId: event._id });
        event.status = EVENT_STATUS.PUBLISHED;
        event.publishedAt = new Date();
        event.updatedBy = actor._id;
        await event.save();
    });

    await audit(event, AUDIT_ACTIONS.EVENT_PUBLISHED, actor, EVENT_STATUS.APPROVED);

    // Published events appear in the campus event feed; everyone on campus is told about them in-app,
    // and the club's followers plus eligible students are emailed (see CampusMailer).
    await notifyAllUsers({
        type: NOTIFICATION_TYPES.EVENT_PUBLISHED,
        title: `New event: ${event.title}`,
        message: `${club.name} · ${event.shortDescription}`,
        link: EVENT_LINK(event),
        exclude: [actor._id]
    });
    await sendEventLaunchEmails(event, club, actor);

    return getEventDetail(actor, event._id);
};

const cancelEvent = async (actor, eventId, reason = null) => {
    const event = await findEvent(eventId);
    const context = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.PUBLISH_EVENTS, "You cannot cancel this club's events");

    assertStatus(
        event,
        [EVENT_STATUS.DRAFT, EVENT_STATUS.PENDING_APPROVAL, EVENT_STATUS.NEEDS_CHANGES, EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED],
        "This event cannot be cancelled"
    );

    const wasPublished = event.status === EVENT_STATUS.PUBLISHED;
    if (wasPublished && (!reason || !String(reason).trim())) {
        throw new AppError("A reason is required to cancel a published event", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const from = event.status;
    event.status = EVENT_STATUS.CANCELLED;
    event.cancelledAt = new Date();
    event.cancellationReason = reason ? String(reason).trim() : null;
    event.updatedBy = actor._id;
    await event.save();

    await audit(event, AUDIT_ACTIONS.EVENT_CANCELLED, actor, from, event.cancellationReason);

    if (wasPublished) {
        await createSystemPost({
            type: FEED_POST_TYPES.EVENT_UPDATE,
            club: context.club._id,
            event: event._id,
            author: actor._id,
            title: `Cancelled: ${event.title}`,
            body: event.cancellationReason
        });

        await broadcastEventNews(event, actor, {
            type: NOTIFICATION_TYPES.EVENT_CANCELLED,
            title: `"${event.title}" has been cancelled`,
            message: event.cancellationReason
        });
    }

    return getEventDetail(actor, event._id);
};

const completeEvent = async (actor, eventId) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot complete this club's events");

    assertStatus(event, [EVENT_STATUS.PUBLISHED], "Only published events can be marked completed");

    if (event.startAt > new Date()) {
        throw new AppError("An event can only be completed after it has started", 409, ERROR_CODES.INVALID_STATE);
    }

    event.status = EVENT_STATUS.COMPLETED;
    event.completedAt = new Date();
    event.updatedBy = actor._id;
    await event.save();

    await audit(event, AUDIT_ACTIONS.EVENT_COMPLETED, actor, EVENT_STATUS.PUBLISHED);

    return getEventDetail(actor, event._id);
};

// Events carry what has been published of their results so feed posts can show them inline:
// `result` holds the final results (winners), `resultStage` is "final", "rounds" (only round results so far) or null.
const attachResults = async (items) => {
    const eventIds = items
        .filter((event) => [EVENT_STATUS.PUBLISHED, EVENT_STATUS.COMPLETED].includes(event.status))
        .map((event) => event._id);

    if (!eventIds.length) {
        return items.map((event) => ({ ...event, result: null, resultStage: null, latestRound: null }));
    }

    const results = await EventResult.find({
        event: { $in: eventIds },
        $or: [{ status: RESULT_STATUS.PUBLISHED }, { "rounds.status": RESULT_STATUS.PUBLISHED }]
    })
        .select("event summary awards publishedAt status rounds.name rounds.status rounds.publishedAt")
        .populate("awards.recipientUser", "name")
        .lean();
    const byEvent = new Map(results.map((result) => [String(result.event), result]));

    return items.map((event) => {
        const found = byEvent.get(String(event._id));
        if (!found) {
            return { ...event, result: null, resultStage: null, latestRound: null };
        }
        const final = found.status === RESULT_STATUS.PUBLISHED;
        const rounds = found.rounds.filter((round) => round.status === RESULT_STATUS.PUBLISHED).sort((a, b) => b.publishedAt - a.publishedAt);
        return {
            ...event,
            result: final ? { _id: found._id, summary: found.summary, awards: found.awards, publishedAt: found.publishedAt } : null,
            resultStage: final ? "final" : "rounds",
            latestRound: rounds[0] ? { name: rounds[0].name, publishedAt: rounds[0].publishedAt } : null
        };
    });
};

const attachRegistrations = async (actor, events) => {
    const items = await attachResults(events.map((event) => serialize(event)));

    if (!actor || !items.length) {
        return items;
    }

    const registrations = await EventRegistration.find({
        user: actor._id,
        event: { $in: items.map((event) => event._id) }
    }).select("event status");
    const byEvent = new Map(registrations.map((registration) => [String(registration.event), registration.status]));

    return items.map((event) => ({ ...event, myRegistration: byEvent.get(String(event._id)) || null }));
};

const TIMEFRAMES = {
    upcoming: (now) => ({ filter: { status: EVENT_STATUS.PUBLISHED, startAt: { $gt: now } }, sort: { startAt: 1 } }),
    ongoing: (now) => ({
        filter: { status: EVENT_STATUS.PUBLISHED, startAt: { $lte: now }, endAt: { $gt: now } },
        sort: { endAt: 1 }
    }),
    past: (now) => ({
        filter: {
            $or: [{ status: EVENT_STATUS.COMPLETED }, { status: EVENT_STATUS.PUBLISHED, endAt: { $lte: now } }]
        },
        sort: { startAt: -1 }
    }),
    all: () => ({ filter: { status: { $in: PUBLIC_EVENT_STATUSES } }, sort: { startAt: -1 } })
};

// Search/category/club filters shared by the feed list and its per-tab counts.
const discoveryFilters = (query) => {
    const filter = {};
    if (query.category) {
        filter.category = String(query.category).toUpperCase();
    }
    if (query.club) {
        filter.club = query.club;
    }
    if (query.search) {
        filter.title = searchRegex(query.search);
    }
    return filter;
};

const timeframeCounts = async (query, now) => {
    const shared = discoveryFilters(query);
    const [upcoming, ongoing, past] = await Promise.all(
        ["upcoming", "ongoing", "past"].map((key) => Event.countDocuments({ ...TIMEFRAMES[key](now).filter, ...shared }))
    );
    return { upcoming, ongoing, past };
};

const listEvents = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 12 });
    const now = new Date();
    const timeframe = TIMEFRAMES[query.timeframe] ? query.timeframe : "upcoming";
    const { filter, sort } = TIMEFRAMES[timeframe](now);

    Object.assign(filter, discoveryFilters(query));
    if (query.registrationOpen === "true") {
        filter.status = EVENT_STATUS.PUBLISHED;
        filter.registrationClosed = false;
        filter.registrationStart = { $lte: now };
        filter.registrationEnd = { $gte: now };
        filter.$expr = {
            $or: [{ $eq: ["$maxParticipants", null] }, { $lt: ["$registeredCount", "$maxParticipants"] }]
        };
    }

    const [events, total, counts] = await Promise.all([
        populateEvent(Event.find(filter).sort(sort).skip(pagination.skip).limit(pagination.limit)),
        Event.countDocuments(filter),
        query.withCounts === "true" ? timeframeCounts(query, now) : null
    ]);

    return {
        items: await attachRegistrations(actor, events),
        timeframe,
        ...(counts ? { counts } : {}),
        ...paginationMeta(pagination, total)
    };
};

// Clubs whose events the user helps run: mentored clubs for faculty, officer roles for students.
const manageableClubIds = async (actor) => {
    if (isFaculty(actor)) {
        const clubs = await Club.find({ mentor: actor._id }).select("_id");
        return clubs.map((club) => club._id);
    }

    const staffRoles = Object.keys(CLUB_ROLE_PERMISSIONS).filter((role) =>
        [CLUB_PERMISSIONS.MANAGE_EVENTS, CLUB_PERMISSIONS.PUBLISH_EVENTS, CLUB_PERMISSIONS.VIEW_PARTICIPANTS].some((p) =>
            CLUB_ROLE_PERMISSIONS[role].includes(p)
        )
    );
    const memberships = await ClubMembership.find({
        user: actor._id,
        status: MEMBERSHIP_STATUS.APPROVED,
        role: { $in: staffRoles }
    }).select("club");
    return memberships.map((membership) => membership.club);
};

const listManagedEvents = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 20 });
    // Only clubs the user runs (officer roles) or mentors; the university admin has none.
    const filter = { club: { $in: await manageableClubIds(actor) } };

    if (query.club) {
        filter.club = filter.club.$in.some((id) => String(id) === String(query.club)) ? query.club : { $in: [] };
    }

    if (query.status) {
        const statuses = String(query.status)
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => Object.values(EVENT_STATUS).includes(s));
        if (statuses.length) {
            filter.status = { $in: statuses };
        }
    }

    if (query.search) {
        filter.title = searchRegex(query.search);
    }

    const [events, total] = await Promise.all([
        populateEvent(Event.find(filter).sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        Event.countDocuments(filter)
    ]);

    return { items: events.map((event) => serialize(event)), ...paginationMeta(pagination, total) };
};

const listClubEvents = async (actor, clubId, query = {}) => {
    const context = await getClubContext(actor, clubId);
    const isStaff = context.isMentor || contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS) || contextHas(context, CLUB_PERMISSIONS.PUBLISH_EVENTS);
    const pagination = parsePagination(query, { defaultLimit: 20 });
    const filter = { club: context.club._id };

    if (isStaff && query.status) {
        filter.status = String(query.status).toUpperCase();
    } else if (!isStaff) {
        filter.status = { $in: PUBLIC_EVENT_STATUSES };
    }

    const [events, total] = await Promise.all([
        populateEvent(Event.find(filter).sort({ startAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        Event.countDocuments(filter)
    ]);

    return { items: await attachRegistrations(actor, events), isStaff, ...paginationMeta(pagination, total) };
};

module.exports = {
    createDraft,
    getEventDetail,
    listEvents,
    listManagedEvents,
    listClubEvents,
    updateEvent,
    submitEvent,
    approveEvent,
    requestEventChanges,
    rejectEvent,
    publishEvent,
    cancelEvent,
    completeEvent,
    registrationWindowState,
    manageableClubIds
};
