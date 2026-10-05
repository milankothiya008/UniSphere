const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS } = require("../constants/Statuses");

// A student can't be at two events at once. Registering (or joining a team, or a waitlist) for an event that
// overlaps one they already hold a place for is refused — unless they choose to switch: the other place is
// cancelled (if that event hasn't started), exactly as if they had cancelled it themselves, so its seat goes
// to the next student waiting, and then the new registration goes ahead.

const HOLDING = [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED];
const idOf = (value) => String(value?._id || value || "");

/** The student's other registrations and waitlist places whose times overlap this event. */
const clashesFor = async (userId, event, now = new Date()) => {
    const held = await EventRegistration.find({ user: userId, status: { $in: HOLDING }, event: { $ne: event._id } })
        .select("event status teamRole")
        .lean();
    if (!held.length) return [];
    const overlapping = await Event.find({
        _id: { $in: held.map((row) => row.event) },
        status: EVENT_STATUS.PUBLISHED,
        startAt: { $lt: event.endAt },
        endAt: { $gt: event.startAt }
    })
        .select("title startAt endAt club participationMode")
        .populate("club", "name")
        .sort({ startAt: 1 })
        .lean();
    return overlapping.map((other) => {
        const registration = held.find((row) => idOf(row.event) === idOf(other._id));
        return {
            event: { _id: other._id, title: other.title, startAt: other.startAt, endAt: other.endAt, club: other.club ? { _id: other.club._id, name: other.club.name } : null },
            status: registration.status,
            teamRole: registration.teamRole || null,
            // A place can be given up only before that event starts.
            canSwitch: other.startAt > now
        };
    });
};

const describe = (clash) => `${clash.status === REGISTRATION_STATUS.WAITLISTED ? "on the waitlist for" : "registered for"} "${clash.event.title}"`;

/**
 * Throws unless every overlapping place is one the student agreed to give up (`replace`, event ids) and can
 * still be given up. The error carries the full list, so the app can ask "switch?". Returns the overlaps.
 */
const assertResolvable = async (actor, event, replace = []) => {
    const clashes = await clashesFor(actor._id, event);
    if (!clashes.length) return [];
    const agreed = new Set((Array.isArray(replace) ? replace : []).map(String));
    const unresolved = clashes.filter((clash) => !agreed.has(idOf(clash.event._id)));
    if (unresolved.length) {
        const first = clashes[0];
        throw new AppError(
            clashes.length === 1 ? `This event is at the same time as one you're ${describe(first)}.` : `This event overlaps ${clashes.length} events you're registered for.`,
            409,
            ERROR_CODES.SCHEDULE_CONFLICT,
            { clashes }
        );
    }
    const started = clashes.find((clash) => !clash.canSwitch);
    if (started) {
        throw new AppError(`"${started.event.title}" has already started, so you can't switch from it.`, 409, ERROR_CODES.SCHEDULE_CONFLICT, { clashes });
    }
    return clashes;
};

/**
 * Makes sure nothing overlaps, or switches: the places the student agreed to give up are cancelled. Call after
 * every other check has passed, right before taking the new place. Returns the events switched away from.
 */
const resolveClashes = async (actor, event, replace = []) => {
    const clashes = await assertResolvable(actor, event, replace);
    // Same path as "Cancel registration": team members leave, a leader withdraws the team, seats go to the waitlist.
    const { cancelRegistration } = require("./RegistrationService");
    for (const clash of clashes) {
        await cancelRegistration(actor, clash.event._id);
    }
    return clashes.map((clash) => clash.event);
};

module.exports = { clashesFor, assertResolvable, resolveClashes };
