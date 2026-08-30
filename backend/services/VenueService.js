const Venue = require("../models/Venue");
const Event = require("../models/Event");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { VENUE_STATUS, EVENT_STATUSES_HOLDING_VENUE } = require("../constants/Statuses");
const { assertAdmin } = require("./AuthorizationService");
const { combineDateAndTime, intervalsOverlap } = require("../utils/UniversityRules");

const createVenue = async (actor, payload) => {
    assertAdmin(actor);

    const { name, location, capacity } = payload;

    if (!name || !location || !capacity) {
        throw new AppError("name, location and capacity are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return Venue.create({ name, location, capacity: Number(capacity) });
};

const listVenues = async (query = {}) => {
    const filter = {};
    if (query.status) {
        filter.status = query.status.toUpperCase();
    }
    return Venue.find(filter).sort({ name: 1 });
};

const updateVenue = async (actor, id, data) => {
    assertAdmin(actor);

    const venue = await Venue.findByIdAndUpdate(id, data, { new: true, runValidators: true });

    if (!venue) {
        throw new AppError("Venue not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return venue;
};

const findConflictingEvents = async ({ venueId, startAt, endAt, excludeEventId = null }) => {
    const filter = {
        venue: venueId,
        status: { $in: EVENT_STATUSES_HOLDING_VENUE },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt }
    };

    if (excludeEventId) {
        filter._id = { $ne: excludeEventId };
    }

    return Event.find(filter).select("title startAt endAt status club");
};

const assertVenueAvailable = async (params) => {
    const conflicts = await findConflictingEvents(params);

    if (conflicts.length) {
        throw new AppError(
            "Event time conflicts with another event at this venue",
            409,
            ERROR_CODES.VENUE_CONFLICT
        );
    }
};

const getAvailableVenues = async ({ eventDate, startTime, endTime, excludeEventId }) => {
    if (!eventDate || !startTime || !endTime) {
        throw new AppError("eventDate, startTime and endTime are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const startAt = combineDateAndTime(eventDate, startTime);
    const endAt = combineDateAndTime(eventDate, endTime);

    if (startAt >= endAt) {
        throw new AppError("endTime must be after startTime", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const venues = await Venue.find({ status: VENUE_STATUS.ACTIVE });
    const busy = await Event.find({
        status: { $in: EVENT_STATUSES_HOLDING_VENUE },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
        ...(excludeEventId ? { _id: { $ne: excludeEventId } } : {})
    }).select("venue");

    const busyIds = new Set(busy.map((event) => String(event.venue)));

    return venues.filter((venue) => !busyIds.has(String(venue._id)));
};

module.exports = {
    createVenue,
    listVenues,
    updateVenue,
    findConflictingEvents,
    assertVenueAvailable,
    getAvailableVenues,
    intervalsOverlap
};
