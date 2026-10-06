const mongoose = require("mongoose");
const User = require("../models/User");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { env } = require("../config/env");
const { EVENT_STATUS, PUBLIC_EVENT_STATUSES, REGISTRATION_STATUS, APPLICATION_STATUS, ROUND_STATUS } = require("../constants/Statuses");
const { buildCalendar } = require("../utils/ICalendar");
const { createCalendarToken, readCalendarToken, matchesCalendarToken } = require("../utils/CalendarToken");

// "Add to calendar" for one event, and each person's private calendar feed: the events they hold a place
// for (registered or waitlisted) and their interview slots. Calendar apps refresh the feed on their own,
// so a changed time or a cancellation reaches the person's calendar without them doing anything.

const PAST_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const appLink = (path) => `${String(env.clientUrl || "").replace(/\/$/, "")}${path}`;
const apiBase = () => String(env.publicApiUrl || env.clientUrl || "").replace(/\/$/, "");
const placeOf = (venue) => (venue ? [venue.name, venue.location].filter(Boolean).join(", ") : "");
const notFound = () => new AppError("Not found", 404, ERROR_CODES.NOT_FOUND);

const eventItem = (event, { waitlisted = false } = {}) => {
    const cancelled = event.status === EVENT_STATUS.CANCELLED;
    const link = appLink(`/events/${event._id}`);
    return {
        uid: `event-${event._id}@campusconnect`,
        start: event.startAt,
        end: event.endAt,
        title: `${event.title}${waitlisted && !cancelled ? " (waitlist)" : ""}`,
        description: [event.club?.name ? `By ${event.club.name}` : null, event.shortDescription, cancelled ? "This event was cancelled." : null, link]
            .filter(Boolean)
            .join("\n\n"),
        location: placeOf(event.venue),
        url: link,
        status: cancelled ? "CANCELLED" : waitlisted ? "TENTATIVE" : "CONFIRMED",
        updatedAt: event.updatedAt,
        alarmMinutes: 60
    };
};

/** One public event as an .ics file (anyone can add a published event to their calendar). */
const eventCalendar = async (eventId) => {
    if (!mongoose.isValidObjectId(eventId)) throw notFound();
    const event = await Event.findById(eventId)
        .select("title shortDescription startAt endAt status publishedAt venue club updatedAt")
        .populate("venue", "name location")
        .populate("club", "name")
        .lean();
    const visible = event && (PUBLIC_EVENT_STATUSES.includes(event.status) || (event.status === EVENT_STATUS.CANCELLED && event.publishedAt));
    if (!visible) throw notFound();
    return {
        filename: `${
            event.title
                .replace(/[^\w\- ]+/g, "")
                .trim()
                .slice(0, 60) || "event"
        }.ics`,
        body: buildCalendar({ name: event.title, items: [eventItem(event)] })
    };
};

const interviewItems = async (userId, since) => {
    const applications = await RecruitmentApplication.find({ applicant: userId, status: { $ne: APPLICATION_STATUS.WITHDRAWN }, "slots.endAt": { $gte: since } })
        .select("drive position slots updatedAt")
        .lean();
    if (!applications.length) return [];
    const drives = await RecruitmentDrive.find({ _id: { $in: applications.map((application) => application.drive) } })
        .select("title club positions._id positions.title positions.rounds")
        .populate("club", "name")
        .lean();
    const venueIds = drives.flatMap((drive) => drive.positions.flatMap((position) => position.rounds.map((round) => round.venue).filter(Boolean)));
    const venues = new Map(
        (
            await Venue.find({ _id: { $in: venueIds } })
                .select("name location")
                .lean()
        ).map((venue) => [String(venue._id), venue])
    );

    const items = [];
    for (const application of applications) {
        const drive = drives.find((item) => String(item._id) === String(application.drive));
        const position = drive?.positions.find((item) => String(item._id) === String(application.position));
        if (!position) continue;
        for (const slot of application.slots) {
            const round = position.rounds.find((item) => String(item._id) === String(slot.round));
            if (!round || ![ROUND_STATUS.SCHEDULED, ROUND_STATUS.RESULTS_PUBLISHED].includes(round.status) || new Date(slot.endAt) < since) continue;
            const link = appLink(`/recruitment/${drive._id}`);
            items.push({
                uid: `interview-${application._id}-${round._id}@campusconnect`,
                start: slot.startAt,
                end: slot.endAt,
                title: `${round.name}: ${position.title} (${drive.club?.name || "Club"})`,
                description: [drive.title, round.meetingLink ? `Join: ${round.meetingLink}` : null, round.instructions || null, link]
                    .filter(Boolean)
                    .join("\n\n"),
                location: round.venue ? placeOf(venues.get(String(round.venue))) : round.meetingLink || "",
                url: link,
                status: "CONFIRMED",
                updatedAt: round.updatedAt || application.updatedAt,
                alarmMinutes: 30
            });
        }
    }
    return items;
};

/** The person's whole feed, read by calendar apps with the private token. */
const feedCalendar = async (token) => {
    const parsed = readCalendarToken(String(token || "").replace(/\.ics$/i, ""));
    if (!parsed) throw notFound();
    const user = await User.findById(parsed.userId).select("name isActive calendarKeyVersion").lean();
    if (!user || !user.isActive || !matchesCalendarToken(String(token).replace(/\.ics$/i, ""), user._id, user.calendarKeyVersion || 0)) throw notFound();

    const since = new Date(Date.now() - PAST_DAYS * DAY);
    const registrations = await EventRegistration.find({ user: user._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } })
        .select("event status")
        .lean();
    const events = await Event.find({
        _id: { $in: registrations.map((registration) => registration.event) },
        endAt: { $gte: since },
        status: { $in: [...PUBLIC_EVENT_STATUSES, EVENT_STATUS.CANCELLED] }
    })
        .select("title shortDescription startAt endAt status venue club updatedAt")
        .populate("venue", "name location")
        .populate("club", "name")
        .lean();
    const statusOf = new Map(registrations.map((registration) => [String(registration.event), registration.status]));
    const items = [
        ...events.map((event) => eventItem(event, { waitlisted: statusOf.get(String(event._id)) === REGISTRATION_STATUS.WAITLISTED })),
        ...(await interviewItems(user._id, since))
    ];
    return buildCalendar({ name: "CampusConnect", items, feed: true });
};

const linkView = (user) => {
    const url = `${apiBase()}/api/calendar/feed/${createCalendarToken(user._id, user.calendarKeyVersion || 0)}.ics`;
    const webcal = url.replace(/^https?:\/\//i, "webcal://");
    return { url, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
};

const getFeedLink = async (actor) => linkView(await User.findById(actor._id).select("calendarKeyVersion").lean());

/** A new private address; calendars subscribed to the old one stop updating. */
const resetFeedLink = async (actor) => {
    const user = await User.findByIdAndUpdate(actor._id, { $inc: { calendarKeyVersion: 1 } }, { new: true })
        .select("calendarKeyVersion")
        .lean();
    return linkView(user);
};

module.exports = { eventCalendar, feedCalendar, getFeedLink, resetFeedLink };
