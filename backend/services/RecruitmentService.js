const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_ROLES } = require("../constants/Roles");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const {
    CLUB_STATUS,
    MEMBERSHIP_STATUS,
    RECRUITMENT_STATUS,
    APPLICATION_STATUS,
    QUESTION_TYPES,
    NOTIFICATION_TYPES,
    AUDIT_ACTIONS
} = require("../constants/Statuses");
const { getClubContext, contextHas, isStudent } = require("./AuthorizationService");
const { clubUsersWithPermission } = require("./MembershipService");
const { belongsToScope, describeScope } = require("../utils/DepartmentScope");
const { formatDate, formatTime } = require("../utils/CampusTime");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const mailer = require("./RecruitmentMailer");

// Recruitment drives: the only way to join a club. The president builds the drive (positions + a custom
// application form), the faculty mentor approves it, the president publishes it, eligible students apply,
// and after applications close the president runs selection rounds (RecruitmentRoundService).

const S = RECRUITMENT_STATUS;
const MANAGE = CLUB_PERMISSIONS.MANAGE_RECRUITMENT;
const EDITABLE = [S.DRAFT, S.NEEDS_CHANGES];
// A club runs one drive at a time.
const ACTIVE = [S.DRAFT, S.PENDING_APPROVAL, S.NEEDS_CHANGES, S.APPROVED, S.PUBLISHED];
const ACTIVE_APPLICATION = [APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.IN_ROUNDS];
const MAX_POSITIONS = 10;
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 12;
const MAX_WINDOW_DAYS = 60;
const CHOICE_TYPES = [QUESTION_TYPES.SINGLE_CHOICE, QUESTION_TYPES.MULTI_CHOICE];

const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);
const forbidden = (message) => new AppError(message, 403, ERROR_CODES.FORBIDDEN);
const roleLabel = (role) => String(role).replace(/_/g, " ").toLowerCase();
const drivePath = (drive) => `/recruitment/${drive._id}`;

const loadDrive = async (driveId) => {
    const drive = await RecruitmentDrive.findById(driveId);
    if (!drive) {
        throw new AppError("Recruitment drive not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return drive;
};

/** The viewer's standing with the drive's club: president (manage), mentor (review / read). */
const driveContext = async (actor, drive) => {
    const context = await getClubContext(actor, drive.club);
    return { ...context, canManage: contextHas(context, MANAGE), isMentor: context.isMentor };
};

const assertManager = async (actor, drive) => {
    const context = await driveContext(actor, drive);
    if (!context.canManage) {
        throw forbidden("Only the club president can manage recruitment");
    }
    return context;
};

const assertStaff = async (actor, drive) => {
    const context = await driveContext(actor, drive);
    if (!context.canManage && !context.isMentor) {
        throw forbidden("Only the club president and faculty mentor can see applications");
    }
    return context;
};

/**
 * Where a published drive stands: UPCOMING (applications not open yet), OPEN, CLOSED (deadline passed or
 * closed early, no rounds yet) or ROUNDS. Other statuses map to themselves.
 */
const phaseOf = (drive, now = new Date()) => {
    if (drive.status !== S.PUBLISHED) {
        return drive.status;
    }
    if (now < new Date(drive.applicationStart)) {
        return "UPCOMING";
    }
    if (!drive.closedAt && now < new Date(drive.applicationEnd)) {
        return "OPEN";
    }
    return drive.rounds.length ? "ROUNDS" : "CLOSED";
};

const applicationsOpen = (drive, now = new Date()) => phaseOf(drive, now) === "OPEN";

// ---------------------------------------------------------------- Validation

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

const normalizePositions = (positions) => {
    if (!Array.isArray(positions) || !positions.length) {
        throw invalid("Add at least one position you're recruiting for");
    }
    if (positions.length > MAX_POSITIONS) {
        throw invalid(`Up to ${MAX_POSITIONS} positions per drive`);
    }
    const allowed = Object.values(CLUB_ROLES).filter((role) => role !== CLUB_ROLES.PRESIDENT);
    const titles = new Set();
    return positions.map((position) => {
        const role = String(position?.role || "");
        if (!allowed.includes(role)) {
            throw invalid("Each position needs a club role (the president is appointed by the faculty mentor)");
        }
        const title = cleanText(position.title, 60) || roleLabel(role).replace(/\b\w/g, (letter) => letter.toUpperCase());
        if (titles.has(title.toLowerCase())) {
            throw invalid(`"${title}" is listed twice`);
        }
        titles.add(title.toLowerCase());
        const openings = position.openings === null || position.openings === undefined || position.openings === "" ? null : Number(position.openings);
        if (openings !== null && (!Number.isInteger(openings) || openings < 1 || openings > 500)) {
            throw invalid(`Openings for "${title}" must be a whole number from 1`);
        }
        return { ...(position._id ? { _id: position._id } : {}), role, title, openings, description: cleanText(position.description, 400) };
    });
};

const normalizeQuestions = (questions = []) => {
    if (!Array.isArray(questions)) {
        throw invalid("Invalid form questions");
    }
    if (questions.length > MAX_QUESTIONS) {
        throw invalid(`Up to ${MAX_QUESTIONS} questions per form`);
    }
    return questions.map((question, index) => {
        const type = String(question?.type || "");
        if (!Object.values(QUESTION_TYPES).includes(type)) {
            throw invalid(`Question ${index + 1} has an unknown type`);
        }
        const label = cleanText(question.label, 200);
        if (!label) {
            throw invalid(`Question ${index + 1} needs a question text`);
        }
        let options = [];
        if (CHOICE_TYPES.includes(type)) {
            options = [...new Set((question.options || []).map((option) => cleanText(option, 100)).filter(Boolean))];
            if (options.length < 2 || options.length > MAX_OPTIONS) {
                throw invalid(`"${label}" needs between 2 and ${MAX_OPTIONS} different options`);
            }
        }
        return { ...(question._id ? { _id: question._id } : {}), type, label, help: cleanText(question.help, 300), required: Boolean(question.required), options };
    });
};

const normalizeWindow = ({ applicationStart, applicationEnd }, now = new Date()) => {
    const start = applicationStart ? new Date(applicationStart) : now;
    const end = new Date(applicationEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw invalid("Set when applications open and close");
    }
    if (end <= start) {
        throw invalid("Applications must close after they open");
    }
    if (end <= now) {
        throw invalid("The application deadline must be in the future");
    }
    if (end - start > MAX_WINDOW_DAYS * 86400000) {
        throw invalid(`Applications can stay open for up to ${MAX_WINDOW_DAYS} days`);
    }
    return { applicationStart: start, applicationEnd: end };
};

const normalizeBatches = (batches = []) => {
    const list = [...new Set((Array.isArray(batches) ? batches : []).map((batch) => String(batch).trim()))];
    if (list.some((batch) => !/^\d{2}$/.test(batch))) {
        throw invalid("Batches are two-digit years, e.g. 24");
    }
    return list;
};

const normalizeDrive = (payload) => {
    const title = cleanText(payload.title, 120);
    const description = cleanText(payload.description, 4000);
    if (!title) {
        throw invalid("Give the drive a title");
    }
    if (!description) {
        throw invalid("Describe what the club is looking for");
    }
    return {
        title,
        description,
        positions: normalizePositions(payload.positions),
        questions: normalizeQuestions(payload.questions),
        eligibility: { batches: normalizeBatches(payload.eligibility?.batches) },
        ...normalizeWindow(payload)
    };
};

// ---------------------------------------------------------------- Views

const applicationCounts = async (driveId) => {
    const rows = await RecruitmentApplication.aggregate([{ $match: { drive: driveId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]);
    const by = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const total = rows.reduce((sum, row) => sum + row.count, 0) - (by[APPLICATION_STATUS.WITHDRAWN] || 0);
    return { total, active: (by.APPLIED || 0) + (by.IN_ROUNDS || 0), selected: by.SELECTED || 0, eliminated: by.ELIMINATED || 0, notSelected: by.NOT_SELECTED || 0, withdrawn: by.WITHDRAWN || 0 };
};

/** Why this student can't apply right now, or null. */
const applyProblem = async (actor, drive, club, now = new Date()) => {
    if (!actor) {
        return "Sign in to apply";
    }
    if (!isStudent(actor)) {
        return "Only students can apply";
    }
    if (drive.status !== S.PUBLISHED) {
        return "This drive isn't accepting applications";
    }
    if (await ClubMembership.exists({ club: club._id, user: actor._id, status: MEMBERSHIP_STATUS.APPROVED })) {
        return `You're already a member of ${club.name}`;
    }
    if (!belongsToScope(actor, club)) {
        return `${club.name} recruits students from ${describeScope(club)}`;
    }
    if (drive.eligibility?.batches?.length && !drive.eligibility.batches.includes(actor.batchCode)) {
        return `Open to batch ${drive.eligibility.batches.map((batch) => `20${batch}`).join(", ")}`;
    }
    const phase = phaseOf(drive, now);
    if (phase === "UPCOMING") {
        return `Applications open ${formatDate(drive.applicationStart)} at ${formatTime(drive.applicationStart)}`;
    }
    if (phase !== "OPEN") {
        return "Applications are closed";
    }
    return null;
};

const publicRound = (round) => ({
    _id: round._id,
    name: round.name,
    mode: round.mode,
    timing: round.timing,
    status: round.status,
    resultsPublishedAt: round.resultsPublishedAt
});

const staffRound = (round) => ({
    ...publicRound(round),
    startAt: round.startAt,
    endAt: round.endAt,
    slotMinutes: round.slotMinutes,
    venue: round.venue,
    meetingLink: round.meetingLink,
    instructions: round.instructions,
    scheduledAt: round.scheduledAt
});

const clubSummary = (club) => ({
    _id: club._id,
    name: club.name,
    logo: club.logo,
    coverImage: club.coverImage,
    category: club.category,
    allDepartments: club.allDepartments,
    departmentCodes: club.departmentCodes
});

const serializeDrive = (drive, club, extra = {}) => ({
    _id: drive._id,
    club: clubSummary(club),
    title: drive.title,
    description: drive.description,
    positions: drive.positions,
    questions: drive.questions,
    eligibility: drive.eligibility,
    applicationStart: drive.applicationStart,
    applicationEnd: drive.applicationEnd,
    closedAt: drive.closedAt,
    status: drive.status,
    phase: phaseOf(drive),
    publishedAt: drive.publishedAt,
    completedAt: drive.completedAt,
    cancelledAt: drive.cancelledAt,
    cancellationReason: drive.cancellationReason,
    createdAt: drive.createdAt,
    ...extra
});

/** The drive page: what a visitor, an applicant, the president or the mentor may see. */
const getDrive = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    await drive.populate("rounds.venue", "name location");
    const club = await Club.findById(drive.club);
    const context = actor ? await driveContext(actor, drive) : { canManage: false, isMentor: false };
    const staff = context.canManage || context.isMentor;
    const isPublic = [S.PUBLISHED, S.COMPLETED].includes(drive.status) || (drive.status === S.CANCELLED && drive.publishedAt);

    if (!isPublic && !staff) {
        throw new AppError("Recruitment drive not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const [counts, mine, problem] = await Promise.all([
        staff ? applicationCounts(drive._id) : null,
        actor ? RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id }).select("status createdAt") : null,
        applyProblem(actor, drive, club)
    ]);

    return serializeDrive(drive, club, {
        rounds: drive.rounds.map(staff ? staffRound : publicRound),
        ...(staff ? { counts, submittedAt: drive.submittedAt, reviewComment: drive.reviewComment, reviewedAt: drive.reviewedAt } : {}),
        viewer: {
            canManage: context.canManage,
            isMentor: context.isMentor,
            canReview: context.isMentor && drive.status === S.PENDING_APPROVAL,
            canEdit: context.canManage && EDITABLE.includes(drive.status),
            canApply: !mine || mine.status === APPLICATION_STATUS.WITHDRAWN ? !problem : false,
            applyProblem: problem,
            application: mine && mine.status !== APPLICATION_STATUS.WITHDRAWN ? { _id: mine._id, status: mine.status, createdAt: mine.createdAt } : null
        }
    });
};

/** Drives of one club: the public see published ones; the president and mentor see all of them. */
const listClubDrives = async (actor, clubId) => {
    const club = await Club.findById(clubId);
    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const context = actor ? await getClubContext(actor, club) : null;
    const staff = context && (contextHas(context, MANAGE) || context.isMentor);
    const filter = { club: club._id, ...(staff ? {} : { $or: [{ status: { $in: [S.PUBLISHED, S.COMPLETED] } }, { status: S.CANCELLED, publishedAt: { $ne: null } }] }) };
    const drives = await RecruitmentDrive.find(filter).sort({ createdAt: -1 }).limit(30);
    const counts = staff ? await Promise.all(drives.map((drive) => applicationCounts(drive._id))) : [];
    return {
        canCreate: Boolean(context && contextHas(context, MANAGE) && club.status === CLUB_STATUS.ACTIVE && !drives.some((drive) => ACTIVE.includes(drive.status))),
        items: drives.map((drive, index) => ({
            _id: drive._id,
            title: drive.title,
            status: drive.status,
            phase: phaseOf(drive),
            positions: drive.positions.map((position) => position.title),
            applicationStart: drive.applicationStart,
            applicationEnd: drive.applicationEnd,
            rounds: drive.rounds.length,
            completedAt: drive.completedAt,
            ...(staff ? { counts: counts[index] } : {})
        }))
    };
};

/** Recruitment open across campus right now (published and not finished), newest deadline first. */
const listOpenDrives = async (actor) => {
    const now = new Date();
    const drives = await RecruitmentDrive.find({ status: S.PUBLISHED, closedAt: null, applicationEnd: { $gt: now } })
        .sort({ applicationEnd: 1 })
        .limit(50)
        .populate("club", "name logo category allDepartments departmentCodes coverImage");
    return Promise.all(
        drives.map(async (drive) => {
            const problem = actor ? await applyProblem(actor, drive, drive.club, now) : null;
            return {
                _id: drive._id,
                title: drive.title,
                club: clubSummary(drive.club),
                positions: drive.positions.map((position) => position.title),
                applicationStart: drive.applicationStart,
                applicationEnd: drive.applicationEnd,
                phase: phaseOf(drive, now),
                eligible: actor ? !problem || /^Applications open/.test(problem) : null
            };
        })
    );
};

/** For each club id, its drive currently taking applications (for "Recruiting" badges and the club page). */
const openDrivesByClub = async (clubIds) => {
    const now = new Date();
    const drives = await RecruitmentDrive.find({ club: { $in: clubIds }, status: S.PUBLISHED, closedAt: null, applicationEnd: { $gt: now } }).select(
        "club title applicationStart applicationEnd"
    );
    return new Map(drives.map((drive) => [String(drive.club), { _id: drive._id, title: drive.title, applicationStart: drive.applicationStart, applicationEnd: drive.applicationEnd, open: drive.applicationStart <= now }]));
};

/** Drives waiting for this faculty member's review. */
const listDrivesToReview = async (actor) => {
    const clubs = await Club.find({ mentor: actor._id }).select("_id name logo");
    const drives = await RecruitmentDrive.find({ club: { $in: clubs.map((club) => club._id) }, status: S.PENDING_APPROVAL }).sort({ submittedAt: 1 });
    return drives.map((drive) => ({
        _id: drive._id,
        title: drive.title,
        club: clubs.find((club) => String(club._id) === String(drive.club)),
        positions: drive.positions.map((position) => position.title),
        questions: drive.questions.length,
        applicationEnd: drive.applicationEnd,
        submittedAt: drive.submittedAt
    }));
};

// ---------------------------------------------------------------- Lifecycle

const audit = (action, actor, drive, { metadata = {}, ...fields } = {}) =>
    recordAudit({ action, actor: actor._id, targetType: "RecruitmentDrive", targetId: drive._id, ...fields, metadata: { clubId: drive.club, ...metadata } });

const createDrive = async (actor, clubId, payload) => {
    const context = await getClubContext(actor, clubId);
    if (!contextHas(context, MANAGE)) {
        throw forbidden("Only the club president can start a recruitment drive");
    }
    if (context.club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can recruit", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }
    if (await RecruitmentDrive.exists({ club: context.club._id, status: { $in: ACTIVE } })) {
        throw conflict("This club already has a recruitment drive in progress. Finish or cancel it first.");
    }
    const drive = await RecruitmentDrive.create({ ...normalizeDrive(payload), club: context.club._id, createdBy: actor._id });
    await audit(AUDIT_ACTIONS.RECRUITMENT_CREATED, actor, drive, { toState: S.DRAFT });
    return getDrive(actor, drive._id);
};

const updateDrive = async (actor, driveId, payload) => {
    const drive = await loadDrive(driveId);
    await assertManager(actor, drive);
    if (!EDITABLE.includes(drive.status)) {
        throw conflict("A drive can only be edited while it's a draft or has changes requested");
    }
    Object.assign(drive, normalizeDrive({ ...drive.toObject(), ...payload }));
    await drive.save();
    await audit(AUDIT_ACTIONS.RECRUITMENT_UPDATED, actor, drive);
    return getDrive(actor, drive._id);
};

const deleteDraft = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    await assertManager(actor, drive);
    if (drive.status !== S.DRAFT) {
        throw conflict("Only drafts can be deleted. Cancel the drive instead.");
    }
    await drive.deleteOne();
};

const submitDrive = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    const { club } = await assertManager(actor, drive);
    if (!EDITABLE.includes(drive.status)) {
        throw conflict("Only drafts can be sent for approval");
    }
    if (!club.mentor) {
        throw conflict("Your club needs a faculty mentor to approve recruitment");
    }
    normalizeWindow(drive);
    const from = drive.status;
    drive.status = S.PENDING_APPROVAL;
    drive.submittedAt = new Date();
    await drive.save();
    await audit(AUDIT_ACTIONS.RECRUITMENT_SUBMITTED, actor, drive, { fromState: from, toState: drive.status });
    await notify(club.mentor, {
        type: NOTIFICATION_TYPES.RECRUITMENT_REVIEW,
        title: `Recruitment to review: ${drive.title}`,
        message: `${club.name} wants to recruit ${drive.positions.map((position) => position.title).join(", ")}. Review the form before it's published.`,
        link: drivePath(drive),
        email: true
    });
    return getDrive(actor, drive._id);
};

const loadForReview = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    const context = await driveContext(actor, drive);
    if (!context.isMentor) {
        throw forbidden("Only the club's faculty mentor can review recruitment");
    }
    if (drive.status !== S.PENDING_APPROVAL) {
        throw conflict("This drive isn't waiting for review");
    }
    return { drive, club: context.club };
};

const review = async (actor, driveId, { status, comment, action, title, message, required }) => {
    const { drive, club } = await loadForReview(actor, driveId);
    const note = cleanText(comment, 2000);
    if (required && note.length < 5) {
        throw invalid("Explain what needs to change (at least 5 characters)");
    }
    drive.status = status;
    drive.reviewedBy = actor._id;
    drive.reviewedAt = new Date();
    drive.reviewComment = note || null;
    await drive.save();
    await audit(action, actor, drive, { fromState: S.PENDING_APPROVAL, toState: status, reason: note || null });
    await notify(await clubUsersWithPermission(club._id, MANAGE), {
        type: NOTIFICATION_TYPES.RECRUITMENT_UPDATE,
        title: title(drive),
        message: message(note),
        link: drivePath(drive),
        email: true
    });
    return getDrive(actor, drive._id);
};

const approveDrive = (actor, driveId, comment) =>
    review(actor, driveId, {
        status: S.APPROVED,
        comment,
        action: AUDIT_ACTIONS.RECRUITMENT_APPROVED,
        title: (drive) => `Recruitment approved: ${drive.title}`,
        message: (note) => `Your faculty mentor approved it${note ? `: "${note}"` : ""}. Publish it to open applications.`
    });

const requestDriveChanges = (actor, driveId, comment) =>
    review(actor, driveId, {
        status: S.NEEDS_CHANGES,
        comment,
        required: true,
        action: AUDIT_ACTIONS.RECRUITMENT_CHANGES_REQUESTED,
        title: (drive) => `Changes requested: ${drive.title}`,
        message: (note) => note
    });

const rejectDrive = (actor, driveId, comment) =>
    review(actor, driveId, {
        status: S.REJECTED,
        comment,
        required: true,
        action: AUDIT_ACTIONS.RECRUITMENT_REJECTED,
        title: (drive) => `Recruitment not approved: ${drive.title}`,
        message: (note) => note
    });

const publishDrive = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    const { club } = await assertManager(actor, drive);
    if (drive.status !== S.APPROVED) {
        throw conflict("Only drives approved by the faculty mentor can be published");
    }
    if (club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Only active clubs can recruit", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }
    if (new Date(drive.applicationEnd) <= new Date()) {
        throw conflict("The application deadline has passed. Edit the dates and send it for approval again.");
    }
    drive.status = S.PUBLISHED;
    drive.publishedAt = new Date();
    await drive.save();
    await audit(AUDIT_ACTIONS.RECRUITMENT_PUBLISHED, actor, drive, { fromState: S.APPROVED, toState: S.PUBLISHED });
    await mailer.sendRecruitmentLaunch(drive, club, actor);
    return getDrive(actor, drive._id);
};

/** President: move the deadline later (also reopens applications closed early), until rounds begin. */
const extendDeadline = async (actor, driveId, applicationEnd) => {
    const drive = await loadDrive(driveId);
    await assertManager(actor, drive);
    if (drive.status !== S.PUBLISHED || drive.rounds.length) {
        throw conflict("The deadline can only change before selection rounds begin");
    }
    const end = new Date(applicationEnd);
    if (Number.isNaN(end.getTime()) || end <= new Date()) {
        throw invalid("The new deadline must be in the future");
    }
    if (end - new Date(drive.applicationStart) > MAX_WINDOW_DAYS * 86400000) {
        throw invalid(`Applications can stay open for up to ${MAX_WINDOW_DAYS} days`);
    }
    drive.applicationEnd = end;
    drive.closedAt = null;
    await drive.save();
    await audit(AUDIT_ACTIONS.RECRUITMENT_EXTENDED, actor, drive, { metadata: { applicationEnd: end } });
    return getDrive(actor, drive._id);
};

/** President: stop taking applications before the deadline. */
const closeApplications = async (actor, driveId) => {
    const drive = await loadDrive(driveId);
    await assertManager(actor, drive);
    if (!applicationsOpen(drive) && phaseOf(drive) !== "UPCOMING") {
        throw conflict("Applications are already closed");
    }
    drive.closedAt = new Date();
    await drive.save();
    await audit(AUDIT_ACTIONS.RECRUITMENT_CLOSED, actor, drive);
    return getDrive(actor, drive._id);
};

const cancelDrive = async (actor, driveId, reason) => {
    const drive = await loadDrive(driveId);
    const { club } = await assertManager(actor, drive);
    if ([S.COMPLETED, S.CANCELLED, S.REJECTED].includes(drive.status)) {
        throw conflict("This drive is already finished");
    }
    const note = cleanText(reason, 500);
    const from = drive.status;
    drive.status = S.CANCELLED;
    drive.cancelledAt = new Date();
    drive.cancellationReason = note || null;
    await drive.save();
    const active = await RecruitmentApplication.find({ drive: drive._id, status: { $in: ACTIVE_APPLICATION } }).select("applicant");
    await RecruitmentApplication.updateMany({ drive: drive._id, status: { $in: ACTIVE_APPLICATION } }, { $set: { status: APPLICATION_STATUS.NOT_SELECTED, decidedAt: new Date() } });
    await audit(AUDIT_ACTIONS.RECRUITMENT_CANCELLED, actor, drive, { fromState: from, toState: S.CANCELLED, reason: note || null });
    if (active.length) {
        await mailer.sendDriveCancelled(drive, club, active.map((application) => application.applicant), note);
    }
    return getDrive(actor, drive._id);
};

module.exports = {
    ACTIVE_APPLICATION,
    loadDrive,
    driveContext,
    assertManager,
    assertStaff,
    phaseOf,
    applicationsOpen,
    applyProblem,
    applicationCounts,
    serializeDrive,
    getDrive,
    listClubDrives,
    listOpenDrives,
    openDrivesByClub,
    listDrivesToReview,
    createDrive,
    updateDrive,
    deleteDraft,
    submitDrive,
    approveDrive,
    requestDriveChanges,
    rejectDrive,
    publishDrive,
    extendDeadline,
    closeApplications,
    cancelDrive
};
