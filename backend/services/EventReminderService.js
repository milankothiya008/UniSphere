const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");
const { env } = require("../config/env");
const { EVENT_STATUS, REGISTRATION_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { formatDate, formatSchedule, formatTime } = require("../utils/CampusTime");
const { assertClubPermission } = require("./AuthorizationService");
const { notify, emailUsers } = require("./NotificationService");
const { recordAudit } = require("./AuditService");
const { eligibleStudentIds } = require("./CampusMailer");
const { optedOutIds } = require("./SubscriptionService");
const { pausedClubIds } = require("./ClubStatusService");

// Event reminders. Automatic ones go to registered students 24 hours and 1 hour before the start; each is
// claimed atomically on the event (remindersSent) so it goes out exactly once, even with several servers.
// Officers with SEND_REMINDERS can also send one by hand: "registration is closing" to eligible students
// who haven't registered, or "starting soon" to everyone registered — at most once every few hours each.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SWEEP_EVERY_MS = MINUTE;
const MANUAL_COOLDOWN_MS = 6 * HOUR;

const MANUAL = {
    REGISTRATION_CLOSING: "MANUAL_REG_CLOSING",
    EVENT_STARTING: "MANUAL_STARTING"
};

const link = (event) => `/events/${event._id}`;

const timeUntil = (date, now = new Date()) => {
    const minutes = Math.max(1, Math.round((new Date(date) - now) / MINUTE));
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.round(hours / 24);
    return `${days} days`;
};

const registeredIds = async (eventId) =>
    (await EventRegistration.find({ event: eventId, status: REGISTRATION_STATUS.REGISTERED }).select("user").lean()).map((row) => row.user);

const activeIds = async (eventId) =>
    (await EventRegistration.find({ event: eventId, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } }).select("user").lean()).map((row) => String(row.user));

/** Claims a reminder kind on the event; false when it was already sent. */
const claim = async (event, kind, by = null) => {
    const result = await Event.updateOne({ _id: event._id, "remindersSent.kind": { $ne: kind } }, { $push: { remindersSent: { kind, at: new Date(), by } } });
    return result.modifiedCount === 1;
};

const recordRecipients = (event, kind, recipients) => Event.updateOne({ _id: event._id, "remindersSent.kind": kind }, { $set: { "remindersSent.$.recipients": recipients } });

// "Starting soon" to everyone registered: in-app (and push) plus an email they can mute under "Your events".
const sendStartingReminder = async (event, { lead, note = "", exclude = [] }) => {
    const users = await registeredIds(event._id);
    if (!users.length) return 0;
    const venue = await Venue.findById(event.venue).select("name location").lean();
    const where = venue ? `${venue.name}, ${venue.location}` : null;
    const title = `${lead}: ${event.title}`;
    const message = `${formatSchedule(event.startAt, event.endAt)}${where ? ` · ${where}` : ""}. Bring your ticket from the event page.`;
    await notify(users, { type: NOTIFICATION_TYPES.EVENT_REMINDER, title, message, link: link(event), exclude });
    await emailUsers(users, {
        category: EMAIL_CATEGORIES.EVENT_ACTIVITY,
        exclude,
        dedupeKey: (user) => `reminder:${event._id}:${lead}:${Date.now()}:${user._id}`,
        compose: () => ({
            subject: title,
            heading: `${event.title} starts in ${timeUntil(event.startAt)}`,
            paragraphs: [note || "See you there! Your QR ticket is on the event page — show it at the door to check in."].filter(Boolean),
            details: [
                ["When", formatSchedule(event.startAt, event.endAt)],
                ["Where", where]
            ],
            action: { label: "Open your ticket", url: link(event) },
            reason: "You're receiving this because you registered for this event."
        })
    });
    return users.length;
};

// "Registration closing" to eligible students who haven't registered (and didn't mute the club).
const sendClosingReminder = async (event, { note = "", exclude = [] }) => {
    const [eligible, already, muted] = await Promise.all([eligibleStudentIds(event), activeIds(event._id), optedOutIds(event.club?._id || event.club)]);
    const skip = new Set([...already, ...muted]);
    const users = eligible.filter((id) => !skip.has(id));
    if (!users.length) return 0;
    const title = `Registration closes in ${timeUntil(event.registrationEnd)}: ${event.title}`;
    const message = `Register by ${formatDate(event.registrationEnd)}, ${formatTime(event.registrationEnd)}.`;
    await notify(users, { type: NOTIFICATION_TYPES.EVENT_REMINDER, title, message, link: link(event), exclude });
    await emailUsers(users, {
        category: EMAIL_CATEGORIES.EVENT_RECOMMENDATIONS,
        exclude,
        dedupeKey: (user) => `reminder:${event._id}:closing:${Date.now()}:${user._id}`,
        compose: () => ({
            subject: title,
            heading: `Last chance to join ${event.title}`,
            image: event.poster,
            paragraphs: [note || event.shortDescription].filter(Boolean),
            details: [
                ["When", formatSchedule(event.startAt, event.endAt)],
                ["Register by", `${formatDate(event.registrationEnd)}, ${formatTime(event.registrationEnd)}`],
                ["Seats", event.maxParticipants ? `${Math.max(0, event.maxParticipants - event.registeredCount)} of ${event.maxParticipants} left` : null]
            ],
            action: { label: "Register now", url: link(event) },
            reason: "You're receiving this because this event is open to your department and batch."
        })
    });
    return users.length;
};

const lastManual = (event, kind) =>
    (event.remindersSent || [])
        .filter((item) => item.kind === kind)
        .sort((a, b) => b.at - a.at)[0] || null;

/** What the reminder button shows: which reminders can go out now, and when the last ones went. */
const reminderStatus = (event, now = new Date()) => {
    const published = event.status === EVENT_STATUS.PUBLISHED;
    const closingOpen = published && !event.registrationClosed && event.registrationEnd > now && event.startAt > now;
    const startingOpen = published && event.endAt > now;
    const status = (kind, available, reason) => {
        const last = lastManual(event, kind);
        const nextAt = last ? new Date(new Date(last.at).getTime() + MANUAL_COOLDOWN_MS) : null;
        return {
            available: available && (!nextAt || nextAt <= now),
            reason: !available ? reason : nextAt && nextAt > now ? `Sent ${timeUntil(now, last.at)} ago — you can send another after ${formatTime(nextAt)}` : null,
            lastSentAt: last?.at || null,
            lastRecipients: last?.recipients ?? null
        };
    };
    return {
        REGISTRATION_CLOSING: status(MANUAL.REGISTRATION_CLOSING, closingOpen, "Registration isn't open right now"),
        EVENT_STARTING: status(MANUAL.EVENT_STARTING, startingOpen, "The event has ended"),
        automatic: (event.remindersSent || []).filter((item) => !item.kind.startsWith("MANUAL")).map((item) => ({ kind: item.kind, at: item.at, recipients: item.recipients }))
    };
};

/** An officer with SEND_REMINDERS sends a reminder now. */
const sendManualReminder = async (actor, eventId, { kind, note = "" }) => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    const { club } = await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.SEND_REMINDERS, "You don't have the authority to send reminders for this club");
    if (club.status !== "ACTIVE") {
        throw new AppError(`${club.name} is ${String(club.status).toLowerCase()}, so reminders are on hold`, 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }
    const key = MANUAL[kind];
    if (!key) throw new AppError("Choose which reminder to send", 400, ERROR_CODES.VALIDATION_ERROR);
    const state = reminderStatus(event)[kind];
    if (!state.available) {
        throw new AppError(state.reason || "This reminder can't be sent right now", 409, ERROR_CODES.INVALID_STATE);
    }
    const text = String(note || "").trim().slice(0, 500);

    // Claim the cooldown slot first, so two officers pressing the button together send one reminder.
    const since = new Date(Date.now() - MANUAL_COOLDOWN_MS);
    const claimed = await Event.updateOne(
        { _id: event._id, remindersSent: { $not: { $elemMatch: { kind: key, at: { $gt: since } } } } },
        { $push: { remindersSent: { kind: key, at: new Date(), by: actor._id } } }
    );
    if (!claimed.modifiedCount) {
        throw new AppError("A reminder like this was just sent", 409, ERROR_CODES.INVALID_STATE);
    }

    const recipients =
        kind === "EVENT_STARTING"
            ? await sendStartingReminder(event, { lead: event.startAt > new Date() ? `Starts in ${timeUntil(event.startAt)}` : "Happening now", note: text })
            : await sendClosingReminder(event, { note: text });

    await Event.updateOne({ _id: event._id }, { $set: { "remindersSent.$[last].recipients": recipients } }, { arrayFilters: [{ "last.kind": key, "last.by": actor._id, "last.recipients": 0 }] });
    await recordAudit({ action: AUDIT_ACTIONS.EVENT_REMINDER_SENT, actor: actor._id, targetType: "Event", targetId: event._id, metadata: { clubId: event.club, kind, recipients } });
    logger.info("Manual event reminder", { eventId: String(event._id), kind, recipients });
    return { kind, recipients, status: reminderStatus(await Event.findById(event._id)) };
};

// ---------------------------------------------------------------- Automatic sweep

const AUTOMATIC = [
    // 24 hours before: sent when 23–24 hours are left (events published later skip it).
    { kind: "START_24H", from: 23 * HOUR, to: 24 * HOUR, lead: "Tomorrow" },
    // 1 hour before: sent when 15–75 minutes are left.
    { kind: "START_1H", from: 15 * MINUTE, to: 75 * MINUTE, lead: "Starting soon" }
];

const sweepEventReminders = async ({ now = new Date() } = {}) => {
    const paused = await pausedClubIds();
    let sent = 0;
    for (const rule of AUTOMATIC) {
        const events = await Event.find({
            status: EVENT_STATUS.PUBLISHED,
            startAt: { $gt: new Date(now.getTime() + rule.from), $lte: new Date(now.getTime() + rule.to) },
            "remindersSent.kind": { $ne: rule.kind },
            ...(paused.length ? { club: { $nin: paused } } : {})
        });
        for (const event of events) {
            if (!(await claim(event, rule.kind))) continue;
            const recipients = await sendStartingReminder(event, { lead: rule.lead });
            await recordRecipients(event, rule.kind, recipients);
            sent += 1;
        }
    }
    return sent;
};

let timer = null;
let running = false;

// One sweeper for everything time-based around events: reminders, hackathon deadlines, feedback requests.
const startEventSweeper = () => {
    if (timer || env.isTest) return;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const reminders = await sweepEventReminders();
            const hackathon = await require("./HackathonService").sweepHackathons();
            const feedback = await require("./FeedbackService").sweepFeedbackRequests();
            if (reminders || hackathon || feedback) {
                logger.info("Event sweep", { reminders, hackathon, feedback });
            }
        } catch (error) {
            logger.error("Event sweep failed", { message: error.message });
        } finally {
            running = false;
        }
    };
    run();
    timer = setInterval(run, SWEEP_EVERY_MS);
    timer.unref();
};

module.exports = { sendManualReminder, reminderStatus, sweepEventReminders, startEventSweeper, claim, timeUntil, MANUAL_COOLDOWN_MS };
