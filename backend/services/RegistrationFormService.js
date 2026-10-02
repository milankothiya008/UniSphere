const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const Team = require("../models/Team");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, PARTICIPATION_MODES, REGISTRATION_STATUS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { normalizeQuestions, readAnswers, answerText } = require("../utils/Forms");
const { assertClubPermission } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");

// Optional registration forms. The student's name, email, department, batch and phone come from their
// account; the club adds only the extra questions it needs. On team events each question is answered
// once per team (by the leader) or by every member when they register or accept the invite.

const isTeam = (event) => event.participationMode === PARTICIPATION_MODES.TEAM;
const formOf = (event) => (event.registrationForm?.enabled ? event.registrationForm.questions || [] : []);

/** The organiser's form, cleaned. Individual events have no "once per team" questions. */
const normalizeRegistrationForm = (form = {}, { team = false } = {}) => {
    const enabled = Boolean(form.enabled);
    const questions = normalizeQuestions(form.questions || [], { scopes: ["TEAM", "MEMBER"], what: "registration form" }).map((question) => ({
        ...question,
        scope: team ? question.scope : "MEMBER"
    }));
    if (enabled && !questions.length) throw new AppError("Add at least one question, or switch the registration form off", 400, ERROR_CODES.VALIDATION_ERROR);
    return { enabled, questions };
};

/** Questions the person answers: everything on individual events; per role on team events. */
const questionsFor = (event, role) => {
    const questions = formOf(event);
    if (!isTeam(event)) return { member: questions, team: [] };
    return {
        member: questions.filter((question) => question.scope !== "TEAM"),
        team: role === "LEADER" ? questions.filter((question) => question.scope === "TEAM") : []
    };
};

/** Validates a registrant's answers. Returns { answers, teamAnswers }. */
const answersFor = (event, role, input = {}) => {
    const { member, team } = questionsFor(event, role);
    return {
        answers: member.length ? readAnswers(member, input.answers) : [],
        teamAnswers: team.length ? readAnswers(team, input.teamAnswers) : []
    };
};

/** The club edits its registration form (any time before the event starts). Not reviewed by the mentor. */
const updateRegistrationForm = async (actor, eventId, form) => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    await assertClubPermission(actor, event.club, CLUB_PERMISSIONS.MANAGE_EVENTS, "You cannot edit this club's events");
    if ([EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED, EVENT_STATUS.COMPLETED].includes(event.status) || event.startAt <= new Date()) {
        throw new AppError("The registration form can be changed until the event starts", 409, ERROR_CODES.INVALID_STATE);
    }
    event.registrationForm = normalizeRegistrationForm(form, { team: isTeam(event) });
    event.updatedBy = actor._id;
    await event.save();
    await recordAudit({ action: "EVENT_UPDATED", actor: actor._id, targetType: "Event", targetId: event._id, metadata: { clubId: event.club, fields: ["registrationForm"] } });
    return event.registrationForm;
};

/** A registered student (or the team leader, for team questions) changes their answers until the event starts. */
const updateMyAnswers = async (actor, eventId, input = {}) => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    if (event.startAt <= new Date()) throw new AppError("Answers can be changed until the event starts", 409, ERROR_CODES.INVALID_STATE);
    const registration = await EventRegistration.findOne({ event: event._id, user: actor._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } });
    if (!registration) throw new AppError("You're not registered for this event", 404, ERROR_CODES.NOT_FOUND);
    const { answers, teamAnswers } = answersFor(event, registration.teamRole, input);
    registration.answers = answers;
    await registration.save();
    if (registration.teamRole === "LEADER" && registration.team) {
        await Team.updateOne({ _id: registration.team }, { $set: { answers: teamAnswers } });
    }
    return myAnswers(event, registration);
};

/** The viewer's own answers, for the event page. */
const myAnswers = async (event, registration) => {
    if (!registration || !formOf(event).length) return null;
    const team = registration.team && registration.teamRole === "LEADER" ? await Team.findById(registration.team).select("answers").lean() : null;
    return { answers: registration.answers || [], teamAnswers: team?.answers || [] };
};

/** Answer columns for the participants list and CSV: one row per registration. */
const answerColumns = (event) => formOf(event).map((question) => ({ _id: question._id, label: question.label, scope: question.scope, type: question.type }));

const answerCells = (event, registration, teamDoc) => {
    const own = new Map((registration.answers || []).map((answer) => [String(answer.question), answer]));
    const shared = new Map((teamDoc?.answers || []).map((answer) => [String(answer.question), answer]));
    return Object.fromEntries(
        formOf(event).map((question) => {
            const answer = question.scope === "TEAM" && isTeam(event) ? shared.get(String(question._id)) : own.get(String(question._id));
            return [String(question._id), answerText(question, answer)];
        })
    );
};

module.exports = { normalizeRegistrationForm, answersFor, questionsFor, updateRegistrationForm, updateMyAnswers, myAnswers, answerColumns, answerCells };
