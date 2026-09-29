const ClubMembership = require("../models/ClubMembership");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const Venue = require("../models/Venue");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { APPLICATION_STATUS, MEMBERSHIP_STATUS, RECRUITMENT_STATUS, ROUND_MODES, ROUND_OUTCOMES, ROUND_STATUS, ROUND_TIMING, VENUE_STATUS, AUDIT_ACTIONS } = require("../constants/Statuses");
const { SYSTEM } = require("../utils/ClubRoles");
const { formatSchedule } = require("../utils/CampusTime");
const { recordAudit } = require("./AuditService");
const { assertVenueAvailable, withVenueLock } = require("./VenueService");
const mailer = require("./RecruitmentMailer");
const drives = require("./RecruitmentService");

// Selection for each role of a published drive, run by the president after applications close. Every role
// has its own rounds — screening, online or offline interviews (a common time or one slot per candidate) —
// with results emailed to every candidate, and its own final selection: offers, a reserve list, and thanks.

const A = APPLICATION_STATUS;
const R = ROUND_STATUS;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);
const HTTPS_URL = /^https:\/\/[^\s/$.?#].[^\s]*$/i;
const MAX_ROUNDS = 8;
const DECISIONS = ["OFFER", "RESERVE", "NOT_SELECTED"];

const activeCandidates = (driveId, positionId) =>
    RecruitmentApplication.find({ drive: driveId, position: positionId, status: { $in: drives.ACTIVE_APPLICATION } }).sort({ createdAt: 1, _id: 1 });

const loadRunning = async (actor, driveId, positionId) => {
    const drive = await drives.loadDrive(driveId);
    const context = await drives.assertManager(actor, drive);
    if (drive.status !== RECRUITMENT_STATUS.PUBLISHED) {
        throw conflict("Selection runs while the drive is published");
    }
    if (["UPCOMING", "OPEN"].includes(drives.phaseOf(drive))) {
        throw conflict("Close applications before starting the selection rounds");
    }
    const position = drives.findPosition(drive, positionId);
    return { drive, position, club: context.club };
};

const currentRound = (position, roundId) => {
    const round = position.rounds.id(roundId);
    if (!round) {
        throw new AppError("Round not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const last = position.rounds[position.rounds.length - 1];
    if (String(last._id) !== String(round._id)) {
        throw conflict("Only the latest round can change");
    }
    if (round.status === R.RESULTS_PUBLISHED) {
        throw conflict("This round's results are published, so it can't change any more");
    }
    if (position.finalizedAt) {
        throw conflict("The final selection for this role is done");
    }
    return round;
};

const audit = (action, actor, drive, position, metadata = {}) =>
    recordAudit({ action, actor: actor._id, targetType: "RecruitmentDrive", targetId: drive._id, metadata: { clubId: drive.club, role: position.role, positionTitle: position.title, ...metadata } });

// ---------------------------------------------------------------- Views

/** The Selection tab for one role: its rounds with candidates, the final selection and the offers. */
const getRounds = async (actor, driveId, positionId) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    await drive.populate("positions.rounds.venue", "name location capacity");
    const position = drives.findPosition(drive, positionId);
    const applications = await RecruitmentApplication.find({ drive: drive._id, position: position._id, status: { $ne: A.WITHDRAWN } })
        .sort({ createdAt: 1, _id: 1 })
        .populate("applicant", "name email departmentCode batchCode");
    const last = position.rounds[position.rounds.length - 1];

    const rounds = position.rounds.map((round) => {
        const isCurrent = last && String(last._id) === String(round._id) && round.status !== R.RESULTS_PUBLISHED && !position.finalizedAt;
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
                    outcome: result ? result.outcome : pending?.outcome || null,
                    note: result ? result.note : pending?.note || null,
                    published: Boolean(result),
                    slot: slot ? { startAt: slot.startAt, endAt: slot.endAt } : null
                };
            });
        return { ...round.toObject(), isCurrent, candidates };
    });

    const active = applications.filter((application) => drives.ACTIVE_APPLICATION.includes(application.status));
    const phase = drives.phaseOf(drive);
    const selectionOpen = drive.status === RECRUITMENT_STATUS.PUBLISHED && ["CLOSED", "ROUNDS"].includes(phase) && !position.finalizedAt;
    const roundOpen = last && last.status !== R.RESULTS_PUBLISHED;
    const offers = applications.filter((application) => [A.OFFERED, A.ACCEPTED, A.DECLINED, A.EXPIRED, A.RESERVE].includes(application.status) && position.finalizedAt);
    const accepted = offers.filter((application) => application.status === A.ACCEPTED).length;
    const pendingOffers = offers.filter((application) => application.status === A.OFFERED).length;
    const openSeats = position.openings ? Math.max(0, position.openings - accepted - pendingOffers) : null;

    return {
        phase,
        position: { _id: position._id, title: position.title, role: position.role, openings: position.openings, finalizedAt: position.finalizedAt, offerDays: position.offerDays, stage: drives.stageOf(drive, position) },
        rounds,
        activeCount: active.length,
        canAddRound: selectionOpen && !roundOpen && active.length > 0 && position.rounds.length < MAX_ROUNDS,
        canFinalize: selectionOpen && !roundOpen,
        finalists: selectionOpen && !roundOpen ? active.map((application) => ({ applicationId: application._id, applicant: application.applicant })) : [],
        offers: offers.map((application) => ({
            applicationId: application._id,
            applicant: application.applicant,
            status: application.status,
            offeredAt: application.offeredAt,
            offerExpiresAt: application.offerExpiresAt,
            respondedAt: application.respondedAt
        })),
        seats: { openings: position.openings, accepted, pending: pendingOffers, open: openSeats },
        canOfferReserve: Boolean(position.finalizedAt) && drive.status === RECRUITMENT_STATUS.PUBLISHED && (openSeats === null || openSeats > 0) && offers.some((application) => application.status === A.RESERVE)
    };
};

// ---------------------------------------------------------------- Rounds

const createRound = async (actor, driveId, positionId, { name, mode }) => {
    const { drive, position } = await loadRunning(actor, driveId, positionId);
    if (position.finalizedAt) {
        throw conflict("The final selection for this role is done");
    }
    const last = position.rounds[position.rounds.length - 1];
    if (last && last.status !== R.RESULTS_PUBLISHED) {
        throw conflict(`Publish the results of "${last.name}" before adding the next round`);
    }
    if (position.rounds.length >= MAX_ROUNDS) {
        throw conflict(`A role can have up to ${MAX_ROUNDS} rounds`);
    }
    if (!Object.values(ROUND_MODES).includes(mode)) {
        throw invalid("Choose screening, online interview or offline interview");
    }
    const title = String(name || "").trim().slice(0, 80);
    if (!title) {
        throw invalid('Name the round, e.g. "Technical interview"');
    }
    if (!(await RecruitmentApplication.exists({ drive: drive._id, position: position._id, status: { $in: drives.ACTIVE_APPLICATION } }))) {
        throw conflict("There are no candidates left for another round");
    }
    position.rounds.push({ name: title, mode, status: R.DRAFT });
    await drive.save();
    await audit(AUDIT_ACTIONS.ROUND_CREATED, actor, drive, position, { round: title, mode });
    return getRounds(actor, drive._id, position._id);
};

const readTime = (value, label) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
        throw invalid(`Set the ${label}`);
    }
    return date;
};

const overlaps = (a, b) => a.startAt < b.endAt && b.startAt < a.endAt;

// A candidate's interview times in the drive's other roles (they can apply to several).
const otherSlots = async (drive, position, candidates) => {
    const others = await RecruitmentApplication.find({
        drive: drive._id,
        applicant: { $in: candidates.map((candidate) => candidate.applicant) },
        position: { $ne: position._id },
        status: { $in: drives.ACTIVE_APPLICATION }
    }).select("applicant slots position");
    const byApplicant = new Map();
    others.forEach((other) => {
        const key = String(other.applicant);
        byApplicant.set(key, [...(byApplicant.get(key) || []), ...other.slots.map((slot) => ({ startAt: slot.startAt, endAt: slot.endAt, role: drive.positions.id(other.position)?.title }))]);
    });
    return byApplicant;
};

/**
 * Sets (or changes) an interview round's time and place and invites every candidate. COMMON: one start and
 * end for everyone; SLOTS: back-to-back slots of `slotMinutes`. Candidates also interviewing for another role
 * are placed in slots that don't clash with it; anyone who still clashes is listed in `warnings`.
 */
const scheduleRound = async (actor, driveId, positionId, roundId, payload) => {
    const { drive, position, club } = await loadRunning(actor, driveId, positionId);
    const round = currentRound(position, roundId);
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
    const candidates = await activeCandidates(drive._id, position._id);
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

    // Who gets which time: slot by slot, the first waiting candidate free at that time.
    const busy = await otherSlots(drive, position, candidates);
    const clashesFor = (candidate, slot) => (busy.get(String(candidate.applicant)) || []).filter((other) => overlaps(slot, other));
    const assignments = [];
    const warnings = [];
    if (timing === ROUND_TIMING.COMMON) {
        candidates.forEach((candidate) => {
            const slot = { startAt, endAt };
            assignments.push({ candidate, slot });
            const clash = clashesFor(candidate, slot)[0];
            if (clash) warnings.push({ applicationId: candidate._id, clashWith: clash.role, at: formatSchedule(clash.startAt, clash.endAt) });
        });
    } else {
        const waiting = [...candidates];
        for (let index = 0; index < candidates.length; index += 1) {
            const slot = { startAt: new Date(startAt.getTime() + index * slotMinutes * 60000), endAt: new Date(startAt.getTime() + (index + 1) * slotMinutes * 60000) };
            let pick = waiting.findIndex((candidate) => !clashesFor(candidate, slot).length);
            if (pick === -1) {
                pick = 0;
                const clash = clashesFor(waiting[0], slot)[0];
                warnings.push({ applicationId: waiting[0]._id, clashWith: clash.role, at: formatSchedule(clash.startAt, clash.endAt) });
            }
            assignments.push({ candidate: waiting[pick], slot });
            waiting.splice(pick, 1);
        }
    }

    const wasScheduled = round.status === R.SCHEDULED;
    const save = async () => {
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
        await withVenueLock(venue._id, save);
    } else {
        await save();
    }

    // Each candidate's own time. Reminders start afresh for the new times.
    await Promise.all(
        assignments.map(({ candidate, slot }) => {
            candidate.slots = [...candidate.slots.filter((item) => String(item.round) !== String(round._id)), { round: round._id, ...slot }];
            candidate.remindersSent = candidate.remindersSent.filter((sent) => String(sent.round) !== String(round._id));
            if (candidate.status === A.APPLIED) {
                candidate.status = A.IN_ROUNDS;
            }
            return candidate.save();
        })
    );
    await audit(AUDIT_ACTIONS.ROUND_SCHEDULED, actor, drive, position, { round: round.name, timing, startAt, endAt, rescheduled: wasScheduled });

    const populated = await RecruitmentApplication.find({ _id: { $in: candidates.map((item) => item._id) } }).populate("applicant", "name email");
    for (const application of populated) {
        const slot = application.slots.find((item) => String(item.round) === String(round._id));
        await mailer.sendInterviewInvite(drive, club, position, round, slot, application.applicant, venue, wasScheduled ? "changed" : "invite");
    }
    return { ...(await getRounds(actor, drive._id, position._id)), warnings };
};

/** Moves one candidate's slot (individual-slot rounds) and tells them. */
const updateSlot = async (actor, driveId, positionId, roundId, applicationId, { startAt: value }) => {
    const { drive, position, club } = await loadRunning(actor, driveId, positionId);
    const round = currentRound(position, roundId);
    if (round.status !== R.SCHEDULED || round.timing !== ROUND_TIMING.SLOTS) {
        throw conflict("Only scheduled rounds with individual slots have slots to move");
    }
    const startAt = readTime(value, "new time");
    if (startAt <= new Date()) {
        throw invalid("The new time must be in the future");
    }
    const endAt = new Date(startAt.getTime() + round.slotMinutes * 60000);
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id, position: position._id, status: { $in: drives.ACTIVE_APPLICATION } }).populate(
        "applicant",
        "name email"
    );
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
    await audit(AUDIT_ACTIONS.INTERVIEW_SLOT_CHANGED, actor, drive, position, { round: round.name, applicationId, startAt });

    const clash = ((await otherSlots(drive, position, [application])).get(String(application.applicant._id)) || []).find((other) => overlaps({ startAt, endAt }, other));
    const venue = round.venue ? await Venue.findById(round.venue) : null;
    await mailer.sendInterviewInvite(drive, club, position, round, { startAt, endAt }, application.applicant, venue, "changed");
    return {
        ...(await getRounds(actor, drive._id, position._id)),
        warnings: clash ? [{ applicationId: application._id, clashWith: clash.role, at: formatSchedule(clash.startAt, clash.endAt) }] : []
    };
};

/** Draft decisions for the current round; nothing is shown to candidates until the results are published. */
const setOutcomes = async (actor, driveId, positionId, roundId, decisions = []) => {
    const { drive, position } = await loadRunning(actor, driveId, positionId);
    const round = currentRound(position, roundId);
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
            { _id: decision.applicationId, drive: drive._id, position: position._id, status: { $in: drives.ACTIVE_APPLICATION } },
            { $set: { pendingOutcome: { round: round._id, outcome, note: String(decision.note || "").trim().slice(0, 500) || null } } }
        );
    }
    return getRounds(actor, drive._id, position._id);
};

/** Publishes the current round: qualified candidates are congratulated, eliminated ones thanked. */
const publishRoundResults = async (actor, driveId, positionId, roundId) => {
    const { drive, position, club } = await loadRunning(actor, driveId, positionId);
    const round = currentRound(position, roundId);
    if (round.mode !== ROUND_MODES.SCREENING && round.status !== R.SCHEDULED) {
        throw conflict("Schedule the interview before publishing results");
    }
    const candidates = await activeCandidates(drive._id, position._id).populate("applicant", "name email");
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
    await audit(AUDIT_ACTIONS.ROUND_RESULTS_PUBLISHED, actor, drive, position, { round: round.name, qualified: qualified.length, eliminated: candidates.length - qualified.length });
    for (const application of candidates) {
        await mailer.sendRoundResult(drive, club, position, round, application.applicant, application.status === A.IN_ROUNDS);
    }
    return getRounds(actor, drive._id, position._id);
};

// ---------------------------------------------------------------- Final selection and offers

const makeOffer = async (drive, club, position, application, now) => {
    application.status = A.OFFERED;
    application.offeredAt = now;
    application.offerExpiresAt = new Date(now.getTime() + position.offerDays * 86400000);
    application.decidedAt = now;
    await application.save();
    await mailer.sendOffer(drive, club, position, application.applicant, application.offerExpiresAt);
};

/**
 * Final selection for one role. Each remaining candidate gets an OFFER (they accept or decline by the
 * deadline), goes on the RESERVE list (offered a seat that frees up), or is NOT_SELECTED.
 */
const finalizePosition = async (actor, driveId, positionId, { decisions = [], offerDays } = {}) => {
    const { drive, position, club } = await loadRunning(actor, driveId, positionId);
    if (position.finalizedAt) {
        throw conflict("The final selection for this role is done");
    }
    const last = position.rounds[position.rounds.length - 1];
    if (last && last.status !== R.RESULTS_PUBLISHED) {
        throw conflict(`Publish the results of "${last.name}" first`);
    }
    if (offerDays !== undefined) {
        const days = Number(offerDays);
        if (!Number.isInteger(days) || days < 1 || days > 14) {
            throw invalid("Give students 1 to 14 days to answer an offer");
        }
        position.offerDays = days;
    }
    const candidates = await activeCandidates(drive._id, position._id).populate("applicant", "name email");
    const byId = new Map((Array.isArray(decisions) ? decisions : []).map((decision) => [String(decision.applicationId), decision.decision]));
    const missing = candidates.filter((application) => !DECISIONS.includes(byId.get(String(application._id))));
    if (missing.length) {
        throw conflict(`Decide every finalist — ${missing.length} still ${missing.length === 1 ? "has" : "have"} no decision`);
    }
    const offers = candidates.filter((application) => byId.get(String(application._id)) === "OFFER");
    if (position.openings && offers.length > position.openings) {
        throw invalid(`${position.title} has ${position.openings} ${position.openings === 1 ? "opening" : "openings"} — make at most that many offers and put the rest on the reserve list`);
    }
    if (position.role === SYSTEM.VICE_PRESIDENT && offers.length && (await ClubMembership.exists({ club: club._id, role: SYSTEM.VICE_PRESIDENT, status: MEMBERSHIP_STATUS.APPROVED }))) {
        throw conflict("Your club already has a vice-president");
    }

    const now = new Date();
    for (const application of candidates) {
        const decision = byId.get(String(application._id));
        if (decision === "OFFER") {
            await makeOffer(drive, club, position, application, now);
        } else if (decision === "RESERVE") {
            application.status = A.RESERVE;
            application.decidedAt = now;
            await application.save();
            await mailer.sendReserve(drive, club, position, application.applicant);
        } else {
            application.status = A.NOT_SELECTED;
            application.decidedAt = now;
            await application.save();
            await mailer.sendNotSelected(drive, club, application.applicant, position.title);
        }
    }
    position.finalizedAt = now;
    await drive.save();
    await audit(AUDIT_ACTIONS.POSITION_FINALIZED, actor, drive, position, { offers: offers.length, reserve: candidates.filter((item) => byId.get(String(item._id)) === "RESERVE").length });
    await drives.completeIfDone(drive._id);
    return getRounds(actor, drive._id, position._id);
};

/** Offers a freed seat (declined or expired offer) to a candidate on the reserve list. */
const offerToReserve = async (actor, driveId, positionId, applicationId) => {
    const drive = await drives.loadDrive(driveId);
    const { club } = await drives.assertManager(actor, drive);
    const position = drives.findPosition(drive, positionId);
    if (drive.status !== RECRUITMENT_STATUS.PUBLISHED || !position.finalizedAt) {
        throw conflict("Offers to the reserve list come after the final selection");
    }
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id, position: position._id, status: A.RESERVE }).populate("applicant", "name email");
    if (!application) {
        throw conflict("This candidate isn't on the reserve list any more");
    }
    if (position.openings) {
        const taken = await RecruitmentApplication.countDocuments({ drive: drive._id, position: position._id, status: { $in: [A.ACCEPTED, A.OFFERED] } });
        if (taken >= position.openings) {
            throw conflict(`All ${position.openings} ${position.title} seats are taken or offered`);
        }
    }
    await makeOffer(drive, club, position, application, new Date());
    await audit(AUDIT_ACTIONS.OFFER_MADE, actor, drive, position, { applicationId, fromReserve: true });
    return getRounds(actor, drive._id, position._id);
};

/** President: end recruitment now. Anyone still waiting (rounds, reserve, unanswered offers) is thanked. */
const closeRecruitment = async (actor, driveId) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertManager(actor, drive);
    if (drive.status !== RECRUITMENT_STATUS.PUBLISHED || ["UPCOMING", "OPEN"].includes(drives.phaseOf(drive))) {
        throw conflict("Recruitment can be completed once applications have closed");
    }
    await drives.completeIfDone(drive._id, { force: true, actor });
    return drives.getDrive(actor, drive._id);
};

module.exports = { getRounds, createRound, scheduleRound, updateSlot, setOutcomes, publishRoundResults, finalizePosition, offerToReserve, closeRecruitment };
