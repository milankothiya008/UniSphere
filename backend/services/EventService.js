const Event = require("../models/Event");
const { audienceOf, assertVenueFitsAudience } = require("./VenueService");
const { pausedClubIds } = require("./ClubStatusService");
const Club = require("../models/Club");
const Venue = require("../models/Venue");
const ClubMembership = require("../models/ClubMembership");
const EventRegistration = require("../models/EventRegistration");
const EventResult = require("../models/EventResult");
const EventMedia = require("../models/EventMedia");
const User = require("../models/User");
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
    NOTIFICATION_TYPES,
    REVISION_STATUS,
    PARTICIPATION_MODES,
    CHECK_IN_STATUS
} = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
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
const { clubUsersWithPermission, clubIdsWithAnyPermission } = require("./MembershipService");
const teams = require("./TeamService");

const EVENT_LINK = (event) => `/events/${event._id}`;

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

// Completing or cancelling an event ends check-in at the door.
const closeCheckInIfOpen = (event, actor) => {
    if (event.checkIn?.status === CHECK_IN_STATUS.OPEN) {
        event.checkIn.status = CHECK_IN_STATUS.CLOSED;
        event.checkIn.closedAt = new Date();
        event.checkIn.closedBy = actor._id;
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
    departments: [...new Set((eligibility.departments || []).map((d) => String(d).trim().toUpperCase()).filter(Boolean))].sort(),
    batches: [...new Set((eligibility.batches || []).map((b) => String(b).trim()).filter((b) => /^\d{2}$/.test(b)))].sort(),
    notes: String(eligibility.notes || "").trim()
});

const normalizeContact = (contact = {}) => ({
    name: String(contact.name || "").trim(),
    email: String(contact.email || "").trim().toLowerCase(),
    phone: String(contact.phone || "").trim()
});

const loadActiveVenue = async (venueId) => {
    const venue = await Venue.findById(venueId);

    if (!venue || venue.status !== VENUE_STATUS.ACTIVE) {
        throw new AppError("Selected venue is not available", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return venue;
};

// For team events the limit counts teams, so the venue must fit that many full teams.
const assertCapacityFits = (maxParticipants, venue, registeredCount = 0, teamSize = 1) => {
    if (maxParticipants === null || maxParticipants === undefined || maxParticipants === "") {
        return null;
    }

    const value = Number(maxParticipants);

    if (!Number.isInteger(value) || value < 1) {
        throw new AppError("Participant limit must be a positive whole number", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    if (venue && value * teamSize > venue.capacity) {
        throw new AppError(
            teamSize > 1
                ? `${value} teams of up to ${teamSize} would exceed ${venue.name}'s capacity of ${venue.capacity}`
                : `Participant limit exceeds ${venue.name}'s capacity of ${venue.capacity}`,
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }

    if (value < registeredCount) {
        throw new AppError(`The limit cannot be lower than current registrations (${registeredCount})`, 400, ERROR_CODES.VALIDATION_ERROR);
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
    const { revision, ...obj } = event.toObject ? event.toObject() : event;
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
    // Check-in at the door: the president opens it, every officer scans.
    canManageCheckIn: contextHas(context, CLUB_PERMISSIONS.MANAGE_CHECK_IN),
    canMarkAttendance: contextHas(context, CLUB_PERMISSIONS.MARK_ATTENDANCE),
    canReview: context.isMentor && event.status === EVENT_STATUS.PENDING_APPROVAL,
    canReviewChanges: context.isMentor && event.revision?.status === REVISION_STATUS.PENDING_APPROVAL,
    canPublishChanges: contextHas(context, CLUB_PERMISSIONS.PUBLISH_EVENTS) && event.revision?.status === REVISION_STATUS.APPROVED,
    // Details can be edited until the event starts (published events go through the mentor again).
    canEdit:
        contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS) &&
        [...EDITABLE_EVENT_STATUSES, EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED].includes(event.status) &&
        event.startAt > new Date(),
    registration: registration
        ? {
              _id: registration._id,
              status: registration.status,
              registeredAt: registration.registeredAt,
              promotedAt: registration.promotedAt || null,
              waitlistPosition: registration.waitlistPosition ?? null,
              ticketCode: registration.ticketCode || null,
              checkedInAt: registration.checkedInAt || null,
              checkInMethod: registration.checkInMethod || null
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
    const isTeamEvent = event.participationMode === PARTICIPATION_MODES.TEAM;
    const active = found && [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED].includes(found.status);
    const teamInfo =
        actor && isTeamEvent
            ? {
                  team: active && found.team ? await teams.getTeamView(found.team, event) : null,
                  teamRole: active ? found.teamRole : null,
                  invites: active ? [] : await teams.invitesFor(actor, { eventId: event._id })
              }
            : {};

    const isStaff = context.isMentor || contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS) || contextHas(context, CLUB_PERMISSIONS.PUBLISH_EVENTS);

    const galleryCount = PUBLIC_EVENT_STATUSES.includes(event.status) ? await EventMedia.countDocuments({ event: event._id, status: "APPROVED" }) : 0;

    return serialize(event, {
        galleryCount,
        // On hold while the club is suspended or archived: visible to those involved, closed to registration.
        onHold: event.club.status !== CLUB_STATUS.ACTIVE,
        ...(event.club.status !== CLUB_STATUS.ACTIVE && event.status === EVENT_STATUS.PUBLISHED ? { registrationState: "ON_HOLD" } : {}),
        viewer: actor ? { ...viewerFor(context, event, registration), ...teamInfo } : null,
        ...(isStaff && event.revision ? { revision: await describeRevision(event) } : {})
    });
};

const createDraft = async (actor, payload) => {
    const { club } = await assertClubPermission(actor, payload.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot create events for this club");
    assertClubCanHostEvents(club);

    const venue = await loadActiveVenue(payload.venue);
    assertVenueFitsAudience(venue, audienceOf(club, normalizeEligibility(payload.eligibility).departments));
    const schedule = buildSchedule(payload);
    const team = normalizeTeamSettings(payload);

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
        ...team,
        maxParticipants: assertCapacityFits(payload.maxParticipants, venue, 0, team.maxTeamSize),
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

// ---------------------------------------------------------------- Editing
// Before an event starts every detail can be edited. Drafts change directly; an approved event goes back
// to its faculty mentor; a published event keeps its live details while the proposed changes are reviewed,
// and the club publishes them once the mentor approves (like the original approve → publish flow).

// Details a club can edit (all of them are reviewed by the mentor once the event has been approved).
const EDIT_FIELDS = [
    "title",
    "shortDescription",
    "description",
    "category",
    "poster",
    "rules",
    "contact",
    "maxParticipants",
    "eligibility",
    "venue",
    "eventDate",
    "startTime",
    "endTime",
    "registrationStart",
    "registrationEnd",
    "organizer",
    "participationMode",
    "minTeamSize",
    "maxTeamSize"
];

const TEAM_FIELDS = ["participationMode", "minTeamSize", "maxTeamSize"];
// startAt/endAt follow from eventDate + times, so they are stored with a change but not listed separately.
const DERIVED_FIELDS = ["startAt", "endAt"];

const FIELD_LABELS = {
    title: "title",
    shortDescription: "short description",
    description: "description",
    category: "category",
    poster: "poster",
    rules: "rules",
    contact: "contact details",
    maxParticipants: "participant limit",
    eligibility: "eligibility",
    venue: "venue",
    eventDate: "date",
    startTime: "start time",
    endTime: "end time",
    registrationStart: "registration opening",
    registrationEnd: "registration deadline",
    organizer: "organizer",
    participationMode: "team or individual entry",
    minTeamSize: "minimum team size",
    maxTeamSize: "maximum team size"
};

const labelList = (fields) => {
    const labels = fields.map((field) => FIELD_LABELS[field] || field);
    return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0] || "";
};

const comparable = (value) => {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value?._bsontype === "ObjectId") {
        return String(value);
    }
    if (typeof value === "object") {
        const plain = value.toObject ? value.toObject() : value;
        if (plain._id && Object.keys(plain).length > 1 && plain.name) {
            return String(plain._id);
        }
        return JSON.stringify(
            Object.keys(plain)
                .filter((key) => key !== "_id")
                .sort()
                .reduce((out, key) => ({ ...out, [key]: comparable(plain[key]) }), {})
        );
    }
    return value;
};

const sameValue = (a, b) => comparable(a) === comparable(b);

const normalizeTeamSettings = (payload, current = {}) => {
    const mode = payload.participationMode ?? current.participationMode ?? PARTICIPATION_MODES.INDIVIDUAL;
    if (mode !== PARTICIPATION_MODES.TEAM) {
        return { participationMode: PARTICIPATION_MODES.INDIVIDUAL, minTeamSize: 1, maxTeamSize: 1 };
    }
    const wasTeam = current.participationMode === PARTICIPATION_MODES.TEAM;
    const min = Number(payload.minTeamSize ?? (wasTeam ? current.minTeamSize : 2));
    const max = Number(payload.maxTeamSize ?? (wasTeam ? current.maxTeamSize : 4));
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < 2 || max > 20 || min > max) {
        throw new AppError(
            "Teams can have 2 to 20 members, and the minimum team size can't be above the maximum",
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
    return { participationMode: PARTICIPATION_MODES.TEAM, minTeamSize: min, maxTeamSize: max };
};

const activeRegistrations = (eventId) =>
    EventRegistration.countDocuments({ event: eventId, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } });

// Forms work in whole minutes, so a stored time with seconds still counts as unchanged.
const sameInstant = (value, current) => Math.floor(new Date(value).getTime() / 60000) === Math.floor(new Date(current).getTime() / 60000);

const scheduleChanged = (event, payload) =>
    (payload.eventDate !== undefined && payload.eventDate !== toDateKey(event.eventDate)) ||
    (payload.startTime !== undefined && payload.startTime !== event.startTime) ||
    (payload.endTime !== undefined && payload.endTime !== event.endTime) ||
    (Boolean(payload.registrationStart) && !sameInstant(payload.registrationStart, event.registrationStart)) ||
    (payload.registrationEnd !== undefined && !sameInstant(payload.registrationEnd, event.registrationEnd));

/**
 * Works out what an edit would change, validating the event as it would be afterwards.
 * Returns { next, fields }: the new values of the changed fields, and the fields to list as changed.
 */
const proposeChanges = async (event, payload, actor) => {
    const venueChanged = payload.venue !== undefined && String(payload.venue) !== String(event.venue);
    const venue = venueChanged ? await loadActiveVenue(payload.venue) : await Venue.findById(event.venue);
    const team = normalizeTeamSettings(payload, event);
    if (TEAM_FIELDS.some((field) => team[field] !== event[field]) && (await activeRegistrations(event._id))) {
        throw new AppError("Team settings can't change once students have registered", 409, ERROR_CODES.INVALID_STATE);
    }
    const proposed = { ...team };

    ["title", "shortDescription", "description", "category", "rules"].forEach((field) => {
        if (payload[field] !== undefined) {
            proposed[field] = typeof payload[field] === "string" ? payload[field].trim() : payload[field];
        }
    });
    if (payload.poster !== undefined) {
        proposed.poster = payload.poster || null;
    }
    if (payload.contact !== undefined) {
        proposed.contact = normalizeContact(payload.contact);
    }
    if (payload.eligibility !== undefined) {
        proposed.eligibility = normalizeEligibility(payload.eligibility);
    }
    if (payload.organizer !== undefined) {
        proposed.organizer = await resolveOrganizer(event.club, payload.organizer, actor);
    }
    if (venueChanged) {
        proposed.venue = venue._id;
    }

    const timingChanged = scheduleChanged(event, payload);
    if (timingChanged) {
        Object.assign(
            proposed,
            buildSchedule({
                eventDate: payload.eventDate || toDateKey(event.eventDate),
                startTime: payload.startTime || event.startTime,
                endTime: payload.endTime || event.endTime,
                registrationStart: payload.registrationStart || event.registrationStart,
                registrationEnd: payload.registrationEnd || event.registrationEnd
            })
        );
        // The form sends whole minutes: a registration time that only lost its seconds hasn't changed.
        ["registrationStart", "registrationEnd"].forEach((field) => {
            if (sameInstant(proposed[field], event[field])) {
                proposed[field] = event[field];
            }
        });
    }

    if (venueChanged || proposed.eligibility) {
        const club = await Club.findById(event.club).select("allDepartments departmentCodes");
        assertVenueFitsAudience(venue, audienceOf(club, (proposed.eligibility || event.eligibility)?.departments));
    }

    const limit = payload.maxParticipants !== undefined ? payload.maxParticipants : event.maxParticipants;
    if (payload.maxParticipants !== undefined || venueChanged || team.maxTeamSize !== event.maxTeamSize) {
        proposed.maxParticipants = assertCapacityFits(limit, venue, event.registeredCount, team.maxTeamSize);
    }

    const changed = Object.keys(proposed).filter((field) => !sameValue(proposed[field], event[field]));
    if (!changed.length) {
        return { next: {}, fields: [] };
    }

    if (venueChanged || timingChanged) {
        await assertVenueAvailable({
            venueId: venue._id,
            startAt: proposed.startAt || event.startAt,
            endAt: proposed.endAt || event.endAt,
            excludeEventId: event._id
        });
    }

    const next = Object.fromEntries(changed.map((field) => [field, proposed[field]]));
    // Moving the event keeps start and end together even when only one of them differs.
    if (timingChanged) {
        DERIVED_FIELDS.forEach((field) => (next[field] = proposed[field]));
    }
    return { next, fields: changed.filter((field) => !DERIVED_FIELDS.includes(field)) };
};

const notifyMentorOfChanges = async (club, event, fields, { afterApproval = false } = {}) => {
    await notify(club.mentor, {
        type: NOTIFICATION_TYPES.EVENT_CHANGES_REVIEW,
        title: afterApproval ? `"${event.title}" was changed after approval` : `Changes to "${event.title}" need your approval`,
        message: `${club.name} changed the ${labelList(fields)}.${afterApproval ? " Please review the event again." : " The event stays as it is until you approve."}`,
        link: EVENT_LINK(event),
        email: true
    });
};

const postUpdateNote = async (event, actor, note) => {
    // Kept on the event page's "Updates" section (not in the campus feed).
    await createSystemPost({
        type: FEED_POST_TYPES.EVENT_UPDATE,
        club: event.club,
        event: event._id,
        author: actor._id,
        title: `Update: ${event.title}`,
        body: note
    });
    await broadcastEventNews(event, actor, { type: NOTIFICATION_TYPES.EVENT_UPDATED, title: `Update for ${event.title}`, message: note });
};

const updateEvent = async (actor, eventId, payload) => {
    const event = await findEvent(eventId);
    const { club } = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot edit this club's events");
    const editsDetails = EDIT_FIELDS.some((field) => payload[field] !== undefined);
    const note = String(payload.updateNote || "").trim();

    // Opening or closing registration is an operational switch, not a change to the event's details.
    if (payload.registrationClosed !== undefined) {
        if (event.status !== EVENT_STATUS.PUBLISHED || event.startAt <= new Date()) {
            throw new AppError("Registration can only be opened or closed for upcoming published events", 409, ERROR_CODES.INVALID_STATE);
        }
        event.registrationClosed = Boolean(payload.registrationClosed);
        event.updatedBy = actor._id;
        await event.save();
        await audit(event, AUDIT_ACTIONS.EVENT_UPDATED, actor, event.status, null, { fields: ["registrationClosed"] });
    }

    if (!editsDetails) {
        if (note && event.status === EVENT_STATUS.PUBLISHED) {
            await postUpdateNote(event, actor, note);
        }
        return getEventDetail(actor, event._id);
    }

    if (![...EDITABLE_EVENT_STATUSES, EVENT_STATUS.PENDING_APPROVAL, EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED].includes(event.status)) {
        throw new AppError("This event can no longer be edited", 409, ERROR_CODES.INVALID_STATE);
    }
    assertInFuture(event, "This event has already started, so its details can no longer be changed");

    if (event.status === EVENT_STATUS.PENDING_APPROVAL) {
        throw new AppError("This event is with your faculty mentor for review. You can edit it again once they respond.", 409, ERROR_CODES.INVALID_STATE);
    }

    const { next, fields } = await proposeChanges(event, payload, actor);

    if (EDITABLE_EVENT_STATUSES.includes(event.status)) {
        Object.assign(event, next);
        event.updatedBy = actor._id;
        await event.save();
        await audit(event, AUDIT_ACTIONS.EVENT_UPDATED, actor, event.status, null, { fields });
        return getEventDetail(actor, event._id);
    }

    if (event.status === EVENT_STATUS.APPROVED) {
        // Not public yet: apply the edit and send the event back to the mentor.
        if (!fields.length) {
            return getEventDetail(actor, event._id);
        }
        if (!club.mentor) {
            throw new AppError("This club has no faculty mentor to review events. Contact the university admin.", 409, ERROR_CODES.INVALID_STATE);
        }
        await withVenueLock(next.venue || event.venue, async () => {
            if (next.venue || next.startAt) {
                await assertVenueAvailable({
                    venueId: next.venue || event.venue,
                    startAt: next.startAt || event.startAt,
                    endAt: next.endAt || event.endAt,
                    excludeEventId: event._id
                });
            }
            Object.assign(event, next);
            event.status = EVENT_STATUS.PENDING_APPROVAL;
            event.submittedAt = new Date();
            event.reviewComment = null;
            event.updatedBy = actor._id;
            await event.save();
        });
        await audit(event, AUDIT_ACTIONS.EVENT_UPDATED, actor, EVENT_STATUS.APPROVED, null, { fields });
        await audit(event, AUDIT_ACTIONS.EVENT_SUBMITTED, actor, EVENT_STATUS.APPROVED, "Edited after approval");
        await notifyMentorOfChanges(club, event, fields, { afterApproval: true });
        return getEventDetail(actor, event._id);
    }

    // Published: the live event stays as it is; the changes wait for the mentor.
    if (!fields.length) {
        if (event.revision) {
            event.revision = null;
            await event.save();
            await audit(event, AUDIT_ACTIONS.EVENT_REVISION_DISCARDED, actor, event.status, "Edits matched the live event");
        }
        if (note) {
            await postUpdateNote(event, actor, note);
        }
        return getEventDetail(actor, event._id);
    }
    if (!club.mentor) {
        throw new AppError("This club has no faculty mentor to review the changes. Contact the university admin.", 409, ERROR_CODES.INVALID_STATE);
    }

    event.revision = { status: REVISION_STATUS.PENDING_APPROVAL, changes: next, fields, note, requestedBy: actor._id, requestedAt: new Date() };
    event.markModified("revision");
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_SUBMITTED, actor, event.status, null, { fields });
    await notifyMentorOfChanges(club, event, fields);
    return getEventDetail(actor, event._id);
};

// ---------------------------------------------------------------- Reviewing changes to a published event

const loadRevisionForReview = async (actor, eventId) => {
    const event = await findEvent(eventId);
    await assertClubMentor(actor, event.club, "Only the club's faculty mentor can review changes to its events");
    if (event.revision?.status !== REVISION_STATUS.PENDING_APPROVAL) {
        throw new AppError("There are no changes waiting for review", 409, ERROR_CODES.INVALID_STATE);
    }
    return event;
};

const markRevisionReviewed = (event, actor, status, comment) => {
    event.revision.status = status;
    event.revision.reviewedBy = actor._id;
    event.revision.reviewedAt = new Date();
    event.revision.reviewComment = comment ? String(comment).trim() : null;
    event.markModified("revision");
};

const revisionAudience = async (event) => [event.revision.requestedBy, ...(await eventManagers(event))];

const approveEventChanges = async (actor, eventId, comment = null) => {
    const event = await loadRevisionForReview(actor, eventId);
    assertInFuture(event, "This event has already started, so its details can no longer be changed");

    const { changes } = event.revision;
    if (changes.venue || changes.startAt) {
        await assertVenueAvailable({
            venueId: changes.venue || event.venue,
            startAt: changes.startAt || event.startAt,
            endAt: changes.endAt || event.endAt,
            excludeEventId: event._id
        });
    }

    markRevisionReviewed(event, actor, REVISION_STATUS.APPROVED, comment);
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_APPROVED, actor, event.status, event.revision.reviewComment);

    await notify([...(await revisionAudience(event)), ...(await eventPublishers(event))], {
        type: NOTIFICATION_TYPES.EVENT_APPROVED,
        title: `Changes to "${event.title}" were approved`,
        message: `${comment ? `Mentor note: ${String(comment).trim()}. ` : ""}Publish them to update the live event.`,
        link: EVENT_LINK(event),
        email: true
    });
    return getEventDetail(actor, event._id);
};

const requestEventChangesRevision = async (actor, eventId, comment) => {
    if (!comment || !String(comment).trim()) {
        throw new AppError("Describe what needs to change", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const event = await loadRevisionForReview(actor, eventId);
    markRevisionReviewed(event, actor, REVISION_STATUS.NEEDS_CHANGES, comment);
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_CHANGES_REQUESTED, actor, event.status, event.revision.reviewComment);

    await notify(await revisionAudience(event), {
        type: NOTIFICATION_TYPES.EVENT_CHANGES_REQUESTED,
        title: `Your mentor asked for changes to your edit of "${event.title}"`,
        message: event.revision.reviewComment,
        link: EVENT_LINK(event),
        email: true
    });
    return getEventDetail(actor, event._id);
};

const rejectEventChanges = async (actor, eventId, reason) => {
    if (!reason || !String(reason).trim()) {
        throw new AppError("A reason is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    const event = await loadRevisionForReview(actor, eventId);
    markRevisionReviewed(event, actor, REVISION_STATUS.REJECTED, reason);
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_REJECTED, actor, event.status, event.revision.reviewComment);

    await notify(await revisionAudience(event), {
        type: NOTIFICATION_TYPES.EVENT_REJECTED,
        title: `Changes to "${event.title}" were not approved`,
        message: `${event.revision.reviewComment} The event stays as it was.`,
        link: EVENT_LINK(event),
        email: true
    });
    return getEventDetail(actor, event._id);
};

// Applies approved changes to the live event and tells everyone registered what changed.
const publishEventChanges = async (actor, eventId) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.PUBLISH_EVENTS, "You cannot publish changes to this club's events");
    if (event.status !== EVENT_STATUS.PUBLISHED || event.revision?.status !== REVISION_STATUS.APPROVED) {
        throw new AppError("Only changes approved by the faculty mentor can be published", 409, ERROR_CODES.INVALID_STATE);
    }
    assertInFuture(event, "This event has already started, so its details can no longer be changed");

    const { changes, fields, note } = event.revision;
    const venue = await Venue.findById(changes.venue || event.venue);
    if (changes.maxParticipants !== undefined) {
        assertCapacityFits(changes.maxParticipants, venue, event.registeredCount, changes.maxTeamSize || event.maxTeamSize);
    }
    if (fields.some((field) => TEAM_FIELDS.includes(field)) && (await activeRegistrations(event._id))) {
        throw new AppError("Team settings can't change once students have registered. Discard these changes and edit again.", 409, ERROR_CODES.INVALID_STATE);
    }

    const morePlaces =
        changes.maxParticipants !== undefined && (changes.maxParticipants === null || changes.maxParticipants > (event.maxParticipants || 0));

    await withVenueLock(changes.venue || event.venue, async () => {
        if (changes.venue || changes.startAt) {
            await assertVenueAvailable({
                venueId: changes.venue || event.venue,
                startAt: changes.startAt || event.startAt,
                endAt: changes.endAt || event.endAt,
                excludeEventId: event._id
            });
        }
        Object.assign(event, changes);
        event.revision = null;
        event.updatedBy = actor._id;
        await event.save();
    });

    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_PUBLISHED, actor, event.status, null, { fields });

    if (morePlaces) {
        await promoteFromWaitlist(event._id, { reason: "capacity_increased" });
    }

    const summary = `Updated: ${labelList(fields)}.${note ? ` ${note}` : ""}`;
    await createSystemPost({
        type: FEED_POST_TYPES.EVENT_UPDATE,
        club: event.club,
        event: event._id,
        author: actor._id,
        title: "Event details updated",
        body: summary
    });
    await broadcastEventNews(event, actor, { type: NOTIFICATION_TYPES.EVENT_UPDATED, title: `${event.title} has been updated`, message: summary });

    return getEventDetail(actor, event._id);
};

const discardEventChanges = async (actor, eventId) => {
    const event = await findEvent(eventId);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot edit this club's events");
    if (!event.revision) {
        throw new AppError("There are no pending changes to discard", 409, ERROR_CODES.INVALID_STATE);
    }
    event.revision = null;
    await event.save();
    await audit(event, AUDIT_ACTIONS.EVENT_REVISION_DISCARDED, actor, event.status);
    return getEventDetail(actor, event._id);
};

// Proposed changes as shown to the club and the mentor: each changed field with its live and proposed value.
const describeRevision = async (event) => {
    const { revision } = event;
    if (!revision) {
        return null;
    }
    const changes = revision.changes || {};
    const refId = (value) => (value?._id ? value._id : value);
    const userIds = [revision.requestedBy, revision.reviewedBy, changes.organizer, refId(event.organizer)].filter(Boolean);
    const venueIds = [changes.venue, refId(event.venue)].filter(Boolean);
    const [users, venues] = await Promise.all([
        User.find({ _id: { $in: userIds } }).select("name").lean(),
        Venue.find({ _id: { $in: venueIds } }).select("name location capacity").lean()
    ]);
    const find = (list, id) => list.find((item) => String(item._id) === String(refId(id))) || null;
    const display = (field, value) => {
        if (field === "venue") {
            return value ? find(venues, value) : null;
        }
        if (field === "organizer") {
            return value ? find(users, value) : null;
        }
        return value ?? null;
    };

    return {
        status: revision.status,
        fields: revision.fields,
        note: revision.note,
        changes,
        diff: revision.fields.map((field) => ({
            field,
            label: FIELD_LABELS[field] || field,
            from: display(field, event[field]),
            to: display(field, changes[field])
        })),
        requestedBy: find(users, revision.requestedBy),
        requestedAt: revision.requestedAt,
        reviewComment: revision.reviewComment,
        reviewedBy: find(users, revision.reviewedBy),
        reviewedAt: revision.reviewedAt
    };
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
    closeCheckInIfOpen(event, actor);
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

    closeCheckInIfOpen(event, actor);
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
// Discovery leaves out events of suspended or archived clubs (they're on hold until reactivation).
const discoveryFilters = (query, paused = []) => {
    const filter = paused.length ? { club: { $nin: paused } } : {};
    if (query.category) {
        filter.category = String(query.category).toUpperCase();
    }
    if (query.club) {
        filter.club = paused.some((id) => String(id) === String(query.club)) ? { $in: [] } : query.club;
    }
    if (query.search) {
        filter.title = searchRegex(query.search);
    }
    return filter;
};

const timeframeCounts = async (query, now, paused = []) => {
    const shared = discoveryFilters(query, paused);
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

    const paused = await pausedClubIds();
    Object.assign(filter, discoveryFilters(query, paused));
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
        query.withCounts === "true" ? timeframeCounts(query, now, paused) : null
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

    return clubIdsWithAnyPermission(actor._id, [CLUB_PERMISSIONS.MANAGE_EVENTS, CLUB_PERMISSIONS.PUBLISH_EVENTS, CLUB_PERMISSIONS.VIEW_PARTICIPANTS]);
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
            // "Awaiting approval" also covers edits to published events that wait for the mentor.
            if (statuses.includes(EVENT_STATUS.PENDING_APPROVAL)) {
                delete filter.status;
                filter.$or = [{ status: { $in: statuses } }, { "revision.status": REVISION_STATUS.PENDING_APPROVAL }];
            }
        }
    }

    if (query.search) {
        filter.title = searchRegex(query.search);
    }

    const [events, total] = await Promise.all([
        populateEvent(Event.find(filter).sort({ updatedAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        Event.countDocuments(filter)
    ]);

    return {
        items: events.map((event) => serialize(event, { revisionStatus: event.revision?.status || null, revisionFields: event.revision?.fields || [] })),
        ...paginationMeta(pagination, total)
    };
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
    approveEventChanges,
    requestEventChangesRevision,
    rejectEventChanges,
    publishEventChanges,
    discardEventChanges,
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
