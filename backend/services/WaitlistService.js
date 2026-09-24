const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const logger = require("../utils/Logger");
const { EVENT_STATUS, REGISTRATION_STATUS, AUDIT_ACTIONS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { formatDateKey } = require("../utils/UniversityRules");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");

// A full event keeps a first-come, first-served waitlist. Whenever a seat frees up (a cancellation,
// an organiser removing someone, a bigger capacity) the queue is promoted in order until the event
// is full again. Each step is atomic, so parallel cancellations can never overfill the event or
// promote the same student twice.

const MAX_PROMOTIONS_PER_RUN = 500;

const queueOrder = { waitlistedAt: 1, _id: 1 };

// 1-based place in the queue, or null when the registration is not waitlisted.
const waitlistPosition = async (registration) => {
    if (!registration || registration.status !== REGISTRATION_STATUS.WAITLISTED) {
        return null;
    }
    const ahead = await EventRegistration.countDocuments({
        event: registration.event,
        status: REGISTRATION_STATUS.WAITLISTED,
        $or: [
            { waitlistedAt: { $lt: registration.waitlistedAt } },
            { waitlistedAt: registration.waitlistedAt, _id: { $lt: registration._id } }
        ]
    });
    return ahead + 1;
};

const reserveSeat = (event) =>
    Event.findOneAndUpdate(
        {
            _id: event._id,
            status: EVENT_STATUS.PUBLISHED,
            startAt: { $gt: new Date() },
            ...(event.maxParticipants ? { registeredCount: { $lt: event.maxParticipants } } : {})
        },
        { $inc: { registeredCount: 1 } },
        { returnDocument: "after" }
    );

const releaseSeat = (eventId) => Event.updateOne({ _id: eventId, registeredCount: { $gt: 0 } }, { $inc: { registeredCount: -1 } });

const adjustWaitlistCount = (eventId, delta) =>
    Event.updateOne({ _id: eventId, ...(delta < 0 ? { waitlistCount: { $gt: 0 } } : {}) }, { $inc: { waitlistCount: delta } });

// Moves waitlisted students into free seats, first in first out. Returns how many were promoted.
// Stops as soon as the event is full, has started, or is no longer published.
const promoteFromWaitlist = async (eventId, { reason = "seat_released" } = {}) => {
    let promoted = 0;

    try {
        while (promoted < MAX_PROMOTIONS_PER_RUN) {
            const event = await Event.findById(eventId).select("title status startAt eventDate startTime maxParticipants registeredCount");
            if (!event || event.status !== EVENT_STATUS.PUBLISHED || event.startAt <= new Date()) {
                break;
            }

            const next = await EventRegistration.findOne({ event: event._id, status: REGISTRATION_STATUS.WAITLISTED }).sort(queueOrder);
            if (!next) {
                break;
            }

            if (!(await reserveSeat(event))) {
                break;
            }

            const now = new Date();
            const claimed = await EventRegistration.findOneAndUpdate(
                { _id: next._id, status: REGISTRATION_STATUS.WAITLISTED },
                { $set: { status: REGISTRATION_STATUS.REGISTERED, registeredAt: now, promotedAt: now } },
                { returnDocument: "after" }
            );

            if (!claimed) {
                // They left the waitlist (or another run promoted them) in the meantime; give the seat back and retry.
                await releaseSeat(event._id);
                continue;
            }

            await adjustWaitlistCount(event._id, -1);
            promoted += 1;

            await recordAudit({
                action: AUDIT_ACTIONS.WAITLIST_PROMOTED,
                actor: claimed.user,
                targetType: "EventRegistration",
                targetId: claimed._id,
                fromState: REGISTRATION_STATUS.WAITLISTED,
                toState: REGISTRATION_STATUS.REGISTERED,
                metadata: { eventId: event._id, reason }
            });

            // Always emailed: this is the confirmation of a seat they asked for.
            await notify(claimed.user, {
                type: NOTIFICATION_TYPES.REGISTRATION_CONFIRMED,
                title: `You're in! A spot opened up for ${event.title}`,
                message: `You've moved off the waitlist and are now registered. See you on ${formatDateKey(event.eventDate)} at ${event.startTime}. If you can no longer make it, cancel so the next person gets your seat.`,
                link: `/events/${event._id}`,
                email: true
            });
        }
    } catch (error) {
        logger.error("Waitlist promotion failed", { eventId: String(eventId), message: error.message });
    }

    return promoted;
};

module.exports = { promoteFromWaitlist, waitlistPosition, reserveSeat, releaseSeat, adjustWaitlistCount, queueOrder };
