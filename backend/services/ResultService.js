const Event = require("../models/Event");
const EventResult = require("../models/EventResult");
const EventRegistration = require("../models/EventRegistration");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    EVENT_STATUS,
    RESULT_STATUS,
    REGISTRATION_STATUS,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { parsePagination, paginationMeta, searchRegex } = require("../utils/Query");
const { getClubContext, contextHas, assertClubPermission } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify, notifyAllUsers } = require("./NotificationService");
const { sendResultEmails, sendRoundResultEmails } = require("./CampusMailer");

// Results work like a real competition board:
// - Rounds (screening, semi-final…) are published one by one, even while the event is running.
// - Final results (summary + awards) can go out once the event has started — no need to wait for "completed".
// - Anyone with MANAGE_RESULTS prepares drafts; only the president (PUBLISH_RESULTS) publishes,
//   withdraws or corrects what the campus sees. Corrections are marked as such.

const MAX_ROUNDS = 20;
const MAX_ENTRIES = 500;
const RESULTS_LINK = (eventId) => `/results/${eventId}`;

const populateResult = (query) =>
    query
        .populate("awards.recipientUser", "name email departmentCode batchCode")
        .populate("rounds.entries.recipientUser", "name departmentCode batchCode")
        .populate("createdBy", "name")
        .populate({
            path: "event",
            select: "title poster startAt endAt status club category registeredCount shortDescription",
            populate: { path: "club", select: "name logo" }
        });

const findEvent = async (eventId) => {
    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return event;
};

const hasStarted = (event, now = new Date()) => event.startAt <= now;

// Results belong to events that are live on campus (published) or finished (completed).
const assertAcceptsResults = (event) => {
    if (![EVENT_STATUS.PUBLISHED, EVENT_STATUS.COMPLETED].includes(event.status)) {
        throw new AppError("Results can only be added to published or completed events", 409, ERROR_CODES.INVALID_STATE);
    }
};

const assertCanPublishFinal = (event) => {
    assertAcceptsResults(event);
    if (!hasStarted(event)) {
        throw new AppError("Final results can be published once the event has started", 409, ERROR_CODES.INVALID_STATE);
    }
};

// Loads the event and checks the actor's club permission; returns the club context too.
const loadForResults = async (actor, eventId, permission, message) => {
    const event = await findEvent(eventId);
    const context = await assertClubPermission(actor, event.club, permission, message);
    return { event, context };
};

const loadResultDoc = async (event, actor) =>
    (await EventResult.findOne({ event: event._id })) || new EventResult({ event: event._id, club: event.club, createdBy: actor._id });

const registeredUserIds = async (eventId, userIds) =>
    new Set(
        (
            await EventRegistration.find({ event: eventId, user: { $in: userIds }, status: REGISTRATION_STATUS.REGISTERED }).select("user")
        ).map((registration) => String(registration.user))
    );

const namesOf = async (userIds) => new Map((await User.find({ _id: { $in: userIds } }).select("name")).map((user) => [String(user._id), user.name]));

const positiveIntOrNull = (value, label) => {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new AppError(`${label} must be a positive whole number`, 400, ERROR_CODES.VALIDATION_ERROR);
    }
    return number;
};

const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);

// Award recipients who are CampusConnect users must have been registered for the event.
const normalizeAwards = async (event, awards = []) => {
    const recipientIds = [...new Set(awards.map((award) => award.recipientUser).filter(Boolean).map(String))];
    const [registeredIds, names] = await Promise.all([registeredUserIds(event._id, recipientIds), namesOf(recipientIds)]);

    return awards.map((award, index) => {
        const recipientUser = award.recipientUser ? String(award.recipientUser) : null;

        if (!text(award.title)) {
            throw new AppError(`Award #${index + 1}: add a title`, 400, ERROR_CODES.VALIDATION_ERROR);
        }

        if (recipientUser && !registeredIds.has(recipientUser)) {
            throw new AppError(`Award #${index + 1}: the selected student was not registered for this event`, 400, ERROR_CODES.VALIDATION_ERROR);
        }

        if (!recipientUser && !text(award.recipientName) && !text(award.teamName)) {
            throw new AppError(`Award #${index + 1}: add a participant, name or team`, 400, ERROR_CODES.VALIDATION_ERROR);
        }

        return {
            title: String(award.title).trim(),
            position: positiveIntOrNull(award.position, `Award #${index + 1} position`),
            recipientUser,
            recipientName: text(award.recipientName) || (recipientUser ? names.get(recipientUser) : null) || null,
            teamName: text(award.teamName),
            prize: text(award.prize),
            recognition: text(award.recognition)
        };
    });
};

// A round's standings: every line names a registered student, a person or a team, and nobody appears twice.
const normalizeEntries = async (event, entries = []) => {
    if (!Array.isArray(entries)) {
        throw new AppError("Round entries must be a list", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (entries.length > MAX_ENTRIES) {
        throw new AppError(`A round can list at most ${MAX_ENTRIES} entries`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const recipientIds = [...new Set(entries.map((entry) => entry.recipientUser).filter(Boolean).map(String))];
    const [registeredIds, names] = await Promise.all([registeredUserIds(event._id, recipientIds), namesOf(recipientIds)]);
    const seen = new Set();

    return entries.map((entry, index) => {
        const label = `Row ${index + 1}`;
        const recipientUser = entry.recipientUser ? String(entry.recipientUser) : null;
        const teamName = text(entry.teamName);
        const recipientName = text(entry.recipientName);

        if (recipientUser && !registeredIds.has(recipientUser)) {
            throw new AppError(`${label}: the selected student was not registered for this event`, 400, ERROR_CODES.VALIDATION_ERROR);
        }
        if (!recipientUser && !recipientName && !teamName) {
            throw new AppError(`${label}: add a participant, name or team`, 400, ERROR_CODES.VALIDATION_ERROR);
        }

        const identity = recipientUser ? `u:${recipientUser}` : `n:${(teamName || recipientName).toLowerCase()}`;
        if (seen.has(identity)) {
            throw new AppError(`${label}: ${teamName || recipientName || names.get(recipientUser)} is listed twice`, 400, ERROR_CODES.VALIDATION_ERROR);
        }
        seen.add(identity);

        const score = text(entry.score);
        if (score && score.length > 40) {
            throw new AppError(`${label}: score is too long`, 400, ERROR_CODES.VALIDATION_ERROR);
        }

        return {
            rank: positiveIntOrNull(entry.rank, `${label} rank`),
            recipientUser,
            recipientName: recipientName || (recipientUser ? names.get(recipientUser) : null) || null,
            teamName,
            score,
            qualified: typeof entry.qualified === "boolean" ? entry.qualified : null,
            note: text(entry.note)
        };
    });
};

// Standings are always shown best rank first; unranked rows keep their order at the end.
const sortEntries = (entries) =>
    entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => (a.entry.rank ?? Infinity) - (b.entry.rank ?? Infinity) || a.index - b.index)
        .map(({ entry }) => entry);

const audit = (action, actor, result, eventId, metadata = {}, toState = null) =>
    recordAudit({
        action,
        actor: actor._id,
        targetType: "EventResult",
        targetId: result._id,
        toState,
        metadata: { eventId, ...metadata }
    });

const findRound = (result, roundId) => {
    const round = result?.rounds?.id(roundId);
    if (!round) {
        throw new AppError("Round not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return round;
};

// Changing something already public is a correction: only the president may do it.
const assertMayEdit = (context, isPublished, what) => {
    if (isPublished && !contextHas(context, CLUB_PERMISSIONS.PUBLISH_RESULTS)) {
        throw new AppError(`${what} are already published; only the club president can correct them`, 403, ERROR_CODES.FORBIDDEN);
    }
};

const registrantIds = async (eventId) =>
    (await EventRegistration.find({ event: eventId, status: REGISTRATION_STATUS.REGISTERED }).select("user")).map((r) => r.user);

// ---------------------------------------------------------------- rounds

const createRound = async (actor, eventId, payload) => {
    const { event } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.MANAGE_RESULTS, "You cannot manage results for this club");
    assertAcceptsResults(event);

    const name = text(payload.name);
    if (!name) {
        throw new AppError("Give the round a name, e.g. \"Round 1: Idea screening\"", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const result = await loadResultDoc(event, actor);
    if (result.rounds.length >= MAX_ROUNDS) {
        throw new AppError(`An event can have at most ${MAX_ROUNDS} rounds`, 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (result.rounds.some((round) => round.name.toLowerCase() === name.toLowerCase())) {
        throw new AppError(`There is already a round called "${name}"`, 409, ERROR_CODES.CONFLICT);
    }

    result.rounds.push({
        name,
        description: text(payload.description) || "",
        entries: sortEntries(await normalizeEntries(event, payload.entries || [])),
        createdBy: actor._id,
        updatedBy: actor._id
    });
    result.updatedBy = actor._id;
    await result.save();

    const round = result.rounds[result.rounds.length - 1];
    await audit(AUDIT_ACTIONS.RESULT_ROUND_SAVED, actor, result, event._id, { round: round.name, created: true }, RESULT_STATUS.DRAFT);
    return getResult(actor, event._id);
};

const updateRound = async (actor, eventId, roundId, payload) => {
    const { event, context } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.MANAGE_RESULTS, "You cannot manage results for this club");
    assertAcceptsResults(event);

    const result = await EventResult.findOne({ event: event._id });
    const round = findRound(result, roundId);
    const published = round.status === RESULT_STATUS.PUBLISHED;
    assertMayEdit(context, published, "This round's results");

    if (payload.name !== undefined) {
        const name = text(payload.name);
        if (!name) {
            throw new AppError("Round name is required", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        if (result.rounds.some((other) => String(other._id) !== String(round._id) && other.name.toLowerCase() === name.toLowerCase())) {
            throw new AppError(`There is already a round called "${name}"`, 409, ERROR_CODES.CONFLICT);
        }
        round.name = name;
    }
    if (payload.description !== undefined) {
        round.description = text(payload.description) || "";
    }
    if (payload.entries !== undefined) {
        const entries = sortEntries(await normalizeEntries(event, payload.entries));
        if (published && !entries.length) {
            throw new AppError("A published round needs at least one entry; withdraw it instead", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        round.entries = entries;
    }

    round.updatedBy = actor._id;
    if (published) {
        round.correctedAt = new Date();
    }
    result.updatedBy = actor._id;
    await result.save();

    await audit(published ? AUDIT_ACTIONS.RESULT_CORRECTED : AUDIT_ACTIONS.RESULT_ROUND_SAVED, actor, result, event._id, { round: round.name }, round.status);
    return getResult(actor, event._id);
};

const deleteRound = async (actor, eventId, roundId) => {
    const { event } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.MANAGE_RESULTS, "You cannot manage results for this club");
    const result = await EventResult.findOne({ event: event._id });
    const round = findRound(result, roundId);

    if (round.status === RESULT_STATUS.PUBLISHED) {
        throw new AppError("Published rounds cannot be deleted; the president can withdraw them first", 409, ERROR_CODES.INVALID_STATE);
    }

    const name = round.name;
    round.deleteOne();
    result.updatedBy = actor._id;
    await result.save();

    await audit(AUDIT_ACTIONS.RESULT_ROUND_DELETED, actor, result, event._id, { round: name });
    return getResult(actor, event._id);
};

const publishRound = async (actor, eventId, roundId) => {
    const { event, context } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.PUBLISH_RESULTS, "Only the club president can publish results");
    assertAcceptsResults(event);

    const result = await EventResult.findOne({ event: event._id });
    const round = findRound(result, roundId);

    if (round.status === RESULT_STATUS.PUBLISHED) {
        throw new AppError("This round is already published", 409, ERROR_CODES.INVALID_STATE);
    }
    if (!round.entries.length) {
        throw new AppError("Add at least one entry before publishing this round", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const now = new Date();
    round.status = RESULT_STATUS.PUBLISHED;
    round.publishedAt = now;
    round.publishedBy = actor._id;
    round.correctedAt = null;
    result.lastPublishedAt = now;
    result.updatedBy = actor._id;
    await result.save();

    await audit(AUDIT_ACTIONS.RESULT_ROUND_PUBLISHED, actor, result, event._id, { round: round.name }, RESULT_STATUS.PUBLISHED);

    // Round results matter to the people competing; the whole campus hears about the final results.
    const qualified = round.entries.filter((entry) => entry.qualified === true).length;
    await notify(await registrantIds(event._id), {
        type: NOTIFICATION_TYPES.ROUND_RESULTS,
        title: `${round.name} results: ${event.title}`,
        message: qualified ? `${qualified} ${qualified === 1 ? "entry goes" : "entries go"} through to the next round.` : "See the standings.",
        link: RESULTS_LINK(event._id),
        exclude: [actor._id]
    });
    await sendRoundResultEmails(event, round, context.club, actor);

    return getResult(actor, event._id);
};

const unpublishRound = async (actor, eventId, roundId) => {
    const { event } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.PUBLISH_RESULTS, "Only the club president can withdraw results");
    const result = await EventResult.findOne({ event: event._id });
    const round = findRound(result, roundId);

    if (round.status !== RESULT_STATUS.PUBLISHED) {
        throw new AppError("This round is not published", 409, ERROR_CODES.INVALID_STATE);
    }

    round.status = RESULT_STATUS.DRAFT;
    round.publishedAt = null;
    round.publishedBy = null;
    round.correctedAt = null;
    result.updatedBy = actor._id;
    await result.save();

    await audit(AUDIT_ACTIONS.RESULT_ROUND_UNPUBLISHED, actor, result, event._id, { round: round.name }, RESULT_STATUS.DRAFT);
    return getResult(actor, event._id);
};

// ---------------------------------------------------------------- final results

const upsertResult = async (actor, eventId, payload) => {
    const { event, context } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.MANAGE_RESULTS, "You cannot manage results for this club");
    assertAcceptsResults(event);

    if (!hasStarted(event)) {
        throw new AppError("Final results can be prepared once the event has started; use rounds before that", 409, ERROR_CODES.INVALID_STATE);
    }

    if (!payload.summary || !String(payload.summary).trim()) {
        throw new AppError("Result summary is required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const result = await loadResultDoc(event, actor);
    const published = result.status === RESULT_STATUS.PUBLISHED;
    assertMayEdit(context, published, "Final results");

    const awards = await normalizeAwards(event, payload.awards || []);
    result.summary = String(payload.summary).trim();
    result.awards = awards;
    result.updatedBy = actor._id;
    if (published) {
        result.correctedAt = new Date();
    }
    await result.save();

    await audit(published ? AUDIT_ACTIONS.RESULT_CORRECTED : AUDIT_ACTIONS.RESULT_SAVED, actor, result, event._id, { awards: awards.length, final: true }, result.status);
    return getResult(actor, event._id);
};

const publishResult = async (actor, eventId) => {
    const { event, context } = await loadForResults(actor, eventId, CLUB_PERMISSIONS.PUBLISH_RESULTS, "Only the club president can publish results");
    assertCanPublishFinal(event);

    const result = await EventResult.findOne({ event: event._id });

    if (!result || !result.summary) {
        throw new AppError("Save the final results draft before publishing", 404, ERROR_CODES.NOT_FOUND);
    }

    if (result.status === RESULT_STATUS.PUBLISHED) {
        throw new AppError("Final results are already published", 409, ERROR_CODES.INVALID_STATE);
    }

    const now = new Date();
    result.status = RESULT_STATUS.PUBLISHED;
    result.publishedAt = now;
    result.publishedBy = actor._id;
    result.lastPublishedAt = now;
    result.updatedBy = actor._id;
    await result.save();

    await audit(AUDIT_ACTIONS.RESULT_PUBLISHED, actor, result, event._id, { final: true }, RESULT_STATUS.PUBLISHED);

    const winners = [...result.awards]
        .sort((a, b) => (a.position || 99) - (b.position || 99))
        .slice(0, 3)
        .map((award) => `${award.title}: ${award.teamName || award.recipientName}`)
        .join(" · ");

    // Everyone on campus is notified in-app; winners, participants and club members are emailed.
    await notifyAllUsers({
        type: NOTIFICATION_TYPES.RESULT_PUBLISHED,
        title: `Results are out for ${event.title}`,
        message: winners || result.summary.slice(0, 200),
        link: RESULTS_LINK(event._id),
        exclude: [actor._id]
    });
    await sendResultEmails(event, result, context.club, actor);

    return getResult(actor, event._id);
};

// ---------------------------------------------------------------- reading

// Organisers (results managers and the mentor) see drafts; everyone else sees only what is published.
const shapeResult = (result, { canSeeDrafts, canEdit, canPublish }) => {
    const plain = result.toObject();
    const finalPublished = plain.status === RESULT_STATUS.PUBLISHED;
    const rounds = plain.rounds
        .filter((round) => canSeeDrafts || round.status === RESULT_STATUS.PUBLISHED)
        .map((round) => ({ ...round, entries: sortEntries(round.entries) }));

    return {
        _id: plain._id,
        event: plain.event,
        status: plain.status,
        summary: finalPublished || canSeeDrafts ? plain.summary : "",
        awards: finalPublished || canSeeDrafts ? plain.awards : [],
        publishedAt: plain.publishedAt,
        correctedAt: plain.correctedAt,
        lastPublishedAt: plain.lastPublishedAt,
        createdBy: plain.createdBy,
        updatedAt: plain.updatedAt,
        rounds,
        viewer: { canSeeDrafts, canEdit, canPublish }
    };
};

const getResult = async (actor, eventId) => {
    const event = await findEvent(eventId);
    const result = await populateResult(EventResult.findOne({ event: event._id }));

    const context = actor ? await getClubContext(actor, event.club) : null;
    const canEdit = Boolean(context && contextHas(context, CLUB_PERMISSIONS.MANAGE_RESULTS));
    const canPublish = Boolean(context && contextHas(context, CLUB_PERMISSIONS.PUBLISH_RESULTS));
    const canSeeDrafts = canEdit || Boolean(context?.isMentor);

    const somethingPublic =
        result && (result.status === RESULT_STATUS.PUBLISHED || result.rounds.some((round) => round.status === RESULT_STATUS.PUBLISHED));

    if (!result || (!somethingPublic && !canSeeDrafts)) {
        throw new AppError("Results have not been published yet", 404, ERROR_CODES.NOT_FOUND);
    }

    return shapeResult(result, { canSeeDrafts, canEdit, canPublish });
};

// The Results page: one card per event with anything published, newest first.
// stage=final → events with final results; stage=live → rounds out, final results still to come.
const listPublishedResults = async (query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 12 });
    const anythingPublished = { $or: [{ status: RESULT_STATUS.PUBLISHED }, { "rounds.status": RESULT_STATUS.PUBLISHED }] };
    const filter = { ...anythingPublished };

    if (query.club) {
        filter.club = query.club;
    }

    if (String(query.search || "").trim()) {
        const matching = await Event.find({ title: searchRegex(query.search) }).select("_id");
        filter.event = { $in: matching.map((event) => event._id) };
    }

    const base = { ...filter };
    if (query.stage === "final") {
        filter.status = RESULT_STATUS.PUBLISHED;
    } else if (query.stage === "live") {
        filter.status = { $ne: RESULT_STATUS.PUBLISHED };
    }

    const [docs, total, finalCount, liveCount] = await Promise.all([
        populateResult(EventResult.find(filter).sort({ lastPublishedAt: -1, publishedAt: -1 }).skip(pagination.skip).limit(pagination.limit)),
        EventResult.countDocuments(filter),
        EventResult.countDocuments({ ...base, status: RESULT_STATUS.PUBLISHED }),
        EventResult.countDocuments({ ...base, status: { $ne: RESULT_STATUS.PUBLISHED } })
    ]);

    const items = docs.map((doc) => {
        const published = doc.rounds.filter((round) => round.status === RESULT_STATUS.PUBLISHED);
        const latest = [...published].sort((a, b) => b.publishedAt - a.publishedAt)[0] || null;
        const final = doc.status === RESULT_STATUS.PUBLISHED;
        return {
            _id: doc._id,
            event: doc.event,
            final,
            publishedAt: doc.publishedAt,
            lastPublishedAt: doc.lastPublishedAt || doc.publishedAt,
            winners: final
                ? [...doc.awards].sort((a, b) => (a.position || 99) - (b.position || 99)).slice(0, 3)
                : [],
            rounds: {
                published: published.length,
                latest: latest ? { name: latest.name, publishedAt: latest.publishedAt } : null
            }
        };
    });

    return { items, counts: { all: finalCount + liveCount, final: finalCount, live: liveCount }, ...paginationMeta(pagination, total) };
};

module.exports = {
    createRound,
    updateRound,
    deleteRound,
    publishRound,
    unpublishRound,
    upsertResult,
    publishResult,
    getResult,
    listPublishedResults,
    RESULTS_LINK
};
