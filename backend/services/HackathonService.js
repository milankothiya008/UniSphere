const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const Hackathon = require("../models/Hackathon");
const HackathonEntry = require("../models/HackathonEntry");
const Team = require("../models/Team");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS, PARTICIPATION_MODES, TEAM_STATUS, TEAM_MEMBER_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { formatDate, formatTime } = require("../utils/CampusTime");
const { getClubContext, contextHas } = require("./AuthorizationService");
const { notify } = require("./NotificationService");
const { recordAudit } = require("./AuditService");

// Hackathon mode for HACKATHON events (see models/Hackathon). The flow, like a real hackathon:
//   1. Students register (alone or as a team) like any event — no problem statement is needed to register.
//   2. Problem statements are revealed once the event has started (revealAt).
//   3. Each team picks one before selectionDeadline (they can change their mind until then).
//   4. Each team submits its project (links, summary) before submissionDeadline; edits allowed until then.
//   5. Judges (faculty or invited students not taking part) score every project on the criteria.
//   6. The leaderboard (average of the judges' totals) is turned into the event's results draft, which the
//      president publishes like any other results.

const HOUR = 60 * 60 * 1000;
const MAX_JUDGES = 15;
const MAX_PROBLEMS = 30;
const MAX_AGENDA = 40;
const { LEADER, ACCEPTED } = TEAM_MEMBER_STATUS;

const DEFAULT_CRITERIA = [
    { name: "Innovation", maxScore: 10 },
    { name: "Technical complexity", maxScore: 10 },
    { name: "Design & usability", maxScore: 10 },
    { name: "Presentation", maxScore: 10 }
];

const isHackathon = (event) => event?.category === "HACKATHON";
const fail = (message, status = 400, code = ERROR_CODES.VALIDATION_ERROR) => new AppError(message, status, code);
const idOf = (value) => String(value?._id || value || "");

// Deadlines that fit inside the event: problems out at the start, a quarter of the time (max 2 h) to choose,
// projects due shortly before the end.
const defaultTimes = (event) => {
    const start = event.startAt.getTime();
    const span = event.endAt.getTime() - start;
    const selection = start + Math.min(2 * HOUR, Math.round(span * 0.25));
    const submission = Math.max(selection + 60 * 1000, event.endAt.getTime() - Math.min(HOUR, Math.round(span * 0.1)));
    return { revealAt: new Date(start), selectionDeadline: new Date(selection), submissionDeadline: new Date(Math.min(submission, event.endAt.getTime())) };
};

const timesFit = (event, times) =>
    times.revealAt >= event.startAt && times.revealAt < times.selectionDeadline && times.selectionDeadline < times.submissionDeadline && times.submissionDeadline <= event.endAt;

const loadEvent = async (eventId) => {
    const event = await Event.findById(eventId);
    if (!event) throw fail("Event not found", 404, ERROR_CODES.NOT_FOUND);
    if (!isHackathon(event)) throw fail("This event isn't a hackathon", 409, ERROR_CODES.INVALID_STATE);
    return event;
};

/** The event's hackathon settings, created with defaults the first time, and moved along if the event moved. */
const ensureHackathon = async (event) => {
    let hackathon = await Hackathon.findOne({ event: event._id });
    if (!hackathon) {
        hackathon = await Hackathon.create({ event: event._id, club: event.club, ...defaultTimes(event), criteria: DEFAULT_CRITERIA });
    } else if (!timesFit(event, hackathon)) {
        // The event was rescheduled: put the deadlines back inside it.
        Object.assign(hackathon, defaultTimes(event));
        await hackathon.save();
    }
    return hackathon;
};

// Who the viewer is for this hackathon.
const accessFor = async (actor, event, hackathon) => {
    const context = actor ? await getClubContext(actor, event.club) : null;
    const staff = Boolean(context && contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS));
    return {
        context,
        staff,
        mentor: Boolean(context?.isMentor),
        resultsManager: Boolean(context && contextHas(context, CLUB_PERMISSIONS.MANAGE_RESULTS)),
        judge: Boolean(actor && hackathon.judges.some((judge) => idOf(judge.user) === idOf(actor._id)))
    };
};

/** The viewer's entry as a registered participant: their team, or themselves for individual events. */
const participantEntryFor = async (actor, event) => {
    if (!actor) return null;
    const registration = await EventRegistration.findOne({ event: event._id, user: actor._id, status: REGISTRATION_STATUS.REGISTERED }).lean();
    if (!registration) return null;
    if (event.participationMode === PARTICIPATION_MODES.TEAM) {
        const team = registration.team ? await Team.findById(registration.team).lean() : null;
        if (!team || team.status !== TEAM_STATUS.ACTIVE) return null;
        return {
            entryKey: `team:${team._id}`,
            team: team._id,
            owner: team.leader,
            name: team.name,
            members: team.members.filter((member) => [LEADER, ACCEPTED].includes(member.status)).map((member) => idOf(member.user))
        };
    }
    return { entryKey: `user:${actor._id}`, team: null, owner: actor._id, name: actor.name, members: [idOf(actor._id)] };
};

const phaseOf = (event, hackathon, now = new Date()) => {
    if (event.status === EVENT_STATUS.CANCELLED) return "CANCELLED";
    if (now < hackathon.revealAt) return "UPCOMING";
    if (now < hackathon.selectionDeadline) return "SELECTION";
    if (now < hackathon.submissionDeadline) return "BUILDING";
    return "JUDGING";
};

const maxTotal = (hackathon) => hackathon.criteria.reduce((sum, criterion) => sum + criterion.maxScore, 0);

const problemView = (problem, counts) => ({
    _id: problem._id,
    title: problem.title,
    description: problem.description,
    track: problem.track,
    maxTeams: problem.maxTeams,
    teams: counts.get(idOf(problem._id)) || 0
});

const entryView = (entry, hackathon) => {
    if (!entry) return null;
    const problem = hackathon.problemStatements.id(entry.problemStatement);
    return {
        _id: entry._id,
        name: entry.name,
        problemStatement: problem ? { _id: problem._id, title: problem.title } : null,
        problemChosenAt: entry.problemChosenAt,
        project: entry.project,
        submittedAt: entry.submittedAt,
        updatedAt: entry.updatedAt
    };
};

/** Everything the event page shows about the hackathon, shaped for the viewer. */
const getHackathon = async (actor, eventId) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    const access = await accessFor(actor, event, hackathon);
    const now = new Date();
    const revealed = now >= hackathon.revealAt;
    const participant = await participantEntryFor(actor, event);
    const insider = access.staff || access.mentor || access.judge;
    const showProblems = insider ? access.staff || access.mentor || revealed : Boolean(participant) && revealed;

    const [counts, entry, judges] = await Promise.all([
        showProblems
            ? HackathonEntry.aggregate([{ $match: { event: event._id, problemStatement: { $ne: null } } }, { $group: { _id: "$problemStatement", n: { $sum: 1 } } }]).then(
                  (rows) => new Map(rows.map((row) => [idOf(row._id), row.n]))
              )
            : new Map(),
        participant ? HackathonEntry.findOne({ event: event._id, entryKey: participant.entryKey }) : null,
        access.staff || access.mentor ? User.find({ _id: { $in: hackathon.judges.map((judge) => judge.user) } }).select("name accountType departmentCode avatar").lean() : []
    ]);

    return {
        eventId: event._id,
        phase: phaseOf(event, hackathon, now),
        revealAt: hackathon.revealAt,
        selectionDeadline: hackathon.selectionDeadline,
        submissionDeadline: hackathon.submissionDeadline,
        agenda: [...hackathon.agenda].sort((a, b) => a.startsAt - b.startsAt),
        criteria: hackathon.criteria,
        maxTotal: maxTotal(hackathon),
        problemCount: hackathon.problemStatements.length,
        problemStatements: showProblems ? hackathon.problemStatements.map((problem) => problemView(problem, counts)) : [],
        judgeCount: hackathon.judges.length,
        judges: judges.map((judge) => ({ _id: judge._id, name: judge.name, accountType: judge.accountType, departmentCode: judge.departmentCode, avatar: judge.avatar || null })),
        resultsDraftedAt: hackathon.resultsDraftedAt,
        myEntry: participant ? { ...(entryView(entry, hackathon) || { name: participant.name, problemStatement: null, project: null, submittedAt: null }), members: participant.members.length } : null,
        viewer: {
            isParticipant: Boolean(participant),
            canManage: access.staff,
            canJudge: access.judge,
            canSeeLeaderboard: access.staff || access.mentor || access.resultsManager,
            canDraftResults: access.resultsManager,
            canChooseProblem: Boolean(participant) && revealed && now < hackathon.selectionDeadline && event.status === EVENT_STATUS.PUBLISHED,
            canSubmit: Boolean(participant) && revealed && now < hackathon.submissionDeadline && [EVENT_STATUS.PUBLISHED].includes(event.status)
        }
    };
};

// ---------------------------------------------------------------- Organisers: setup

const assertStaff = async (actor, event) => {
    const context = await getClubContext(actor, event.club);
    if (!contextHas(context, CLUB_PERMISSIONS.MANAGE_EVENTS)) {
        throw fail("Only the club's event organisers can set up the hackathon", 403, ERROR_CODES.FORBIDDEN);
    }
    if ([EVENT_STATUS.CANCELLED, EVENT_STATUS.REJECTED].includes(event.status)) {
        throw fail("This event is no longer running", 409, ERROR_CODES.INVALID_STATE);
    }
    return context;
};

const dateOrThrow = (value, label) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) throw fail(`${label} is not a valid date and time`);
    return date;
};

const audit = (event, action, actor, metadata = {}) => recordAudit({ action, actor: actor._id, targetType: "Event", targetId: event._id, metadata: { clubId: event.club, ...metadata } });

/** Deadlines, agenda and judging criteria. */
const updateSettings = async (actor, eventId, payload = {}) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);

    const times = {
        revealAt: payload.revealAt !== undefined ? dateOrThrow(payload.revealAt, "Problem statement release") : hackathon.revealAt,
        selectionDeadline: payload.selectionDeadline !== undefined ? dateOrThrow(payload.selectionDeadline, "Problem selection deadline") : hackathon.selectionDeadline,
        submissionDeadline: payload.submissionDeadline !== undefined ? dateOrThrow(payload.submissionDeadline, "Submission deadline") : hackathon.submissionDeadline
    };
    if (times.revealAt < event.startAt) throw fail("Problem statements can be released once the event has started, not before");
    if (times.selectionDeadline <= times.revealAt) throw fail("The problem selection deadline must be after the problem statements are released");
    if (times.submissionDeadline <= times.selectionDeadline) throw fail("The submission deadline must be after the problem selection deadline");
    if (times.submissionDeadline > event.endAt) throw fail("The submission deadline must be before the event ends");
    Object.assign(hackathon, times);

    if (payload.agenda !== undefined) {
        if (!Array.isArray(payload.agenda) || payload.agenda.length > MAX_AGENDA) throw fail(`The agenda can have at most ${MAX_AGENDA} items`);
        hackathon.agenda = payload.agenda.map((item, index) => {
            const title = String(item?.title || "").trim();
            if (title.length < 2) throw fail(`Agenda item ${index + 1}: add a title`);
            const startsAt = dateOrThrow(item.startsAt, `Agenda item ${index + 1}`);
            if (startsAt < new Date(event.startAt.getTime() - 24 * HOUR) || startsAt > event.endAt) throw fail(`Agenda item ${index + 1} must be during the event`);
            return { ...(item._id ? { _id: item._id } : {}), title, startsAt, note: String(item.note || "").trim().slice(0, 300) };
        });
    }

    if (payload.criteria !== undefined) {
        const scored = await HackathonEntry.exists({ event: event._id, "scores.0": { $exists: true } });
        if (scored) throw fail("Judges have started scoring, so the criteria can't change any more", 409, ERROR_CODES.INVALID_STATE);
        if (!Array.isArray(payload.criteria) || payload.criteria.length < 1 || payload.criteria.length > 10) throw fail("Use 1 to 10 judging criteria");
        hackathon.criteria = payload.criteria.map((criterion, index) => {
            const name = String(criterion?.name || "").trim();
            const maxScore = Number(criterion?.maxScore);
            if (name.length < 2) throw fail(`Criterion ${index + 1}: add a name`);
            if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 100) throw fail(`Criterion ${index + 1}: the maximum score must be 1-100`);
            return { ...(criterion._id ? { _id: criterion._id } : {}), name, maxScore };
        });
    }

    hackathon.updatedBy = actor._id;
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_UPDATED, actor, { fields: Object.keys(payload) });
    return getHackathon(actor, event._id);
};

const normalizeProblem = (payload) => {
    const title = String(payload?.title || "").trim();
    const description = String(payload?.description || "").trim();
    if (title.length < 3) throw fail("Give the problem statement a title (at least 3 characters)");
    if (description.length < 10) throw fail("Describe the problem (at least 10 characters)");
    const maxTeams = payload.maxTeams === null || payload.maxTeams === undefined || payload.maxTeams === "" ? null : Number(payload.maxTeams);
    if (maxTeams !== null && (!Number.isInteger(maxTeams) || maxTeams < 1)) throw fail("Team limit must be a positive whole number, or empty for no limit");
    return { title: title.slice(0, 160), description: description.slice(0, 4000), track: String(payload.track || "").trim().slice(0, 60), maxTeams };
};

const addProblem = async (actor, eventId, payload) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);
    if (hackathon.problemStatements.length >= MAX_PROBLEMS) throw fail(`A hackathon can have at most ${MAX_PROBLEMS} problem statements`);
    hackathon.problemStatements.push(normalizeProblem(payload));
    hackathon.updatedBy = actor._id;
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_UPDATED, actor, { problem: "added" });
    return getHackathon(actor, event._id);
};

const updateProblem = async (actor, eventId, problemId, payload) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);
    const problem = hackathon.problemStatements.id(problemId);
    if (!problem) throw fail("Problem statement not found", 404, ERROR_CODES.NOT_FOUND);
    Object.assign(problem, normalizeProblem(payload));
    hackathon.updatedBy = actor._id;
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_UPDATED, actor, { problem: "updated" });
    return getHackathon(actor, event._id);
};

const deleteProblem = async (actor, eventId, problemId) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);
    const problem = hackathon.problemStatements.id(problemId);
    if (!problem) throw fail("Problem statement not found", 404, ERROR_CODES.NOT_FOUND);
    if (await HackathonEntry.exists({ event: event._id, problemStatement: problem._id })) {
        throw fail("A team has already chosen this problem statement, so it can only be edited", 409, ERROR_CODES.INVALID_STATE);
    }
    problem.deleteOne();
    hackathon.updatedBy = actor._id;
    await hackathon.save();
    return getHackathon(actor, event._id);
};

// ---------------------------------------------------------------- Organisers: judges

const addJudge = async (actor, eventId, userId) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);
    if (hackathon.judges.length >= MAX_JUDGES) throw fail(`A hackathon can have at most ${MAX_JUDGES} judges`);
    const user = await User.findOne({ _id: userId, isActive: true, isEmailVerified: true }).select("name accountType");
    if (!user) throw fail("That account wasn't found", 404, ERROR_CODES.NOT_FOUND);
    if (user.accountType !== "FACULTY" && user.accountType !== "STUDENT") throw fail("Judges must be faculty or students");
    if (hackathon.judges.some((judge) => idOf(judge.user) === idOf(user._id))) throw fail(`${user.name} is already a judge`, 409, ERROR_CODES.CONFLICT);
    if (await EventRegistration.exists({ event: event._id, user: user._id, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } })) {
        throw fail(`${user.name} is taking part in this hackathon, so they can't judge it`, 409, ERROR_CODES.CONFLICT);
    }
    hackathon.judges.push({ user: user._id, addedBy: actor._id });
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_JUDGES_UPDATED, actor, { added: user._id });
    await notify([user._id], {
        type: NOTIFICATION_TYPES.JUDGE_INVITE,
        title: `You're a judge for ${event.title}`,
        message: `Projects are due ${formatDate(hackathon.submissionDeadline)}, ${formatTime(hackathon.submissionDeadline)}. Your judging panel opens then.`,
        link: `/events/${event._id}/hackathon?tab=judging`,
        email: true,
        emailCategory: EMAIL_CATEGORIES.ACCOUNT
    });
    return getHackathon(actor, event._id);
};

const removeJudge = async (actor, eventId, userId) => {
    const event = await loadEvent(eventId);
    await assertStaff(actor, event);
    const hackathon = await ensureHackathon(event);
    if (await HackathonEntry.exists({ event: event._id, "scores.judge": userId })) {
        throw fail("This judge has already scored projects, so they stay on the panel", 409, ERROR_CODES.INVALID_STATE);
    }
    hackathon.judges = hackathon.judges.filter((judge) => idOf(judge.user) !== idOf(userId));
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_JUDGES_UPDATED, actor, { removed: userId });
    return getHackathon(actor, event._id);
};

// ---------------------------------------------------------------- Teams: choose a problem, submit the project

const loadEntryFor = async (actor, event) => {
    const participant = await participantEntryFor(actor, event);
    if (!participant) throw fail("Only registered participants (and their team) can do this", 403, ERROR_CODES.FORBIDDEN);
    const entry = await HackathonEntry.findOneAndUpdate(
        { event: event._id, entryKey: participant.entryKey },
        { $setOnInsert: { event: event._id, entryKey: participant.entryKey, team: participant.team, owner: participant.owner, name: participant.name } },
        { upsert: true, returnDocument: "after" }
    );
    return { entry, participant };
};

const notifyTeam = async (participant, actor, payload) => {
    const others = participant.members.filter((id) => id !== idOf(actor._id));
    if (others.length) await notify(others, { type: NOTIFICATION_TYPES.HACKATHON_UPDATE, ...payload });
};

const chooseProblem = async (actor, eventId, problemId) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    const now = new Date();
    if (event.status !== EVENT_STATUS.PUBLISHED) throw fail("This hackathon isn't running", 409, ERROR_CODES.INVALID_STATE);
    if (now < hackathon.revealAt) throw fail("Problem statements haven't been released yet", 409, ERROR_CODES.INVALID_STATE);
    if (now >= hackathon.selectionDeadline) throw fail("The problem selection deadline has passed", 409, ERROR_CODES.INVALID_STATE);
    const problem = hackathon.problemStatements.id(problemId);
    if (!problem) throw fail("Problem statement not found", 404, ERROR_CODES.NOT_FOUND);
    const { entry, participant } = await loadEntryFor(actor, event);
    if (idOf(entry.problemStatement) === idOf(problem._id)) return getHackathon(actor, event._id);
    if (problem.maxTeams && (await HackathonEntry.countDocuments({ event: event._id, problemStatement: problem._id })) >= problem.maxTeams) {
        throw fail(`"${problem.title}" already has its ${problem.maxTeams} team${problem.maxTeams === 1 ? "" : "s"}. Choose another problem.`, 409, ERROR_CODES.CONFLICT);
    }
    entry.problemStatement = problem._id;
    entry.problemChosenAt = now;
    entry.problemChosenBy = actor._id;
    await entry.save();
    await notifyTeam(participant, actor, {
        title: `${entry.name} chose "${problem.title}"`,
        message: `${actor.name} picked your team's problem statement. It can be changed until ${formatTime(hackathon.selectionDeadline)}.`,
        link: `/events/${event._id}/hackathon`
    });
    return getHackathon(actor, event._id);
};

const cleanUrl = (value, label, { required = false } = {}) => {
    const text = String(value || "").trim();
    if (!text) {
        if (required) throw fail(`Add the ${label}`);
        return "";
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        throw fail(`The ${label} must be a full link starting with https://`);
    }
    if (!["http:", "https:"].includes(url.protocol)) throw fail(`The ${label} must be an http(s) link`);
    return url.toString().slice(0, 500);
};

const submitProject = async (actor, eventId, payload = {}) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    const now = new Date();
    if (event.status !== EVENT_STATUS.PUBLISHED) throw fail("This hackathon isn't running", 409, ERROR_CODES.INVALID_STATE);
    if (now < hackathon.revealAt) throw fail("Submissions open once the problem statements are released", 409, ERROR_CODES.INVALID_STATE);
    if (now >= hackathon.submissionDeadline) throw fail("The submission deadline has passed", 409, ERROR_CODES.INVALID_STATE);
    const { entry, participant } = await loadEntryFor(actor, event);
    if (hackathon.problemStatements.length && !entry.problemStatement) throw fail("Choose your problem statement before submitting", 409, ERROR_CODES.INVALID_STATE);

    const title = String(payload.title || "").trim();
    const summary = String(payload.summary || "").trim();
    if (title.length < 2) throw fail("Give your project a name");
    if (summary.length < 20) throw fail("Describe what you built (at least 20 characters)");
    const project = {
        title: title.slice(0, 120),
        summary: summary.slice(0, 3000),
        repoUrl: cleanUrl(payload.repoUrl, "code repository link"),
        demoUrl: cleanUrl(payload.demoUrl, "demo link"),
        videoUrl: cleanUrl(payload.videoUrl, "video link"),
        deckUrl: cleanUrl(payload.deckUrl, "presentation link"),
        techStack: String(payload.techStack || "").trim().slice(0, 300)
    };
    if (!project.repoUrl && !project.demoUrl) throw fail("Add at least a code repository link or a demo link");

    const first = !entry.submittedAt;
    entry.project = project;
    entry.submittedAt = now;
    entry.submittedBy = actor._id;
    await entry.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_SUBMITTED, actor, { entry: entry._id, first });
    await notifyTeam(participant, actor, {
        title: first ? `${entry.name} submitted "${project.title}"` : `${entry.name}'s submission was updated`,
        message: `By ${actor.name}. You can edit it until ${formatTime(hackathon.submissionDeadline)}.`,
        link: `/events/${event._id}/hackathon`
    });
    return getHackathon(actor, event._id);
};

// ---------------------------------------------------------------- Judges

const judgingOpen = (event, hackathon, now = new Date()) => now >= hackathon.submissionDeadline || event.status === EVENT_STATUS.COMPLETED;

const assertJudge = async (actor, event, hackathon) => {
    if (!hackathon.judges.some((judge) => idOf(judge.user) === idOf(actor._id))) throw fail("Only this hackathon's judges can score projects", 403, ERROR_CODES.FORBIDDEN);
};

/** The judge's panel: every submitted project, with the judge's own scores. */
const listForJudging = async (actor, eventId) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    await assertJudge(actor, event, hackathon);
    const open = judgingOpen(event, hackathon);
    const entries = open ? await HackathonEntry.find({ event: event._id, submittedAt: { $ne: null } }).sort({ submittedAt: 1 }) : [];
    return {
        open,
        opensAt: hackathon.submissionDeadline,
        criteria: hackathon.criteria,
        maxTotal: maxTotal(hackathon),
        entries: entries.map((entry) => {
            const mine = entry.scores.find((score) => idOf(score.judge) === idOf(actor._id));
            return { ...entryView(entry, hackathon), myScore: mine ? { marks: mine.marks, total: mine.total, comment: mine.comment, scoredAt: mine.scoredAt } : null };
        }),
        scored: entries.filter((entry) => entry.scores.some((score) => idOf(score.judge) === idOf(actor._id))).length
    };
};

const scoreEntry = async (actor, eventId, entryId, payload = {}) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    await assertJudge(actor, event, hackathon);
    if (!judgingOpen(event, hackathon)) throw fail("Judging opens when the submission deadline passes", 409, ERROR_CODES.INVALID_STATE);
    if (event.status === EVENT_STATUS.CANCELLED) throw fail("This hackathon was cancelled", 409, ERROR_CODES.INVALID_STATE);
    const entry = await HackathonEntry.findOne({ _id: entryId, event: event._id, submittedAt: { $ne: null } });
    if (!entry) throw fail("Submission not found", 404, ERROR_CODES.NOT_FOUND);

    const given = new Map((Array.isArray(payload.marks) ? payload.marks : []).map((mark) => [idOf(mark.criterion), Number(mark.score)]));
    const marks = hackathon.criteria.map((criterion) => {
        const score = given.get(idOf(criterion._id));
        if (!Number.isFinite(score) || score < 0 || score > criterion.maxScore) throw fail(`Give "${criterion.name}" a score from 0 to ${criterion.maxScore}`);
        return { criterion: criterion._id, score: Math.round(score * 10) / 10 };
    });
    const score = { judge: actor._id, marks, total: marks.reduce((sum, mark) => sum + mark.score, 0), comment: String(payload.comment || "").trim().slice(0, 1000), scoredAt: new Date() };

    entry.scores = [...entry.scores.filter((item) => idOf(item.judge) !== idOf(actor._id)), score];
    await entry.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_SCORED, actor, { entry: entry._id, total: score.total });
    return listForJudging(actor, event._id);
};

// ---------------------------------------------------------------- Leaderboard and results

const rankEntries = (entries, hackathon) => {
    const max = maxTotal(hackathon) || 1;
    return entries
        .map((entry) => {
            const totals = entry.scores.map((score) => score.total);
            const average = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
            return { entry, average, judges: totals.length, percent: average === null ? null : Math.round((average / max) * 1000) / 10 };
        })
        .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || (a.entry.submittedAt || 0) - (b.entry.submittedAt || 0))
        .map((row, index) => ({ ...row, rank: row.average === null ? null : index + 1 }));
};

const getLeaderboard = async (actor, eventId) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    const access = await accessFor(actor, event, hackathon);
    if (!access.staff && !access.mentor && !access.resultsManager) throw fail("The leaderboard is for the organisers and the mentor", 403, ERROR_CODES.FORBIDDEN);

    const [entries, registeredEntries] = await Promise.all([
        HackathonEntry.find({ event: event._id }).sort({ submittedAt: 1 }),
        event.participationMode === PARTICIPATION_MODES.TEAM
            ? EventRegistration.distinct("team", { event: event._id, status: REGISTRATION_STATUS.REGISTERED, team: { $ne: null } }).then((teams) => teams.length)
            : EventRegistration.countDocuments({ event: event._id, status: REGISTRATION_STATUS.REGISTERED })
    ]);
    const submitted = entries.filter((entry) => entry.submittedAt);
    const judgeNames = new Map((await User.find({ _id: { $in: hackathon.judges.map((judge) => judge.user) } }).select("name").lean()).map((user) => [idOf(user._id), user.name]));

    return {
        criteria: hackathon.criteria,
        maxTotal: maxTotal(hackathon),
        judgeCount: hackathon.judges.length,
        stats: {
            entries: registeredEntries,
            chosen: entries.filter((entry) => entry.problemStatement).length,
            submitted: submitted.length,
            fullyScored: submitted.filter((entry) => entry.scores.length >= hackathon.judges.length && hackathon.judges.length > 0).length
        },
        judgingOpen: judgingOpen(event, hackathon),
        resultsDraftedAt: hackathon.resultsDraftedAt,
        rows: rankEntries(submitted, hackathon).map(({ entry, average, judges, percent, rank }) => ({
            ...entryView(entry, hackathon),
            rank,
            average: average === null ? null : Math.round(average * 10) / 10,
            percent,
            judges,
            // Criterion averages, for the breakdown.
            byCriterion: hackathon.criteria.map((criterion) => {
                const values = entry.scores.map((score) => score.marks.find((mark) => idOf(mark.criterion) === idOf(criterion._id))?.score).filter((value) => typeof value === "number");
                return { criterion: criterion._id, average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null };
            }),
            comments: entry.scores.filter((score) => score.comment).map((score) => ({ judge: judgeNames.get(idOf(score.judge)) || "Judge", comment: score.comment }))
        }))
    };
};

const DEFAULT_TITLES = ["Winner", "1st runner-up", "2nd runner-up"];

/** Turns the leaderboard into the results draft: awards for the top entries and a "Judging" round with every ranked team. */
const draftResults = async (actor, eventId, { winners = 3, titles = [] } = {}) => {
    const event = await loadEvent(eventId);
    const hackathon = await ensureHackathon(event);
    const count = Number(winners);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw fail("Choose between 1 and 10 winners");
    if (!judgingOpen(event, hackathon)) throw fail("Results can be prepared after the submission deadline", 409, ERROR_CODES.INVALID_STATE);

    const entries = await HackathonEntry.find({ event: event._id, submittedAt: { $ne: null } });
    const ranked = rankEntries(entries, hackathon).filter((row) => row.average !== null);
    if (!ranked.length) throw fail("No project has been scored yet", 409, ERROR_CODES.INVALID_STATE);

    const isTeam = event.participationMode === PARTICIPATION_MODES.TEAM;
    const who = (entry) => (isTeam ? { teamName: entry.name, recipientUser: entry.owner } : { recipientUser: entry.owner });
    const results = require("./ResultService");
    const awards = ranked.slice(0, count).map((row, index) => ({
        title: String(titles[index] || DEFAULT_TITLES[index] || `Rank ${index + 1}`).slice(0, 120),
        position: index + 1,
        ...who(row.entry),
        recognition: `${row.entry.project.title} · ${row.average}/${maxTotal(hackathon)}`
    }));
    const summary = `${ranked.length} project${ranked.length === 1 ? "" : "s"} judged by ${hackathon.judges.length} judge${hackathon.judges.length === 1 ? "" : "s"} on ${hackathon.criteria.map((criterion) => criterion.name.toLowerCase()).join(", ")}.`;

    await results.upsertResult(actor, event._id, { summary, awards });
    const standings = ranked.map((row) => ({ rank: row.rank, ...who(row.entry), score: `${row.average}/${maxTotal(hackathon)}`, note: row.entry.project.title.slice(0, 200) }));
    const current = await results.getResult(actor, event._id);
    const existing = current.rounds?.find((round) => round.name === "Judging");
    if (existing) {
        await results.updateRound(actor, event._id, existing._id, { name: "Judging", description: "Final judging scores (average of the judges).", entries: standings });
    } else {
        await results.createRound(actor, event._id, { name: "Judging", description: "Final judging scores (average of the judges).", entries: standings });
    }
    hackathon.resultsDraftedAt = new Date();
    await hackathon.save();
    await audit(event, AUDIT_ACTIONS.HACKATHON_RESULTS_DRAFTED, actor, { winners: count });
    return getLeaderboard(actor, event._id);
};

// ---------------------------------------------------------------- Time-based notifications

const participantIds = async (eventId) =>
    (await EventRegistration.find({ event: eventId, status: REGISTRATION_STATUS.REGISTERED }).select("user").lean()).map((row) => row.user);

// Members of entries that haven't done something yet (chosen a problem / submitted).
const laggingMemberIds = async (event, missing) => {
    const entries = await HackathonEntry.find({ event: event._id }).lean();
    const done = new Set(entries.filter((entry) => (missing === "problem" ? entry.problemStatement : entry.submittedAt)).map((entry) => entry.entryKey));
    const registrations = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED }).select("user team").lean();
    return registrations.filter((row) => !done.has(row.team ? `team:${row.team}` : `user:${row.user}`)).map((row) => row.user);
};

const markNotified = async (hackathon, kind) => (await Hackathon.updateOne({ _id: hackathon._id, notified: { $ne: kind } }, { $push: { notified: kind } })).modifiedCount === 1;

const sweepHackathons = async ({ now = new Date() } = {}) => {
    const events = await Event.find({ category: "HACKATHON", status: EVENT_STATUS.PUBLISHED, startAt: { $lte: new Date(now.getTime() + 2 * HOUR) }, endAt: { $gt: new Date(now.getTime() - 12 * HOUR) } });
    let sent = 0;
    for (const event of events) {
        const hackathon = await Hackathon.findOne({ event: event._id });
        if (!hackathon) continue;
        const link = `/events/${event._id}/hackathon`;
        const steps = [
            {
                kind: "REVEAL",
                due: now >= hackathon.revealAt && now < hackathon.selectionDeadline && hackathon.problemStatements.length > 0,
                to: () => participantIds(event._id),
                title: `Problem statements are live: ${event.title}`,
                message: `Choose your team's problem by ${formatTime(hackathon.selectionDeadline)}.`
            },
            {
                kind: "SELECTION_1H",
                due: now >= new Date(hackathon.selectionDeadline - HOUR) && now < hackathon.selectionDeadline && hackathon.problemStatements.length > 0,
                to: () => laggingMemberIds(event, "problem"),
                title: `Choose a problem statement by ${formatTime(hackathon.selectionDeadline)}`,
                message: `Your team hasn't picked a problem for ${event.title} yet.`
            },
            {
                kind: "SUBMISSION_1H",
                due: now >= new Date(hackathon.submissionDeadline - HOUR) && now < hackathon.submissionDeadline,
                to: () => laggingMemberIds(event, "submission"),
                title: `Submit your project by ${formatTime(hackathon.submissionDeadline)}`,
                message: `${event.title}: submissions close in under an hour. Late projects can't be judged.`
            },
            {
                kind: "JUDGING_OPEN",
                due: now >= hackathon.submissionDeadline && hackathon.judges.length > 0,
                to: async () => hackathon.judges.map((judge) => judge.user),
                title: `Judging is open: ${event.title}`,
                message: "All projects are in. Score each one on the judging panel.",
                link: `${link}?tab=judging`
            }
        ];
        for (const step of steps) {
            if (!step.due || !(await markNotified(hackathon, step.kind))) continue;
            await notify(await step.to(), { type: NOTIFICATION_TYPES.HACKATHON_UPDATE, title: step.title, message: step.message, link: step.link || link });
            sent += 1;
        }
    }
    return sent;
};

module.exports = {
    isHackathon,
    ensureHackathon,
    getHackathon,
    updateSettings,
    addProblem,
    updateProblem,
    deleteProblem,
    addJudge,
    removeJudge,
    chooseProblem,
    submitProject,
    listForJudging,
    scoreEntry,
    getLeaderboard,
    draftResults,
    sweepHackathons,
    DEFAULT_CRITERIA
};
