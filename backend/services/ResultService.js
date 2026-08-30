const Event = require("../models/Event");
const EventResult = require("../models/EventResult");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, RESULT_STATUS, AUDIT_ACTIONS, PUBLIC_EVENT_STATUSES } = require("../constants/Statuses");
const { assertClubPresident } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");

const upsertResult = async (actor, eventId, payload) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club);

    if (event.status !== EVENT_STATUS.COMPLETED) {
        throw new AppError("Results can only be managed after the event is completed", 409, ERROR_CODES.INVALID_STATE);
    }

    if (!payload.summary) {
        throw new AppError("Result summary is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const result = await EventResult.findOneAndUpdate(
        { event: eventId },
        {
            summary: payload.summary,
            awards: payload.awards || [],
            createdBy: actor._id,
            status: RESULT_STATUS.DRAFT
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return result;
};

const publishResult = async (actor, eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    await assertClubPresident(actor, event.club);

    const result = await EventResult.findOne({ event: eventId });

    if (!result) {
        throw new AppError("Create a result draft before publishing", 404, ERROR_CODES.NOT_FOUND);
    }

    result.status = RESULT_STATUS.PUBLISHED;
    result.publishedAt = new Date();
    await result.save();

    await recordAudit({
        action: AUDIT_ACTIONS.RESULT_PUBLISHED,
        actor: actor._id,
        targetType: "EventResult",
        targetId: result._id,
        toState: result.status
    });

    return result;
};

const getResult = async (actor, eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const result = await EventResult.findOne({ event: eventId }).populate("awards.recipientUser", "name email");

    if (!result) {
        throw new AppError("Result not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (result.status === RESULT_STATUS.PUBLISHED) {
        return result;
    }

    await assertClubPresident(actor, event.club);
    return result;
};

const getPublishedResult = async (eventId) => {
    const event = await Event.findById(eventId);

    if (!event || !PUBLIC_EVENT_STATUSES.includes(event.status)) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const result = await EventResult.findOne({
        event: eventId,
        status: RESULT_STATUS.PUBLISHED
    }).populate("awards.recipientUser", "name email");

    if (!result) {
        throw new AppError("Published result not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return result;
};

module.exports = {
    upsertResult,
    publishResult,
    getResult,
    getPublishedResult
};
