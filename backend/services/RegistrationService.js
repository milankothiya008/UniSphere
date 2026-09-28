const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    EVENT_STATUS,
    REGISTRATION_STATUS,
    PUBLIC_EVENT_STATUSES,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES,
    PARTICIPATION_MODES,
    TEAM_MEMBER_STATUS
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
const teams = require("./TeamService");
const { withTicketRetry, sendTicketEmail } = require("./TicketService");
const Team = require("../models/Team");

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
const joinWaitlist = async (actor, event, existing, teamFields) => {
    const now = new Date();
    let registration;
    try {
        registration = existing
            ? await EventRegistration.findOneAndUpdate(
                  { _id: existing._id, status: REGISTRATION_STATUS.CANCELLED },
                  { $set: { status: REGISTRATION_STATUS.WAITLISTED, waitlistedAt: now, promotedAt: null, ...teamFields } },
                  { returnDocument: "after" }
              )
            : await EventRegistration.create({ event: event._id, user: actor._id, status: REGISTRATION_STATUS.WAITLISTED, waitlistedAt: now, ...teamFields });
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
        title: `${teamFields.team ? "Your team is" : "You're"} #${position} on the waitlist for ${event.title}`,
        message: teamFields.team
            ? "The event is full. If a place frees up your whole team is registered automatically and we'll email everyone."
            : "The event is full. If a seat frees up you'll be registered automatically and we'll email you.",
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

/**
 * Registers a student. For team events the student registers a team as its leader (body.teamName, and
 * optionally body.invitees: students to invite); the team takes one place and teammates join by accepting.
 */
const registerForEvent = async (actor, eventId, body = {}) => {
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

    if (event.participationMode !== PARTICIPATION_MODES.TEAM) {
        return takePlace(actor, event, existing, { team: null, teamRole: null });
    }

    const { team, invitees } = await teams.createTeam(actor, event, { teamName: body.teamName, invitees: body.invitees });
    let result;
    try {
        result = await takePlace(actor, event, existing, { team: team._id, teamRole: "LEADER" }, team);
    } catch (error) {
        await teams.discardTeam(team);
        throw error;
    }
    await teams.afterTeamCreated(team, event, actor, invitees);
    return { ...result, team: await teams.getTeamView(team._id, event) };
};

// Takes a place (or a waitlist spot) for one registration: a student, or a team through its leader.
const takePlace = async (actor, event, existing, teamFields, team = null) => {
    // Students already waiting keep their place: a newcomer only gets a seat directly when nobody is queued.
    const queueExists = await EventRegistration.exists({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED });

    // Reserve a seat first: the conditional $inc is atomic, so concurrent registrations cannot overfill.
    const reserved = queueExists ? null : await reserveSeat(event);

    if (!reserved) {
        return joinWaitlist(actor, event, existing, teamFields);
    }

    let registration;
    try {
        // A place always comes with a fresh ticket (a re-registration invalidates the old QR).
        registration = await withTicketRetry((ticket) =>
            existing
                ? // Unique (event, user) index plus the status guard stop two parallel re-registrations.
                  EventRegistration.findOneAndUpdate(
                      { _id: existing._id, status: REGISTRATION_STATUS.CANCELLED },
                      { $set: { status: REGISTRATION_STATUS.REGISTERED, registeredAt: new Date(), waitlistedAt: null, promotedAt: null, ...teamFields, ...ticket } },
                      { returnDocument: "after" }
                  )
                : EventRegistration.create({
                      event: event._id,
                      user: actor._id,
                      status: REGISTRATION_STATUS.REGISTERED,
                      ...teamFields,
                      ...ticket
                  })
        );
        if (!registration) {
            throw new AppError("You are already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
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
        title: team ? `"${team.name}" is registered for ${event.title}` : `You're registered for ${event.title}`,
        message: team
            ? `You're the team leader. Your teammates join by accepting your invites; teams need at least ${event.minTeamSize} member${event.minTeamSize === 1 ? "" : "s"}. See you on ${eventDateLabel(event)}.`
            : `See you on ${eventDateLabel(event)}. Your ticket is ready — show its QR code at the entrance.`,
        link: `/events/${event._id}`
    });
    // The ticket (QR + code) goes by email instead of the plain confirmation.
    await sendTicketEmail(registration._id, { reason: team ? "team" : "registered" });

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

    const current = await EventRegistration.findOne({ event: event._id, user: actor._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } });
    if (current?.teamRole === "MEMBER") {
        const left = await teams.leaveTeam(actor, event, current);
        const fresh = await Event.findById(event._id).select("registeredCount maxParticipants waitlistCount");
        return { ...left, leftWaitlist: false, promoted: 0, registeredCount: fresh.registeredCount, maxParticipants: fresh.maxParticipants, waitlistCount: fresh.waitlistCount };
    }

    const registration = await EventRegistration.findOneAndUpdate(
        { event: event._id, user: actor._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } },
        { $set: { status: REGISTRATION_STATUS.CANCELLED } }
    );

    if (!registration) {
        throw new AppError("You are not registered for this event", 404, ERROR_CODES.NOT_FOUND);
    }

    const wasWaitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;

    if (!wasWaitlisted) {
        // In-app only: the student did this themselves; it just records that the ticket is gone.
        await notify(actor._id, {
            type: NOTIFICATION_TYPES.REGISTRATION_REMOVED,
            title: `You cancelled your registration for ${event.title}`,
            message: "Your ticket is no longer valid. You can register again while registration is open.",
            link: `/events/${event._id}`
        });
    }

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

    if (registration.teamRole === "LEADER") {
        await teams.disbandTeam(registration.team, event, { actor });
    }

    const promoted = wasWaitlisted ? 0 : await promoteFromWaitlist(event._id, { reason: "registration_cancelled" });
    const fresh = await Event.findById(event._id).select("registeredCount maxParticipants waitlistCount");
    return {
        leftWaitlist: wasWaitlisted,
        disbandedTeam: registration.teamRole === "LEADER",
        promoted,
        registeredCount: fresh.registeredCount,
        maxParticipants: fresh.maxParticipants,
        waitlistCount: fresh.waitlistCount
    };
};

const listParticipants = async (actor, eventId, query = {}) => {
    const event = await findEvent(eventId);
    await assertCanViewParticipants(actor, event.club, CLUB_PERMISSIONS.VIEW_PARTICIPANTS);

    const registrations = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED })
        .populate("user", "name email departmentCode batchCode")
        .populate("team", "name size")
        .populate("checkedInBy", "name")
        .sort({ registeredAt: 1 });

    // The waitlist lists places in the queue: students, or teams through their leader.
    const queued = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED, teamRole: { $ne: "MEMBER" } })
        .populate("user", "name email departmentCode batchCode")
        .populate("team", "name size")
        .sort({ waitlistedAt: 1, _id: 1 });

    let items = registrations.filter((registration) => registration.user);
    let waitlist = queued.filter((registration) => registration.user).map((registration, index) => ({ ...registration.toObject(), position: index + 1 }));

    if (query.search) {
        const pattern = new RegExp(searchRegex(query.search).$regex, "i");
        const matches = (registration) => pattern.test(registration.user.name) || pattern.test(registration.user.email);
        items = items.filter(matches);
        waitlist = waitlist.filter(matches);
    }

    const isTeamEvent = event.participationMode === PARTICIPATION_MODES.TEAM;
    const teamList = isTeamEvent
        ? await Promise.all((await Team.find({ event: event._id, status: "ACTIVE" }).select("_id").sort({ createdAt: 1 }).lean()).map((team) => teams.getTeamView(team._id, event)))
        : [];

    return {
        items,
        waitlist,
        teams: teamList,
        event: {
            _id: event._id,
            title: event.title,
            status: event.status,
            registeredCount: event.registeredCount,
            maxParticipants: event.maxParticipants,
            waitlistCount: event.waitlistCount,
            attendedCount: items.filter((row) => row.checkedInAt).length,
            checkIn: event.checkIn,
            participationMode: event.participationMode,
            minTeamSize: event.minTeamSize,
            maxTeamSize: event.maxTeamSize
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

    if (registration.teamRole === "MEMBER") {
        const team = await Team.findOneAndUpdate(
            { _id: registration.team, members: { $elemMatch: { user: registration.user, status: TEAM_MEMBER_STATUS.ACCEPTED } } },
            { $set: { "members.$.status": TEAM_MEMBER_STATUS.REMOVED, "members.$.respondedAt": new Date() }, $inc: { size: -1 } },
            { returnDocument: "after" }
        );
        await recordAudit({
            action: AUDIT_ACTIONS.PARTICIPANT_REMOVED,
            actor: actor._id,
            targetType: "EventRegistration",
            targetId: registration._id,
            fromState: registration.status,
            toState: REGISTRATION_STATUS.CANCELLED,
            reason,
            metadata: { eventId: event._id, userId: registration.user, teamId: registration.team }
        });
        await notify(registration.user, {
            type: NOTIFICATION_TYPES.REGISTRATION_REMOVED,
            title: `The organisers removed you from ${team ? `"${team.name}" for ` : ""}${event.title}`,
            message: `${reason ? `${reason} ` : ""}Your ticket is no longer valid.`,
            link: `/events/${event._id}`,
            email: true
        });
        if (team) {
            await notify(team.leader, {
                type: NOTIFICATION_TYPES.TEAM_UPDATE,
                title: `The organisers removed a member from "${team.name}"`,
                message: reason || "",
                link: `/events/${event._id}`
            });
        }
        return;
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

    if (registration.teamRole === "LEADER") {
        await teams.disbandTeam(registration.team, event, { actor, byOrganiser: true, reason });
    }

    if (!wasWaitlisted) {
        await promoteFromWaitlist(event._id, { reason: "participant_removed" });
    }

    await notify(registration.user, {
        type: NOTIFICATION_TYPES.REGISTRATION_REMOVED,
        title: `Your registration for ${event.title} was cancelled by the organisers`,
        message: `${reason ? `${reason} ` : ""}Your ticket is no longer valid.`,
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
            select: "title shortDescription poster startAt endAt startTime endTime status club venue registeredCount maxParticipants category participationMode minTeamSize maxTeamSize",
            populate: [
                { path: "club", select: "name logo" },
                { path: "venue", select: "name location" }
            ]
        })
        .populate("team", "name size")
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
