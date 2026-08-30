const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS } = require("../constants/Statuses");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const { assertVerified, assertClubMemberOrStaff, isAdmin } = require("./AuthorizationService");

const isEligible = (user, event) => {
    const departments = event.eligibility?.departments || [];
    const batches = event.eligibility?.batches || [];

    if (departments.length && !departments.includes(user.departmentCode)) {
        return false;
    }

    if (batches.length && !batches.includes(user.batchCode)) {
        return false;
    }

    return true;
};

const registerForEvent = async (actor, eventId) => {
    assertVerified(actor);

    if (actor.accountType !== ACCOUNT_TYPES.STUDENT) {
        throw new AppError("Only verified students can register for events", 403, ERROR_CODES.FORBIDDEN);
    }

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw new AppError("Can only register for published events", 400, ERROR_CODES.INVALID_STATE);
    }

    const now = new Date();

    if (now < event.registrationStart) {
        throw new AppError("Registration has not started yet", 400, ERROR_CODES.REGISTRATION_NOT_OPEN);
    }

    if (now > event.registrationEnd) {
        throw new AppError("Registration deadline has passed", 400, ERROR_CODES.REGISTRATION_CLOSED);
    }

    if (!isEligible(actor, event)) {
        throw new AppError("You are not eligible for this event", 403, ERROR_CODES.FORBIDDEN);
    }

    const existing = await EventRegistration.findOne({ event: eventId, user: actor._id });

    if (existing && existing.status === REGISTRATION_STATUS.REGISTERED) {
        throw new AppError("Already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }

    if (event.maxParticipants && event.registeredCount >= event.maxParticipants) {
        throw new AppError("Event has reached maximum participants", 409, ERROR_CODES.EVENT_FULL);
    }

    try {
        if (existing) {
            existing.status = REGISTRATION_STATUS.REGISTERED;
            existing.registeredAt = new Date();
            await existing.save();
        } else {
            await EventRegistration.create({
                event: eventId,
                user: actor._id,
                status: REGISTRATION_STATUS.REGISTERED
            });
        }
    } catch (error) {
        if (error.code === 11000) {
            throw new AppError("Already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
        }
        throw error;
    }

    const updated = await Event.findOneAndUpdate(
        {
            _id: eventId,
            status: EVENT_STATUS.PUBLISHED,
            ...(event.maxParticipants
                ? { registeredCount: { $lt: event.maxParticipants } }
                : {})
        },
        { $inc: { registeredCount: 1 } },
        { new: true }
    );

    if (!updated) {
        await EventRegistration.updateOne(
            { event: eventId, user: actor._id },
            { status: REGISTRATION_STATUS.CANCELLED }
        );
        throw new AppError("Event has reached maximum participants", 409, ERROR_CODES.EVENT_FULL);
    }

    return {
        eventId: updated._id,
        registeredCount: updated.registeredCount,
        maxParticipants: updated.maxParticipants
    };
};

const cancelRegistration = async (actor, eventId) => {
    const registration = await EventRegistration.findOne({
        event: eventId,
        user: actor._id,
        status: REGISTRATION_STATUS.REGISTERED
    });

    if (!registration) {
        throw new AppError("You are not registered for this event", 404, ERROR_CODES.NOT_FOUND);
    }

    registration.status = REGISTRATION_STATUS.CANCELLED;
    await registration.save();

    await Event.updateOne(
        { _id: eventId, registeredCount: { $gt: 0 } },
        { $inc: { registeredCount: -1 } }
    );
};

const listRegistrations = async (actor, eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubMemberOrStaff(actor, event.club);

    return EventRegistration.find({ event: eventId, status: REGISTRATION_STATUS.REGISTERED })
        .populate("user", "name email departmentCode batchCode")
        .sort({ registeredAt: -1 });
};

const getPublicRegistrationCount = async (eventId) => {
    const event = await Event.findById(eventId).select("registeredCount maxParticipants status");

    if (!event || event.status !== EVENT_STATUS.PUBLISHED && event.status !== EVENT_STATUS.COMPLETED) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return {
        registeredCount: event.registeredCount,
        maxParticipants: event.maxParticipants
    };
};

const getMyRegistrations = async (actor) => {
    return EventRegistration.find({ user: actor._id, status: REGISTRATION_STATUS.REGISTERED })
        .populate({
            path: "event",
            select: "title startAt endAt status club venue registeredCount maxParticipants",
            populate: [
                { path: "club", select: "name" },
                { path: "venue", select: "name location" }
            ]
        })
        .sort({ registeredAt: -1 });
};

module.exports = {
    registerForEvent,
    cancelRegistration,
    listRegistrations,
    getPublicRegistrationCount,
    getMyRegistrations
};
