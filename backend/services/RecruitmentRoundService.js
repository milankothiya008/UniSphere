const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    APPLICATION_STATUS,
    CLUB_STATUS,
    MEMBERSHIP_STATUS,
    NOTIFICATION_TYPES,
    RECRUITMENT_STATUS,
    ROUND_MODES,
    ROUND_OUTCOMES,
    ROUND_STATUS,
    ROUND_TIMING,
    VENUE_STATUS,
    AUDIT_ACTIONS
} = require("../constants/Statuses");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { assertVenueAvailable, withVenueLock } = require("./VenueService");
const mailer = require("./RecruitmentMailer");
const drives = require("./RecruitmentService");
const { positionTitles } = require("./ApplicationService");

// Selection rounds of a published drive, run by the president after applications close: screening,
// online or offline interviews (a common time or one slot per candidate), results with an email for every
// candidate, and the final selection that makes the chosen students members with their role.

const A = APPLICATION_STATUS;
const R = ROUND_STATUS;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);
const HTTPS_URL = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
const MAX_ROUNDS = 8;

const activeCandidates = (driveId) => RecruitmentApplication.find({ drive: driveId, status: { $in: drives.ACTIVE_APPLICATION } }).sort({ createdAt: 1, _id: 1 });

const loadRunning = async (actor, driveId) => {
    const drive = await drives.loadDrive(driveId);
    const context = await drives.assertManager(actor, drive);
    if (drive.status !== RECRUITMENT_STATUS.PUBLISHED) {
        throw conflict("Rounds run while the drive is published");
    }
    const phase = drives.phaseOf(drive);
    if (phase === "UPCOMING" || phase === "OPEN") {
        throw conflict("Close applications before starting the selection rounds");
    }
    return { drive, club: context.club };
};

const currentRound = (drive, roundId) => {
    const round = drive.rounds.id(roundId);
    if (!round) {
        throw new AppError("Round not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const last = drive.rounds[drive.rounds.length - 1];
    if (String(last._id) !== String(round._id)) {
        throw conflict("Only the latest round can change");
    }
    if (round.status === R.RESULTS_PUBLISHED) {
        throw conflict("This round's results are published, so it can't change any more");
    }
    return round;
};

const audit = (action, actor, drive, metadata = {}) =>
    recordAudit({ action, actor: actor._id, targetType: "RecruitmentDrive", targetId: drive._id, metadata: { clubId: drive.club, ...metadata } });

// ---------------------------------------------------------------- Views

/** The Rounds tab: every round with its candidates, their slots and outcomes. */
const getRounds = async (actor, driveId) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    await drive.populate("rounds.venue", "name location capacity");
    const applications = await RecruitmentApplication.find({ drive: drive._id, status: { $ne: A.WITHDRAWN } })
        .sort({ createdAt: 1, _id: 1 })
        .populate("applicant", "name email departmentCode batchCode");
    const last = drive.rounds[drive.rounds.length - 1];

    const rounds = drive.rounds.map((round) => {
        const isCurrent = last && String(last._id) === String(round._id) && round.status !== R.RESULTS_PUBLISHED;
        const candidates = applications
            .filter((application) => {
                const result = application.roundResults.find((item) => String(item.round) === String(round._id));
                return result || (isCurrent && drives.ACTIVE_APPLICATION.includes(application.status));
            })
            .map((application) => {
                const result = application.roundResults.find((item) => String(item.round) === String(round._id));
                const pending = String(application.pendingOutcome?.round) === String(round._id) ? application.pendingOutcome : null;
                const slot = application.slots.find((item) => String(item.round) === String(round._id));
                return {
                    applicationId: application._id,
                    applicant: application.applicant,
                    positionTitles: positionTitles(drive, application.positions),
                    outcome: result ? result.outcome : pending?.outcome || null,
                    note: result ? result.note : pending?.note || null,
                    published: Boolean(result),
                    slot: slot ? { startAt: slot.startAt, endAt: slot.endAt } : null
                };
            });
        return {
            _id: round._id,
            name: round.name,
            mode: round.mode,
            timing: round.timing,
            status: round.status,
            startAt: round.startAt,
            endAt: round.endAt,
            slotMinutes: round.slotMinutes,
            venue: round.venue,
            meetingLink: round.meetingLink,
            instructions: round.instructions,
            scheduledAt: round.scheduledAt,
            resultsPublishedAt: round.resultsPublishedAt,
            isCurrent,
            candidates
        };
    });

    const active = applications.filter((application) => drives.ACTIVE_APPLICATION.includes(application.status));
    const phase = drives.phaseOf(drive);
    const roundOpen = last && last.status !== R.RESULTS_PUBLISHED;
    return {
        phase,
        rounds,
        activeCount: active.length,
        canAddRound: drive.status === RECRUITMENT_STATUS.PUBLISHED && ["CLOSED", "ROUNDS"].includes(phase) && !roundOpen && active.length > 0 && drive.rounds.length < MAX_ROUNDS,
        canFinalize: drive.status === RECRUITMENT_STATUS.PUBLISHED && ["CLOSED", "ROUNDS"].includes(phase) && !roundOpen,
        finalists: !roundOpen
            ? active.map((application) => ({
                  applicationId: application._id,
                  applicant: application.applicant,
                  positions: application.positions,
                  positionTitles: positionTitles(drive, application.positions)
              }))
            : []
    };
};

// ---------------------------------------------------------------- Rounds

const createRound = async (actor, driveId, { name, mode }) => {
    const { drive } = await loadRunning(actor, driveId);
    const last = drive.rounds[drive.rounds.length - 1];
    if (last && last.status !== R.RESULTS_PUBLISHED) {
        throw conflict(`Publish the results of "${last.name}" before adding the next round`);
    }
    if (drive.rounds.length >= MAX_ROUNDS) {
        throw conflict(`A drive can have up to ${MAX_ROUNDS} rounds`);
    }
    if (!Object.values(ROUND_MODES).includes(mode)) {
        throw invalid("Choose screening, online interview or offline interview");
    }
    const title = String(name || "").trim().slice(0, 80);
    if (!title) {
        throw invalid("Name the round, e.g. \"Technical interview\"");
    }
    if (!(await RecruitmentApplication.exists({ drive: drive._id, status: { $in: drives.ACTIVE_APPLICATION } }))) {
        throw conflict("There are no candidates left for another round");
    }
    drive.rounds.push({ name: title, mode, status: R.DRAFT });
    await drive.save();
    await audit(AUDIT_ACTIONS.ROUND_CREATED, actor, drive, { round: title, mode });
    return getRounds(actor, drive._id);
};

const readTime = (value, label) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
        throw invalid(`Set the ${label}`);
    }
    return date;
};

/**
 * Sets (or changes) an interview round's time and place and invites every candidate. COMMON: one start and
 * end for everyone; SLOTS: back-to-back slots of `slotMinutes` from `startAt`, in application order.
 */
const scheduleRound = async (actor, driveId, roundId, payload) => {
    const { drive, club } = await loadRunning(actor, driveId);
    const round = currentRound(drive, roundId);
    if (round.mode === ROUND_MODES.SCREENING) {
        throw conflict("Screening rounds have no interview to schedule");
    }
    const timing = payload.timing;
    if (!Object.values(ROUND_TIMING).includes(timing)) {
        throw invalid("Choose one common time or individual slots");
    }
    const startAt = readTime(payload.startAt, "start time");
    if (startAt <= new Date()) {
        throw invalid("The round must start in the future");
    }
    const candidates = await activeCandidates(drive._id);
    if (!candidates.length) {
        throw conflict("There are no candidates in this round");
    }

    let endAt;
    let slotMinutes = null;
    if (timing === ROUND_TIMING.COMMON) {
        endAt = readTime(payload.endAt, "end time");
        if (endAt <= startAt) {
            throw invalid("The round must end after it starts");
        }
    } else {
        slotMinutes = Number(payload.slotMinutes);
        if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
            throw invalid("Each slot must be 5 to 240 minutes long");
        }
        endAt = new Date(startAt.getTime() + candidates.length * slotMinutes * 60000);
    }
    if (endAt - startAt > 3 * 86400000) {
        throw invalid("A round can span up to 3 days. Split long interview days into separate rounds.");
    }

    let venue = null;
    let meetingLink = null;
    if (round.mode === ROUND_MODES.OFFLINE) {
        venue = await Venue.findById(payload.venue);
        if (!venue || venue.status !== VENUE_STATUS.ACTIVE) {
            throw invalid("Choose an available venue");
        }
    } else {
        meetingLink = String(payload.meetingLink || "").trim();
        if (!HTTPS_URL.test(meetingLink)) {
            throw invalid("Add the meeting link (it must start with https://)");
        }
    }

    const wasScheduled = round.status === R.SCHEDULED;
    const apply = async () => {
        if (venue) {
            await assertVenueAvailable({ venueId: venue._id, startAt, endAt, excludeRoundId: round._id });
        }
        Object.assign(round, {
            timing,
            startAt,
            endAt,
            slotMinutes,
            venue: venue?._id || null,
            meetingLink: meetingLink || null,
            instructions: String(payload.instructions || "").trim().slice(0, 1000),
            status: R.SCHEDULED,
            scheduledAt: new Date()
        });
        await drive.save();
    };
    if (venue) {
        await withVenueLock(venue._id, apply);
    } else {
        await apply();
    }

    // Each candidate's own time: the common one, or their slot. Reminders start afresh for the new times.
    await Promise.all(
        candidates.map((application, index) => {
            const slotStart = timing === ROUND_TIMING.COMMON ? startAt : new Date(startAt.getTime() + index * slotMinutes * 60000);
            const slotEnd = timing === ROUND_TIMING.COMMON ? endAt : new Date(slotStart.getTime() + slotMinutes * 60000);
            application.slots = [...application.slots.filter((slot) => String(slot.round) !== String(round._id)), { round: round._id, startAt: slotStart, endAt: slotEnd }];
            application.remindersSent = application.remindersSent.filter((sent) => String(sent.round) !== String(round._id));
            if ([A.APPLIED].includes(application.status)) {
                application.status = A.IN_ROUNDS;
            }
            return application.save();
        })
    );
    await audit(AUDIT_ACTIONS.ROUND_SCHEDULED, actor, drive, { round: round.name, timing, startAt, endAt, rescheduled: wasScheduled });

    const populated = await RecruitmentApplication.find({ _id: { $in: candidates.map((item) => item._id) } }).populate("applicant", "name email");
    for (const application of populated) {
        const slot = application.slots.find((item) => String(item.round) === String(round._id));
        await mailer.sendInterviewInvite(drive, club, round, slot, application.applicant, venue, wasScheduled ? "changed" : "invite");
    }
    return getRounds(actor, drive._id);
};

/** Moves one candidate's slot (individual-slot rounds) and tells them. */
const updateSlot = async (actor, driveId, roundId, applicationId, { startAt: value }) => {
    const { drive, club } = await loadRunning(actor, driveId);
    const round = currentRound(drive, roundId);
    if (round.status !== R.SCHEDULED || round.timing !== ROUND_TIMING.SLOTS) {
        throw conflict("Only scheduled rounds with individual slots have slots to move");
    }
    const startAt = readTime(value, "new time");
    if (startAt <= new Date()) {
        throw invalid("The new time must be in the future");
    }
    const endAt = new Date(startAt.getTime() + round.slotMinutes * 60000);
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id, status: { $in: drives.ACTIVE_APPLICATION } }).populate("applicant", "name email");
    if (!application) {
        throw new AppError("Candidate not found", 404, ERROR_CODES.NOT_FOUND);
    }

    // The round's booking grows to cover a slot moved outside it.
    const roundStart = startAt < round.startAt ? startAt : round.startAt;
    const roundEnd = endAt > round.endAt ? endAt : round.endAt;
    const save = async () => {
        if (round.venue && (roundStart < round.startAt || roundEnd > round.endAt)) {
            await assertVenueAvailable({ venueId: round.venue, startAt: roundStart, endAt: roundEnd, excludeRoundId: round._id });
        }
        round.startAt = roundStart;
        round.endAt = roundEnd;
        await drive.save();
    };
    if (round.venue) {
        await withVenueLock(round.venue, save);
    } else {
        await save();
    }

    application.slots = [...application.slots.filter((slot) => String(slot.round) !== String(round._id)), { round: round._id, startAt, endAt }];
    application.remindersSent = application.remindersSent.filter((sent) => String(sent.round) !== String(round._id));
    await application.save();
    await audit(AUDIT_ACTIONS.INTERVIEW_SLOT_CHANGED, actor, drive, { round: round.name, applicationId, startAt });

    const venue = round.venue ? await Venue.findById(round.venue) : null;
    await mailer.sendInterviewInvite(drive, club, round, { startAt, endAt }, application.applicant, venue, "changed");
    return getRounds(actor, drive._id);
};

/** Draft decisions for the current round; nothing is shown to candidates until the results are published. */
const setOutcomes = async (actor, driveId, roundId, decisions = []) => {
    const { drive } = await loadRunning(actor, driveId);
    const round = currentRound(drive, roundId);
    if (round.mode !== ROUND_MODES.SCREENING && round.status !== R.SCHEDULED) {
        throw conflict("Schedule the interview before recording results");
    }
    const list = Array.isArray(decisions) ? decisions.slice(0, 1000) : [];
    for (const decision of list) {
        const outcome = decision.outcome || null;
        if (outcome !== null && !Object.values(ROUND_OUTCOMES).includes(outcome)) {
            throw invalid("Mark each candidate as qualified or eliminated");
        }
        await RecruitmentApplication.updateOne(
            { _id: decision.applicationId, drive: drive._id, status: { $in: drives.ACTIVE_APPLICATION } },
            { $set: { pendingOutcome: { round: round._id, outcome, note: String(decision.note || "").trim().slice(0, 500) || null } } }
        );
    }
    return getRounds(actor, drive._id);
};

/** Publishes the current round: qualified candidates are congratulated, eliminated ones thanked. */
const publishRoundResults = async (actor, driveId, roundId) => {
    const { drive, club } = await loadRunning(actor, driveId);
    const round = currentRound(drive, roundId);
    if (round.mode !== ROUND_MODES.SCREENING && round.status !== R.SCHEDULED) {
        throw conflict("Schedule the interview before publishing results");
    }
    const candidates = await activeCandidates(drive._id).populate("applicant", "name email");
    const undecided = candidates.filter((application) => String(application.pendingOutcome?.round) !== String(round._id) || !application.pendingOutcome?.outcome);
    if (undecided.length) {
        throw conflict(`Decide every candidate first — ${undecided.length} still ${undecided.length === 1 ? "has" : "have"} no result`);
    }

    const now = new Date();
    for (const application of candidates) {
        const { outcome, note } = application.pendingOutcome;
        application.roundResults.push({ round: round._id, outcome, note, publishedAt: now });
        application.status = outcome === ROUND_OUTCOMES.QUALIFIED ? A.IN_ROUNDS : A.ELIMINATED;
        if (outcome === ROUND_OUTCOMES.ELIMINATED) {
            application.decidedAt = now;
        }
        application.pendingOutcome = { round: null, outcome: null, note: null };
        await application.save();
    }
    round.status = R.RESULTS_PUBLISHED;
    round.resultsPublishedAt = now;
    await drive.save();

    const qualified = candidates.filter((application) => application.status === A.IN_ROUNDS);
    await audit(AUDIT_ACTIONS.ROUND_RESULTS_PUBLISHED, actor, drive, { round: round.name, qualified: qualified.length, eliminated: candidates.length - qualified.length });
    for (const application of candidates) {
        await mailer.sendRoundResult(drive, club, round, application.applicant, application.status === A.IN_ROUNDS);
    }
    return getRounds(actor, drive._id);
};

// ---------------------------------------------------------------- Final selection

/**
 * Ends the drive. Every remaining candidate is either selected (with one of the drive's roles — they become a
 * member with it) or not selected. Everyone gets their result by email.
 */
const finalizeDrive = async (actor, driveId, decisions = []) => {
    const { drive } = await loadRunning(actor, driveId);
    const club = await Club.findById(drive.club);
    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can take in members", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }
    const last = drive.rounds[drive.rounds.length - 1];
    if (last && last.status !== R.RESULTS_PUBLISHED) {
        throw conflict(`Publish the results of "${last.name}" first`);
    }
    const candidates = await activeCandidates(drive._id).populate("applicant", "name email");
    const byId = new Map((Array.isArray(decisions) ? decisions : []).map((decision) => [String(decision.applicationId), decision]));
    const missing = candidates.filter((application) => !byId.has(String(application._id)));
    if (missing.length) {
        throw conflict(`Decide every finalist — ${missing.length} still ${missing.length === 1 ? "has" : "have"} no decision`);
    }
    const roles = new Set(drive.positions.map((position) => position.role));
    for (const application of candidates) {
        const decision = byId.get(String(application._id));
        if (decision.selected && !roles.has(decision.role)) {
            throw invalid(`Choose one of this drive's roles for ${application.applicant?.name || "each selected student"}`);
        }
    }

    const now = new Date();
    const results = [];
    for (const application of candidates) {
        const decision = byId.get(String(application._id));
        const selected = Boolean(decision.selected);
        application.status = selected ? A.SELECTED : A.NOT_SELECTED;
        application.finalRole = selected ? decision.role : null;
        application.decidedAt = now;
        await application.save();
        if (selected) {
            await ClubMembership.findOneAndUpdate(
                { club: club._id, user: application.applicant._id },
                { $set: { status: MEMBERSHIP_STATUS.APPROVED, role: decision.role, joinedAt: now, decidedBy: actor._id, decidedAt: now, decisionReason: null } },
                { upsert: true, setDefaultsOnInsert: true }
            );
        }
        // Prefer the title of a position the student applied for, else the first with that role.
        const position =
            drive.positions.find((item) => item.role === decision.role && application.positions.some((id) => String(id) === String(item._id))) ||
            drive.positions.find((item) => item.role === decision.role);
        results.push({ application, selected, positionTitle: position?.title || null });
    }

    drive.status = RECRUITMENT_STATUS.COMPLETED;
    drive.completedAt = now;
    await drive.save();
    const selectedCount = results.filter((result) => result.selected).length;
    await audit(AUDIT_ACTIONS.RECRUITMENT_COMPLETED, actor, drive, { selected: selectedCount, notSelected: results.length - selectedCount });

    for (const { application, selected, positionTitle } of results) {
        await mailer.sendFinalDecision(drive, club, application.applicant, { selected, positionTitle });
    }
    if (club.mentor) {
        await notify(club.mentor, {
            type: NOTIFICATION_TYPES.RECRUITMENT_UPDATE,
            title: `${club.name} finished recruiting`,
            message: `${selectedCount} new ${selectedCount === 1 ? "member" : "members"} joined through ${drive.title}.`,
            link: `/recruitment/${drive._id}`
        });
    }
    return drives.getDrive(actor, drive._id);
};

module.exports = { getRounds, createRound, scheduleRound, updateSlot, setOutcomes, publishRoundResults, finalizeDrive };
