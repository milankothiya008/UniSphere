const mongoose = require("mongoose");
const Venue = require("../models/Venue");
const Event = require("../models/Event");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const Club = require("../models/Club");
const Department = require("../models/Department");
const { VENUE_STATUS, VENUE_TYPES, EVENT_STATUS, EVENT_STATUSES_HOLDING_VENUE, RECRUITMENT_STATUS, ROUND_STATUS, ROUND_MODES } = require("../constants/Statuses");
const { assertAdmin } = require("./AuthorizationService");
const { combineDateAndTime, intervalsOverlap } = require("../utils/UniversityRules");
const { formatTime } = require("../utils/CampusTime");

// ---------------------------------------------------------------- Labs and audiences
//
// Labs belong to departments. An event's audience is its own department list if it has one, otherwise its
// club's departments; an all-department club with an event open to everyone may use any lab.

const ALL = "ALL";

/** The departments an event (or a club's recruitment) is for: a list of codes, or "ALL". */
const audienceOf = (club, eligibilityDepartments = []) => {
    const listed = (eligibilityDepartments || []).map((code) => String(code).toUpperCase()).filter(Boolean);
    if (listed.length) return listed;
    if (!club || club.allDepartments) return ALL;
    return (club.departmentCodes || []).map((code) => String(code).toUpperCase());
};

const venueFits = (venue, audience) => {
    if (venue.type !== VENUE_TYPES.LAB || audience === ALL) return true;
    return (venue.departmentCodes || []).some((code) => audience.includes(code));
};

const audienceLabel = (audience) => (audience === ALL ? "every department" : audience.join(", "));

/** Refuses a lab that doesn't belong to one of the audience's departments. */
const assertVenueFitsAudience = (venue, audience) => {
    if (!venueFits(venue, audience)) {
        throw new AppError(
            `${venue.name} is a ${venue.departmentCodes.join(", ")} lab, and this is for ${audienceLabel(audience)} students. Choose a lab of those departments or a common venue.`,
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
};

// For listings: ?club=<id>&departments=CE,IT narrows labs to that audience.
const audienceFromQuery = async (query = {}) => {
    const departments = String(query.departments || "")
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);
    if (!query.club && !departments.length) return null;
    const club = query.club && mongoose.isValidObjectId(query.club) ? await Club.findById(query.club).select("allDepartments departmentCodes") : null;
    return audienceOf(club, departments);
};

const normalizeVenue = async (payload, existing = null) => {
    const type = payload.type !== undefined ? String(payload.type).toUpperCase() : existing?.type || VENUE_TYPES.HALL;
    if (!Object.values(VENUE_TYPES).includes(type)) {
        throw new AppError("Choose the kind of venue", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    let departmentCodes = payload.departmentCodes !== undefined ? payload.departmentCodes : existing?.departmentCodes || [];
    departmentCodes = [...new Set((Array.isArray(departmentCodes) ? departmentCodes : []).map((code) => String(code).trim().toUpperCase()).filter(Boolean))];
    if (type === VENUE_TYPES.LAB) {
        if (!departmentCodes.length) {
            throw new AppError("Choose the department(s) this lab belongs to", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        const known = await Department.find({ code: { $in: departmentCodes } }).select("code");
        const unknown = departmentCodes.filter((code) => !known.some((department) => department.code === code));
        if (unknown.length) {
            throw new AppError(`Unknown department: ${unknown.join(", ")}`, 400, ERROR_CODES.VALIDATION_ERROR);
        }
    } else {
        departmentCodes = [];
    }
    return { type, departmentCodes };
};

// ---------------------------------------------------------------- Venues

const createVenue = async (actor, payload) => {
    assertAdmin(actor);

    const { name, location, capacity } = payload;

    if (!name || !location || !capacity) {
        throw new AppError("name, location and capacity are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return Venue.create({ name, location, capacity: Number(capacity), ...(await normalizeVenue(payload)) });
};

const listVenues = async (query = {}) => {
    const filter = {};
    if (query.status) {
        filter.status = String(query.status).toUpperCase();
    }
    if (query.type) {
        filter.type = String(query.type).toUpperCase();
    }
    const venues = await Venue.find(filter).sort({ type: 1, name: 1 });
    const audience = await audienceFromQuery(query);
    return audience ? venues.filter((venue) => venueFits(venue, audience)) : venues;
};

const updateVenue = async (actor, id, data) => {
    assertAdmin(actor);

    const existing = await Venue.findById(id);
    if (!existing) {
        throw new AppError("Venue not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const update = {};
    ["name", "location", "capacity", "status"].forEach((field) => {
        if (data[field] !== undefined) {
            update[field] = data[field];
        }
    });
    if (data.type !== undefined || data.departmentCodes !== undefined) {
        Object.assign(update, await normalizeVenue(data, existing));
    }

    return Venue.findByIdAndUpdate(id, update, { returnDocument: "after", runValidators: true });
};

// Offline interview rounds of live recruitment drives hold their venue for the whole round.
const findConflictingInterviews = async ({ venueId, startAt, endAt, excludeRoundId = null }) => {
    const drives = await RecruitmentDrive.find({
        status: RECRUITMENT_STATUS.PUBLISHED,
        "positions.rounds": { $elemMatch: { venue: venueId, mode: ROUND_MODES.OFFLINE, status: ROUND_STATUS.SCHEDULED, startAt: { $lt: endAt }, endAt: { $gt: startAt } } }
    })
        .select("title club positions")
        .populate("club", "name");

    return drives.flatMap((drive) =>
        drive.positions
            .flatMap((position) => position.rounds.map((round) => Object.assign(round, { positionTitle: position.title })))
            .filter(
                (round) =>
                    String(round.venue) === String(venueId) &&
                    round.mode === ROUND_MODES.OFFLINE &&
                    round.status === ROUND_STATUS.SCHEDULED &&
                    round.startAt < endAt &&
                    round.endAt > startAt &&
                    String(round._id) !== String(excludeRoundId)
            )
            .map((round) => ({ _id: round._id, title: `${drive.title} — ${round.positionTitle}: ${round.name}`, startAt: round.startAt, endAt: round.endAt, status: "INTERVIEW", club: drive.club }))
    );
};

const findConflictingEvents = async ({ venueId, startAt, endAt, excludeEventId = null, excludeRoundId = null }) => {
    const filter = {
        venue: venueId,
        status: { $in: EVENT_STATUSES_HOLDING_VENUE },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt }
    };

    if (excludeEventId) {
        filter._id = { $ne: excludeEventId };
    }

    const [events, interviews] = await Promise.all([
        Event.find(filter).select("title startAt endAt startTime endTime status club").populate("club", "name"),
        findConflictingInterviews({ venueId, startAt, endAt, excludeRoundId })
    ]);
    return [...events, ...interviews];
};


const bookingWord = (status) => (status === EVENT_STATUS.PENDING_APPROVAL ? "requested" : "booked");

const assertVenueAvailable = async (params) => {
    const conflicts = await findConflictingEvents(params);

    if (conflicts.length) {
        const first = conflicts[0];
        const venue = await Venue.findById(params.venueId).select("name");
        const window = `${formatTime(first.startAt)}–${formatTime(first.endAt)}`;
        const pendingNote = first.status === EVENT_STATUS.PENDING_APPROVAL ? ", which is awaiting faculty approval" : "";

        throw new AppError(
            `${venue?.name || "This venue"} is already ${bookingWord(first.status)} ${window} for "${first.title}"${first.club?.name ? ` (${first.club.name})` : ""}${pendingNote}. Choose another venue or time.`,
            409,
            ERROR_CODES.VENUE_CONFLICT,
            {
                conflicts: conflicts.map((event) => ({
                    eventId: event._id,
                    title: event.title,
                    club: event.club?.name || null,
                    startAt: event.startAt,
                    endAt: event.endAt,
                    status: event.status
                }))
            }
        );
    }
};

const LOCK_TTL_MS = 10 * 1000;
const LOCK_WAIT_MS = 5 * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Serialises "check the venue is free, then claim it" per venue. MongoDB here runs without
// transactions, so without this two requests could both pass the conflict check and double-book.
// The lock expires on its own if a process dies while holding it.
const withVenueLock = async (venueId, task) => {
    const token = new mongoose.Types.ObjectId().toString();
    const giveUpAt = Date.now() + LOCK_WAIT_MS;

    for (;;) {
        const now = new Date();
        const claimed = await Venue.updateOne(
            { _id: venueId, $or: [{ bookingLock: null }, { bookingLockExpires: { $lte: now } }] },
            { $set: { bookingLock: token, bookingLockExpires: new Date(now.getTime() + LOCK_TTL_MS) } }
        );

        if (claimed.modifiedCount === 1) {
            break;
        }

        if (!(await Venue.exists({ _id: venueId }))) {
            throw new AppError("Venue not found", 404, ERROR_CODES.NOT_FOUND);
        }

        if (Date.now() > giveUpAt) {
            throw new AppError("This venue is being booked by someone else right now. Please try again.", 409, ERROR_CODES.VENUE_CONFLICT);
        }

        await pause(40 + Math.floor(Math.random() * 60));
    }

    try {
        return await task();
    } finally {
        await Venue.updateOne({ _id: venueId, bookingLock: token }, { $set: { bookingLock: null, bookingLockExpires: null } });
    }
};

const getAvailableVenues = async ({ eventDate, endDate, startTime, endTime, excludeEventId, club, departments }) => {
    if (!eventDate || !startTime || !endTime) {
        throw new AppError("eventDate, startTime and endTime are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const startAt = combineDateAndTime(eventDate, startTime);
    const endAt = combineDateAndTime(endDate || eventDate, endTime);

    if (startAt >= endAt) {
        throw new AppError("endTime must be after startTime", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const audience = await audienceFromQuery({ club, departments });
    const venues = (await Venue.find({ status: VENUE_STATUS.ACTIVE }).sort({ type: 1, name: 1 })).filter((venue) => !audience || venueFits(venue, audience));
    const busy = await Event.find({
        status: { $in: EVENT_STATUSES_HOLDING_VENUE },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
        ...(excludeEventId ? { _id: { $ne: excludeEventId } } : {})
    })
        .select("title venue startAt endAt status club")
        .populate("club", "name")
        .sort({ startAt: 1 });

    // Interview rounds booked in the same window, from any drive.
    const drives = await RecruitmentDrive.find({
        status: RECRUITMENT_STATUS.PUBLISHED,
        "positions.rounds": { $elemMatch: { mode: ROUND_MODES.OFFLINE, status: ROUND_STATUS.SCHEDULED, startAt: { $lt: endAt }, endAt: { $gt: startAt } } }
    })
        .select("title club positions")
        .populate("club", "name");
    drives.forEach((drive) =>
        drive.positions
            .flatMap((position) => position.rounds)
            .filter((round) => round.venue && round.mode === ROUND_MODES.OFFLINE && round.status === ROUND_STATUS.SCHEDULED && round.startAt < endAt && round.endAt > startAt)
            .forEach((round) => busy.push({ title: `${drive.title} — ${round.name}`, venue: round.venue, startAt: round.startAt, endAt: round.endAt, status: "INTERVIEW", club: drive.club }))
    );

    // Say who holds each busy venue, so organisers can pick another room or time with confidence.
    const bookings = new Map();
    busy.forEach((event) => {
        const key = String(event.venue);
        if (!bookings.has(key)) {
            bookings.set(key, []);
        }
        bookings.get(key).push({
            title: event.title,
            club: event.club?.name || null,
            startTime: formatTime(event.startAt),
            endTime: formatTime(event.endAt),
            pendingApproval: event.status === EVENT_STATUS.PENDING_APPROVAL
        });
    });

    return venues.map((venue) => ({
        ...venue.toObject(),
        available: !bookings.has(String(venue._id)),
        bookedBy: bookings.get(String(venue._id)) || []
    }));
};

module.exports = {
    audienceOf,
    venueFits,
    assertVenueFitsAudience,
    createVenue,
    listVenues,
    updateVenue,
    findConflictingEvents,
    assertVenueAvailable,
    withVenueLock,
    getAvailableVenues,
    intervalsOverlap
};
