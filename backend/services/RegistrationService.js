const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    EVENT_STATUS,
    REGISTRATION_STATUS,
    PUBLIC_EVENT_STATUSES,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { searchRegex } = require("../utils/Query");
const { formatDateKey } = require("../utils/UniversityRules");
const {
    assertVerified,
    assertStudent,
    assertClubPermission,
    assertCanViewParticipants
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { promoteFromWaitlist, waitlistPosition, reserveSeat, releaseSeat, adjustWaitlistCount } = require("./WaitlistService");

const findEvent = async (eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return event;
};

const eligibilityProblem = (user, event) => {
    const departments = event.eligibility?.departments || [];
    const batches = event.eligibility?.batches || [];

    if (departments.length && !departments.includes(user.departmentCode)) {
        return `This event is open to ${departments.join(", ")} students only`;
    }

    if (batches.length && !batches.includes(user.batchCode)) {
        return `This event is open to batch ${batches.map((b) => `20${b}`).join(", ")} only`;
    }

    return null;
};

const assertCanRegister = (actor, event, now = new Date()) => {
    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Registration is only available for published events", 400, ERROR_CODES.INVALID_STATE);
    }

    if (event.registrationClosed) {
        throw new AppError("Registration for this event is closed", 400, ERROR_CODES.REGISTRATION_CLOSED);
    }

    if (now < event.registrationStart) {
        throw new AppError("Registration has not opened yet", 400, ERROR_CODES.REGISTRATION_NOT_OPEN);
    }

    if (now > event.registrationEnd || now >= event.startAt) {
        throw new AppError("The registration deadline has passed", 400, ERROR_CODES.REGISTRATION_CLOSED);
    }

    const problem = eligibilityProblem(actor, event);
    if (problem) {
        throw new AppError(problem, 403, ERROR_CODES.NOT_ELIGIBLE);
    }
};

const eventDateLabel = (event) => `${formatDateKey(event.eventDate)} at ${event.startTime}`;

// Puts the student in the queue for a full event (re-using a cancelled registration if there is one).
const joinWaitlist = async (actor, event, existing) => {
    const now = new Date();
    let registration;
    try {
        registration = existing
            ? await EventRegistration.findOneAndUpdate(
                  { _id: existing._id, status: REGISTRATION_STATUS.CANCELLED },
                  { $set: { status: REGISTRATION_STATUS.WAITLISTED, waitlistedAt: now, promotedAt: null } },
                  { returnDocument: "after" }
              )
            : await EventRegistration.create({ event: event._id, user: actor._id, status: REGISTRATION_STATUS.WAITLISTED, waitlistedAt: now });
    } catch (error) {
        if (error.code === 11000) {
            throw new AppError("You are already registered or on the waitlist for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
        }
        throw error;
    }
    if (!registration) {
        throw new AppError("You are already registered or on the waitlist for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }

    await adjustWaitlistCount(event._id, 1);

    await recordAudit({
        action: AUDIT_ACTIONS.WAITLIST_JOINED,
        actor: actor._id,
        targetType: "EventRegistration",
        targetId: registration._id,
        toState: REGISTRATION_STATUS.WAITLISTED,
        metadata: { eventId: event._id }
    });

    // A seat may have been freed between our failed reservation and joining the queue; fill it now.
    await promoteFromWaitlist(event._id, { reason: "joined_while_seat_free" });

    const current = await EventRegistration.findById(registration._id);
    if (current.status === REGISTRATION_STATUS.REGISTERED) {
        const fresh = await Event.findById(event._id).select("registeredCount maxParticipants waitlistCount");
        return { registration: current, waitlisted: false, registeredCount: fresh.registeredCount, maxParticipants: fresh.maxParticipants, waitlistCount: fresh.waitlistCount };
    }

    const position = await waitlistPosition(current);
    await notify(actor._id, {
        type: NOTIFICATION_TYPES.WAITLISTED,
        title: `You're #${position} on the waitlist for ${event.title}`,
        message: "The event is full. If a seat frees up you'll be registered automatically and we'll email you.",
        link: `/events/${event._id}`,
        email: true
    });

    const fresh = await Event.findById(event._id).select("registeredCount maxParticipants waitlistCount");
    return {
        registration: current,
        waitlisted: true,
        waitlistPosition: position,
        registeredCount: fresh.registeredCount,
        maxParticipants: fresh.maxParticipants,
        waitlistCount: fresh.waitlistCount
    };
};

const registerForEvent = async (actor, eventId) => {
    assertVerified(actor);
    assertStudent(actor, "Only students can register for events");

    const event = await findEvent(eventId);
    assertCanRegister(actor, event);

    const existing = await EventRegistration.findOne({ event: event._id, user: actor._id });

    if (existing?.status === REGISTRATION_STATUS.REGISTERED) {
        throw new AppError("You are already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }
    if (existing?.status === REGISTRATION_STATUS.WAITLISTED) {
        const position = await waitlistPosition(existing);
        throw new AppError(`You are already on the waitlist (#${position})`, 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }

    // Students already waiting keep their place: a newcomer only gets a seat directly when nobody is queued.
    const queueExists = await EventRegistration.exists({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED });

    // Reserve a seat first: the conditional $inc is atomic, so concurrent registrations cannot overfill.
    const reserved = queueExists ? null : await reserveSeat(event);

    if (!reserved) {
        return joinWaitlist(actor, event, existing);
    }

    let registration;
    try {
        if (existing) {
            // Unique (event, user) index plus the status guard stop two parallel re-registrations.
            registration = await EventRegistration.findOneAndUpdate(
                { _id: existing._id, status: REGISTRATION_STATUS.CANCELLED },
                { $set: { status: REGISTRATION_STATUS.REGISTERED, registeredAt: new Date(), waitlistedAt: null, promotedAt: null } },
                { returnDocument: "after" }
            );
            if (!registration) {
                throw new AppError("You are already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
            }
        } else {
            registration = await EventRegistration.create({
                event: event._id,
                user: actor._id,
                status: REGISTRATION_STATUS.REGISTERED
            });
        }
    } catch (error) {
        await releaseSeat(event._id);

        if (error.code === 11000) {
            throw new AppError("You are already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
        }
        throw error;
    }

    await recordAudit({
        action: AUDIT_ACTIONS.STUDENT_REGISTERED,
        actor: actor._id,
        targetType: "EventRegistration",
        targetId: registration._id,
        toState: REGISTRATION_STATUS.REGISTERED,
        metadata: { eventId: event._id }
    });

    await notify(actor._id, {
        type: NOTIFICATION_TYPES.REGISTRATION_CONFIRMED,
        title: `You're registered for ${event.title}`,
        message: `See you on ${eventDateLabel(event)}.`,
        link: `/events/${event._id}`,
        email: true
    });

    return {
        registration,
        waitlisted: false,
        registeredCount: reserved.registeredCount,
        maxParticipants: reserved.maxParticipants,
        waitlistCount: reserved.waitlistCount
    };
};

// Cancels a registration or leaves the waitlist. A freed seat goes to the first person waiting.
const cancelRegistration = async (actor, eventId) => {
    const event = await findEvent(eventId);

    if (event.status !== EVENT_STATUS.PUBLISHED || event.startAt <= new Date()) {
        throw new AppError("Registrations can only be cancelled before the event starts", 409, ERROR_CODES.INVALID_STATE);
    }

    const registration = await EventRegistration.findOneAndUpdate(
        { event: event._id, user: actor._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } },
        { $set: { status: REGISTRATION_STATUS.CANCELLED } }
    );

    if (!registration) {
        throw new AppError("You are not registered for this event", 404, ERROR_CODES.NOT_FOUND);
    }

    const wasWaitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;

    if (wasWaitlisted) {
        await adjustWaitlistCount(event._id, -1);
    } else {
        await releaseSeat(event._id);
    }

    await recordAudit({
        action: wasWaitlisted ? AUDIT_ACTIONS.WAITLIST_LEFT : AUDIT_ACTIONS.REGISTRATION_CANCELLED,
        actor: actor._id,
        targetType: "EventRegistration",
        targetId: registration._id,
        fromState: registration.status,
        toState: REGISTRATION_STATUS.CANCELLED,
        metadata: { eventId: event._id }
    });

    const promoted = wasWaitlisted ? 0 : await promoteFromWaitlist(event._id, { reason: "registration_cancelled" });
    const fresh = await Event.findById(event._id).select("registeredCount maxParticipants waitlistCount");
    return { leftWaitlist: wasWaitlisted, promoted, registeredCount: fresh.registeredCount, maxParticipants: fresh.maxParticipants, waitlistCount: fresh.waitlistCount };
};

const listParticipants = async (actor, eventId, query = {}) => {
    const event = await findEvent(eventId);
    await assertCanViewParticipants(actor, event.club, CLUB_PERMISSIONS.VIEW_PARTICIPANTS);

    const registrations = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED })
        .populate("user", "name email departmentCode batchCode")
        .sort({ registeredAt: 1 });

    const queued = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED })
        .populate("user", "name email departmentCode batchCode")
        .sort({ waitlistedAt: 1, _id: 1 });

    let items = registrations.filter((registration) => registration.user);
    let waitlist = queued.filter((registration) => registration.user).map((registration, index) => ({ ...registration.toObject(), position: index + 1 }));

    if (query.search) {
        const pattern = new RegExp(searchRegex(query.search).$regex, "i");
        const matches = (registration) => pattern.test(registration.user.name) || pattern.test(registration.user.email);
        items = items.filter(matches);
        waitlist = waitlist.filter(matches);
    }

    return {
        items,
        waitlist,
        event: {
            _id: event._id,
            title: event.title,
            status: event.status,
            registeredCount: event.registeredCount,
            maxParticipants: event.maxParticipants,
            waitlistCount: event.waitlistCount
        }
    };
};

const removeParticipant = async (actor, eventId, registrationId, reason = null) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_PARTICIPANTS, "You cannot manage participants for this club");

    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Participants can only be removed from upcoming published events", 409, ERROR_CODES.INVALID_STATE);
    }

    const registration = await EventRegistration.findOneAndUpdate(
        { _id: registrationId, event: event._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } },
        { $set: { status: REGISTRATION_STATUS.CANCELLED } }
    );

    if (!registration) {
        throw new AppError("Registration not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const wasWaitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;
    if (wasWaitlisted) {
        await adjustWaitlistCount(event._id, -1);
    } else {
        await releaseSeat(event._id);
    }

    await recordAudit({
        action: AUDIT_ACTIONS.PARTICIPANT_REMOVED,
        actor: actor._id,
        targetType: "EventRegistration",
        targetId: registration._id,
        fromState: registration.status,
        toState: REGISTRATION_STATUS.CANCELLED,
        reason,
        metadata: { eventId: event._id, userId: registration.user }
    });

    if (!wasWaitlisted) {
        await promoteFromWaitlist(event._id, { reason: "participant_removed" });
    }

    await notify(registration.user, {
        type: NOTIFICATION_TYPES.REGISTRATION_REMOVED,
        title: `Your registration for ${event.title} was cancelled by the organisers`,
        message: reason || "",
        link: `/events/${event._id}`,
        email: true
    });
};

const getPublicRegistrationCount = async (eventId) => {
    const event = await Event.findById(eventId).select("registeredCount maxParticipants status");

    if (!event || !PUBLIC_EVENT_STATUSES.includes(event.status)) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return {
        registeredCount: event.registeredCount,
        maxParticipants: event.maxParticipants
    };
};

// includeWaitlist=true adds waitlisted events (with the student's place in the queue).
const getMyRegistrations = async (actor, query = {}) => {
    const statuses = [REGISTRATION_STATUS.REGISTERED, ...(String(query.includeWaitlist) === "true" ? [REGISTRATION_STATUS.WAITLISTED] : [])];
    const registrations = await EventRegistration.find({ user: actor._id, status: { $in: statuses } })
        .populate({
            path: "event",
            select: "title shortDescription poster startAt endAt startTime endTime status club venue registeredCount maxParticipants category",
            populate: [
                { path: "club", select: "name logo" },
                { path: "venue", select: "name location" }
            ]
        })
        .sort({ registeredAt: -1 });

    const now = new Date();
    let items = registrations.filter((registration) => registration.event);

    if (query.timeframe === "upcoming") {
        items = items.filter((r) => r.event.endAt > now && r.event.status === EVENT_STATUS.PUBLISHED);
        items.sort((a, b) => a.event.startAt - b.event.startAt);
    } else if (query.timeframe === "past") {
        items = items.filter((r) => r.event.endAt <= now || r.event.status !== EVENT_STATUS.PUBLISHED);
    }

    if (statuses.includes(REGISTRATION_STATUS.WAITLISTED)) {
        return Promise.all(
            items.map(async (registration) => ({ ...registration.toObject(), waitlistPosition: await waitlistPosition(registration) }))
        );
    }

    return items;
};

module.exports = {
    registerForEvent,
    cancelRegistration,
    listParticipants,
    removeParticipant,
    getPublicRegistrationCount,
    getMyRegistrations,
    eligibilityProblem
};
