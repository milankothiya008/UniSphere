const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS, CHECK_IN_STATUS, CHECK_IN_METHODS, AUDIT_ACTIONS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { searchRegex } = require("../utils/Query");
const { formatTime } = require("../utils/CampusTime");
const { readTicketToken, normalizeTicketCode } = require("../utils/TicketToken");
const { assertClubPermission, contextHas } = require("./AuthorizationService");
const { clubUsersWithPermission } = require("./MembershipService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { getEventDetail } = require("./EventService");

// Check-in at the door. The president opens check-in for a published event; while it is open every club
// officer can scan a ticket's QR code, type its code, or find the student by name or email and mark them
// present. Attendance counts are always computed from registrations, so undoing a check-in can't drift.

const RESULTS = Object.freeze({
    CHECKED_IN: "CHECKED_IN",
    ALREADY_CHECKED_IN: "ALREADY_CHECKED_IN",
    INVALID_TICKET: "INVALID_TICKET",
    NOT_REGISTERED: "NOT_REGISTERED",
    WRONG_EVENT: "WRONG_EVENT",
    NOT_FOUND: "NOT_FOUND",
    UNMARKED: "UNMARKED"
});

const REGISTERED = REGISTRATION_STATUS.REGISTERED;
const USER_FIELDS = "name email departmentCode batchCode";

const findEvent = async (eventId) => {
    const event = await Event.findById(eventId);
    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return event;
};

const counts = async (eventId) => {
    const [registered, attended] = await Promise.all([
        EventRegistration.countDocuments({ event: eventId, status: REGISTERED }),
        EventRegistration.countDocuments({ event: eventId, status: REGISTERED, checkedInAt: { $ne: null } })
    ]);
    return { registered, attended };
};

const populateAttendee = (query) => query.populate("user", USER_FIELDS).populate("team", "name").populate("checkedInBy", "name");

const attendeeView = (registration) => {
    const user = registration.user || {};
    return {
        registrationId: registration._id,
        name: user.name || "Former student",
        email: user.email || null,
        departmentCode: user.departmentCode || null,
        batchCode: user.batchCode || null,
        team: registration.team ? registration.team.name : null,
        teamRole: registration.teamRole || null,
        ticketCode: registration.ticketCode || null,
        checkedInAt: registration.checkedInAt || null,
        checkInMethod: registration.checkInMethod || null,
        checkedInBy: registration.checkedInBy ? registration.checkedInBy.name : null
    };
};

const assertOpen = (event) => {
    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Check-in is only available for published events", 409, ERROR_CODES.INVALID_STATE);
    }
    if (event.checkIn?.status !== CHECK_IN_STATUS.OPEN) {
        throw new AppError("Check-in is not open. The club president can open it from the event page.", 409, ERROR_CODES.INVALID_STATE);
    }
};

const checkInAudit = (event, actor, action, targetId, metadata = {}) =>
    recordAudit({ action, actor: actor._id, targetType: "Event", targetId, metadata: { eventId: event._id, clubId: event.club, ...metadata } });

// ---------------------------------------------------------------- Opening and closing (president)

const openCheckIn = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const { club } = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_CHECK_IN, "Only the club president can open check-in");
    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Check-in can only be opened for published events", 409, ERROR_CODES.INVALID_STATE);
    }
    if (event.checkIn?.status === CHECK_IN_STATUS.OPEN) {
        throw new AppError("Check-in is already open", 409, ERROR_CODES.INVALID_STATE);
    }

    const reopened = event.checkIn?.status === CHECK_IN_STATUS.CLOSED;
    event.checkIn = { ...(event.checkIn?.toObject?.() || event.checkIn), status: CHECK_IN_STATUS.OPEN, openedAt: new Date(), openedBy: actor._id, closedAt: null, closedBy: null };
    await event.save();
    await checkInAudit(event, actor, AUDIT_ACTIONS.CHECK_IN_OPENED, event._id, { reopened });

    await notify(await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MARK_ATTENDANCE), {
        type: NOTIFICATION_TYPES.CHECK_IN_OPEN,
        title: `Check-in is open for ${event.title}`,
        message: "Scan tickets at the entrance, or search students by name or email to mark them present.",
        link: `/events/${event._id}/check-in`,
        exclude: [actor._id]
    });

    return getEventDetail(actor, event._id);
};

const closeCheckIn = async (actor, eventId) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_CHECK_IN, "Only the club president can close check-in");
    if (event.checkIn?.status !== CHECK_IN_STATUS.OPEN) {
        throw new AppError("Check-in is not open", 409, ERROR_CODES.INVALID_STATE);
    }

    event.checkIn.status = CHECK_IN_STATUS.CLOSED;
    event.checkIn.closedAt = new Date();
    event.checkIn.closedBy = actor._id;
    await event.save();
    await checkInAudit(event, actor, AUDIT_ACTIONS.CHECK_IN_CLOSED, event._id);

    return getEventDetail(actor, event._id);
};

// ---------------------------------------------------------------- What the scanner page shows

const getCheckInStatus = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const context = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MARK_ATTENDANCE, "Only club officers can run check-in");

    const recent = await populateAttendee(
        EventRegistration.find({ event: event._id, status: REGISTERED, checkedInAt: { $ne: null } }).sort({ checkedInAt: -1 }).limit(10)
    );

    return {
        event: {
            _id: event._id,
            title: event.title,
            status: event.status,
            startAt: event.startAt,
            endAt: event.endAt,
            participationMode: event.participationMode,
            venue: event.venue
        },
        checkIn: event.checkIn,
        counts: await counts(event._id),
        recent: recent.map(attendeeView),
        canManage: contextHas(context, CLUB_PERMISSIONS.MANAGE_CHECK_IN)
    };
};

// Registered students for the search tab. Deliberately a limited view (no registration management), so every
// officer can check people in even without the participants permission.
const listForCheckIn = async (actor, eventId, { search = "" } = {}) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MARK_ATTENDANCE, "Only club officers can run check-in");

    const filter = { event: event._id, status: REGISTERED };
    const text = String(search || "").trim();
    if (text) {
        const pattern = searchRegex(text);
        const users = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select("_id").lean();
        filter.user = { $in: users.map((user) => user._id) };
    }

    const rows = await populateAttendee(EventRegistration.find(filter).limit(300));
    return rows
        .filter((row) => row.user)
        .map(attendeeView)
        .sort((a, b) => a.name.localeCompare(b.name));
};

// ---------------------------------------------------------------- Marking attendance

const notRegistered = (registration) => ({
    result: RESULTS.NOT_REGISTERED,
    message: registration.status === REGISTRATION_STATUS.WAITLISTED ? "This student is on the waitlist, not registered" : "Registration was cancelled — ticket no longer valid",
    registration
});

// Finds the registration a scan, code or manual pick refers to, or explains why it can't be used.
const resolve = async (event, { token, code, registrationId }) => {
    let registration;

    if (token) {
        const parsed = readTicketToken(token);
        if (!parsed) {
            return { result: RESULTS.INVALID_TICKET, message: "This QR code is not a valid ticket" };
        }
        registration = await populateAttendee(EventRegistration.findById(parsed.registrationId));
        if (!registration) {
            return { result: RESULTS.INVALID_TICKET, message: "This QR code is not a valid ticket" };
        }
        if (String(registration.event) !== String(event._id)) {
            return wrongEvent(registration);
        }
        if (registration.ticketCode !== parsed.ticketCode) {
            return { result: RESULTS.INVALID_TICKET, message: "This ticket was replaced — ask the student to open their current ticket", registration };
        }
    } else if (code !== undefined) {
        const normalized = normalizeTicketCode(code);
        if (!normalized) {
            return { result: RESULTS.NOT_FOUND, message: "Enter a ticket code like CC-7K3M9QWA" };
        }
        registration = await populateAttendee(EventRegistration.findOne({ ticketCode: normalized }));
        if (!registration) {
            return { result: RESULTS.NOT_FOUND, message: `No ticket with code ${normalized}` };
        }
        if (String(registration.event) !== String(event._id)) {
            return wrongEvent(registration);
        }
    } else {
        registration = await populateAttendee(EventRegistration.findOne({ _id: registrationId, event: event._id }));
        if (!registration) {
            return { result: RESULTS.NOT_FOUND, message: "Registration not found" };
        }
    }

    if (registration.status !== REGISTERED) {
        return notRegistered(registration);
    }
    return { registration };
};

const wrongEvent = async (registration) => {
    const other = await Event.findById(registration.event).select("title");
    return { result: RESULTS.WRONG_EVENT, message: `This ticket is for "${other?.title || "another event"}"`, registration };
};

const outcome = async (event, { result, message, registration }) => ({
    result,
    message,
    attendee: registration ? attendeeView(registration) : null,
    counts: await counts(event._id)
});

/**
 * Marks a student present from a scanned token, a typed ticket code, or a registration picked from the search
 * list. Every outcome is a normal 200 with `result`; only permission and "check-in not open" are errors.
 */
const markAttendance = async (actor, eventId, { token, code, registrationId, note } = {}, method = CHECK_IN_METHODS.MANUAL) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MARK_ATTENDANCE, "Only club officers can mark attendance");
    assertOpen(event);

    const resolved = await resolve(event, { token, code, registrationId });
    if (resolved.result) {
        return outcome(event, resolved);
    }

    const now = new Date();
    const updated = await populateAttendee(
        EventRegistration.findOneAndUpdate(
            { _id: resolved.registration._id, event: event._id, status: REGISTERED, checkedInAt: null },
            { $set: { checkedInAt: now, checkedInBy: actor._id, checkInMethod: method, checkInNote: note ? String(note).trim().slice(0, 200) : null } },
            { returnDocument: "after" }
        )
    );

    if (!updated) {
        // Someone else scanned it a moment ago, or it was cancelled in the meantime.
        const current = await populateAttendee(EventRegistration.findById(resolved.registration._id));
        if (current?.checkedInAt) {
            return outcome(event, {
                result: RESULTS.ALREADY_CHECKED_IN,
                message: `Already checked in at ${formatTime(current.checkedInAt)}${current.checkedInBy ? ` by ${current.checkedInBy.name}` : ""}`,
                registration: current
            });
        }
        return outcome(event, notRegistered(current || resolved.registration));
    }

    await checkInAudit(event, actor, AUDIT_ACTIONS.ATTENDANCE_MARKED, updated._id, { userId: updated.user?._id, method });
    await notify(updated.user?._id, {
        type: NOTIFICATION_TYPES.ATTENDANCE_MARKED,
        title: `You're checked in to ${event.title}`,
        message: `Welcome! You were marked present at ${formatTime(now)}.`,
        link: `/events/${event._id}`
    });

    return outcome(event, { result: RESULTS.CHECKED_IN, message: `${updated.user?.name || "Student"} checked in`, registration: updated });
};

const unmarkAttendance = async (actor, eventId, registrationId) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MARK_ATTENDANCE, "Only club officers can change attendance");
    assertOpen(event);

    const updated = await populateAttendee(
        EventRegistration.findOneAndUpdate(
            { _id: registrationId, event: event._id, checkedInAt: { $ne: null } },
            { $set: { checkedInAt: null, checkedInBy: null, checkInMethod: null, checkInNote: null } },
            { returnDocument: "after" }
        )
    );
    if (!updated) {
        throw new AppError("This student isn't checked in", 409, ERROR_CODES.INVALID_STATE);
    }

    await checkInAudit(event, actor, AUDIT_ACTIONS.ATTENDANCE_UNMARKED, updated._id, { userId: updated.user?._id });
    return outcome(event, { result: RESULTS.UNMARKED, message: `${updated.user?.name || "Student"}'s check-in was undone`, registration: updated });
};

// Attended counts per event, for dashboards.
const attendedCountsByEvent = async (eventIds) => {
    const rows = await EventRegistration.aggregate([
        { $match: { event: { $in: eventIds }, status: REGISTERED, checkedInAt: { $ne: null } } },
        { $group: { _id: "$event", attended: { $sum: 1 } } }
    ]);
    return new Map(rows.map((row) => [String(row._id), row.attended]));
};

module.exports = { RESULTS, openCheckIn, closeCheckIn, getCheckInStatus, listForCheckIn, markAttendance, unmarkAttendance, attendedCountsByEvent, counts };
