const Event = require("../models/Event");
const EventFeedback = require("../models/EventFeedback");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS, CHECK_IN_STATUS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { getClubContext, contextHas } = require("./AuthorizationService");
const { notify } = require("./NotificationService");

// After an event ends, the students who were there rate it (1-5 stars) and can leave a note. They have two
// weeks to do it and can change their answer until then. Organisers and the mentor see the average, the
// spread and the notes — without names.

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 14;
const FEEDBACK_STATUSES = [EVENT_STATUS.PUBLISHED, EVENT_STATUS.COMPLETED];

const closesAt = (event) => new Date(event.endAt.getTime() + WINDOW_DAYS * DAY);

// Who was there: checked in — or, if the club never used check-in, everyone registered.
const attendeeFilter = (event) => ({
    event: event._id,
    status: REGISTRATION_STATUS.REGISTERED,
    ...(event.checkIn?.status && event.checkIn.status !== CHECK_IN_STATUS.NOT_STARTED ? { checkedInAt: { $ne: null } } : {})
});

const attendeeIds = async (event) => (await EventRegistration.find(attendeeFilter(event)).select("user").lean()).map((row) => row.user);

const isAttendee = async (event, userId) => Boolean(await EventRegistration.exists({ ...attendeeFilter(event), user: userId }));

const loadEvent = async (eventId) => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    return event;
};

const windowState = (event, now = new Date()) => {
    if (!FEEDBACK_STATUSES.includes(event.status)) return "UNAVAILABLE";
    if (event.endAt > now) return "NOT_YET";
    if (closesAt(event) < now) return "CLOSED";
    return "OPEN";
};

const summaryOf = (rows) => {
    const distribution = [1, 2, 3, 4, 5].map((stars) => rows.filter((row) => row.rating === stars).length);
    const average = rows.length ? Math.round((rows.reduce((sum, row) => sum + row.rating, 0) / rows.length) * 10) / 10 : null;
    return { count: rows.length, average, distribution };
};

/** The feedback card on the event page: the participant's own answer, and for organisers the summary. */
const getFeedback = async (actor, eventId) => {
    const event = await loadEvent(eventId);
    const context = await getClubContext(actor, event.club);
    const organiser = context.isMentor || contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS) || contextHas(context, CLUB_PERMISSIONS.VIEW_PARTICIPANTS);
    const state = windowState(event);
    const [mine, attendee] = await Promise.all([EventFeedback.findOne({ event: event._id, user: actor._id }).lean(), isAttendee(event, actor._id)]);

    let summary = null;
    if (organiser) {
        const rows = await EventFeedback.find({ event: event._id }).sort({ updatedAt: -1 }).select("rating note updatedAt").lean();
        const attendees = await EventRegistration.countDocuments(attendeeFilter(event));
        summary = {
            ...summaryOf(rows),
            attendees,
            notes: rows.filter((row) => row.note).map((row) => ({ rating: row.rating, note: row.note, at: row.updatedAt }))
        };
    }

    return {
        state,
        closesAt: closesAt(event),
        canGive: attendee && state === "OPEN",
        mine: mine ? { rating: mine.rating, note: mine.note, updatedAt: mine.updatedAt } : null,
        summary
    };
};

const giveFeedback = async (actor, eventId, { rating, note = "" } = {}) => {
    const event = await loadEvent(eventId);
    const state = windowState(event);
    if (state === "NOT_YET") throw new AppError("You can rate the event once it has ended", 409, ERROR_CODES.INVALID_STATE);
    if (state !== "OPEN") throw new AppError("Feedback for this event is closed", 409, ERROR_CODES.INVALID_STATE);
    if (!(await isAttendee(event, actor._id))) throw new AppError("Only students who attended can rate this event", 403, ERROR_CODES.FORBIDDEN);
    const stars = Number(rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new AppError("Choose 1 to 5 stars", 400, ERROR_CODES.VALIDATION_ERROR);
    await EventFeedback.findOneAndUpdate(
        { event: event._id, user: actor._id },
        { $set: { rating: stars, note: String(note || "").trim().slice(0, 1000), club: event.club } },
        { upsert: true, setDefaultsOnInsert: true }
    );
    return getFeedback(actor, event._id);
};

/** Average rating per event, for club insights. */
const ratingsFor = async (eventIds) => {
    const rows = await EventFeedback.aggregate([{ $match: { event: { $in: eventIds } } }, { $group: { _id: "$event", average: { $avg: "$rating" }, count: { $sum: 1 } } }]);
    return new Map(rows.map((row) => [String(row._id), { average: Math.round(row.average * 10) / 10, count: row.count }]));
};

// Once an event ends, its attendees are asked (once) how it was.
const sweepFeedbackRequests = async ({ now = new Date() } = {}) => {
    const { claim } = require("./EventReminderService");
    const events = await Event.find({ status: { $in: FEEDBACK_STATUSES }, endAt: { $lte: now, $gt: new Date(now.getTime() - 2 * DAY) }, "remindersSent.kind": { $ne: "FEEDBACK" } });
    let sent = 0;
    for (const event of events) {
        if (!(await claim(event, "FEEDBACK"))) continue;
        await notify(await attendeeIds(event), {
            type: NOTIFICATION_TYPES.FEEDBACK_REQUEST,
            title: `How was ${event.title}?`,
            message: "Rate it and tell the club what to keep or change — your name isn't shown to them.",
            link: `/events/${event._id}#feedback`
        });
        sent += 1;
    }
    return sent;
};

module.exports = { getFeedback, giveFeedback, ratingsFor, sweepFeedbackRequests, attendeeFilter, windowState };
