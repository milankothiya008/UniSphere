const Club = require("../models/Club");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { APPLICATION_STATUS, QUESTION_TYPES, ROUND_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { searchRegex } = require("../utils/Query");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { clubUsersWithPermission } = require("./MembershipService");
const media = require("./RecruitmentMediaService");
const mailer = require("./RecruitmentMailer");
const drives = require("./RecruitmentService");

// Applications to recruitment drives: a student fills in the club's form while applications are open,
// can edit or withdraw it until the deadline, and follows it through the rounds.

const A = APPLICATION_STATUS;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const LIMITS = { [QUESTION_TYPES.SHORT]: 300, [QUESTION_TYPES.PARAGRAPH]: 5000, [QUESTION_TYPES.LINK]: 500 };

// ---------------------------------------------------------------- Validation

/**
 * Checks answers against the drive's questions. `previous` keeps already-uploaded files when an application
 * is edited (the browser sends { keepFile: true }). Returns { answers, newFiles, droppedFiles }.
 */
const readAnswers = (drive, actor, input = [], previous = []) => {
    const given = new Map((Array.isArray(input) ? input : []).map((answer) => [String(answer?.question), answer]));
    const before = new Map(previous.map((answer) => [String(answer.question), answer]));
    const newFiles = [];
    const droppedFiles = [];

    const answers = drive.questions.map((question) => {
        const id = String(question._id);
        const answer = given.get(id) || {};
        const out = { question: question._id, text: "", choices: [], file: null };
        const missing = () => invalid(`Please answer "${question.label}"`);

        switch (question.type) {
            case QUESTION_TYPES.SHORT:
            case QUESTION_TYPES.PARAGRAPH:
            case QUESTION_TYPES.LINK: {
                const text = String(answer.text ?? "").trim();
                if (text.length > LIMITS[question.type]) {
                    throw invalid(`"${question.label}" can be up to ${LIMITS[question.type]} characters`);
                }
                if (question.type === QUESTION_TYPES.LINK && text && !URL_PATTERN.test(text)) {
                    throw invalid(`"${question.label}" needs a full link starting with https://`);
                }
                if (question.required && !text) {
                    throw missing();
                }
                out.text = text;
                break;
            }
            case QUESTION_TYPES.SINGLE_CHOICE:
            case QUESTION_TYPES.MULTI_CHOICE: {
                const picked = [...new Set((Array.isArray(answer.choices) ? answer.choices : []).map(String))];
                if (picked.some((choice) => !question.options.includes(choice))) {
                    throw invalid(`Choose from the options given for "${question.label}"`);
                }
                if (question.type === QUESTION_TYPES.SINGLE_CHOICE && picked.length > 1) {
                    throw invalid(`Pick one option for "${question.label}"`);
                }
                if (question.required && !picked.length) {
                    throw missing();
                }
                out.choices = picked;
                break;
            }
            case QUESTION_TYPES.FILE: {
                const old = before.get(id)?.file || null;
                if (answer.keepFile && old) {
                    out.file = old;
                } else if (answer.media) {
                    const stored = media.verifyUpload(answer.media, String(drive._id), String(actor._id));
                    out.file = { ...stored, name: String(answer.media.name || "").slice(0, 200) || null };
                    newFiles.push(out.file);
                    if (old) {
                        droppedFiles.push(old);
                    }
                } else if (old) {
                    droppedFiles.push(old);
                }
                if (question.required && !out.file) {
                    throw missing();
                }
                break;
            }
            default:
                break;
        }
        return out;
    });

    return { answers, newFiles, droppedFiles };
};

const readPositions = (drive, positions) => {
    const known = new Set(drive.positions.map((position) => String(position._id)));
    const picked = [...new Set((Array.isArray(positions) ? positions : []).map(String))];
    if (!picked.length) {
        throw invalid("Choose at least one position to apply for");
    }
    if (picked.some((id) => !known.has(id))) {
        throw invalid("Choose positions from this drive");
    }
    return picked;
};

// ---------------------------------------------------------------- Views

const fileView = (file) => (file ? { name: file.name, format: file.format, bytes: file.bytes, kind: file.kind, url: media.mediaUrls(file).url } : null);

const answerViews = (drive, application) =>
    drive.questions.map((question) => {
        const answer = application.answers.find((item) => String(item.question) === String(question._id)) || {};
        return { question: question._id, label: question.label, type: question.type, text: answer.text || "", choices: answer.choices || [], file: fileView(answer.file) };
    });

const positionTitles = (drive, ids) => ids.map((id) => drive.positions.id(id)?.title).filter(Boolean);

// What the applicant sees of the rounds: the ones they have a result for, plus the round in progress.
const roundsFor = (drive, application) => {
    const active = [A.APPLIED, A.IN_ROUNDS].includes(application.status);
    const current = drive.rounds[drive.rounds.length - 1];
    const resultOf = (round) => application.roundResults.find((item) => String(item.round) === String(round._id));
    return drive.rounds
        .filter((round) => resultOf(round) || (active && current && String(round._id) === String(current._id) && round.status !== ROUND_STATUS.RESULTS_PUBLISHED))
        .map((round) => {
            const result = resultOf(round);
            const slot = application.slots.find((item) => String(item.round) === String(round._id));
            const scheduled = round.status !== ROUND_STATUS.DRAFT && round.mode !== "SCREENING";
            return {
                _id: round._id,
                name: round.name,
                mode: round.mode,
                status: round.status,
                result: result ? result.outcome : null,
                slot: scheduled && slot ? { startAt: slot.startAt, endAt: slot.endAt } : null,
                venue: scheduled && round.venue ? { name: round.venue.name, location: round.venue.location } : null,
                meetingLink: scheduled && !result ? round.meetingLink : null,
                instructions: scheduled ? round.instructions : ""
            };
        });
};

const myApplicationView = (drive, application) => ({
    _id: application._id,
    status: application.status,
    positions: application.positions,
    positionTitles: positionTitles(drive, application.positions),
    answers: answerViews(drive, application),
    rounds: roundsFor(drive, application),
    finalRole: application.finalRole,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    canEdit: drives.applicationsOpen(drive) && [A.APPLIED].includes(application.status),
    canWithdraw: [A.APPLIED, A.IN_ROUNDS].includes(application.status)
});

// ---------------------------------------------------------------- Student actions

const createUploadTickets = async (actor, driveId, kinds) => {
    const drive = await drives.loadDrive(driveId);
    const club = await Club.findById(drive.club);
    const problem = await drives.applyProblem(actor, drive, club);
    const mine = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id }).select("status");
    if (problem && !(mine && mine.status === A.APPLIED && drives.applicationsOpen(drive))) {
        throw new AppError(problem, 403, ERROR_CODES.FORBIDDEN);
    }
    const list = (Array.isArray(kinds) ? kinds : [kinds]).slice(0, 10);
    if (!list.length || list.some((kind) => !["DOCUMENT", "IMAGE"].includes(kind))) {
        throw invalid("Attach PDFs or images");
    }
    return list.map((kind) => media.createUploadTicket(String(drive._id), String(actor._id), kind));
};

const uploadLocalFile = async (actor, driveId, file) => {
    if (media.providerName() !== "local") {
        throw new AppError("Files are uploaded directly to cloud storage", 400, ERROR_CODES.UPLOAD_ERROR);
    }
    const drive = await drives.loadDrive(driveId);
    return { provider: "local", ...(await media.saveLocalFile(file, String(drive._id), String(actor._id))) };
};

const getMyApplication = async (actor, driveId) => {
    const drive = await drives.loadDrive(driveId);
    await drive.populate("rounds.venue", "name location");
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id });
    if (!application || application.status === A.WITHDRAWN) {
        throw new AppError("You haven't applied to this drive", 404, ERROR_CODES.NOT_FOUND);
    }
    return myApplicationView(drive, application);
};

const apply = async (actor, driveId, payload) => {
    const drive = await drives.loadDrive(driveId);
    const club = await Club.findById(drive.club);
    const problem = await drives.applyProblem(actor, drive, club);
    if (problem) {
        throw new AppError(problem, 403, ERROR_CODES.FORBIDDEN);
    }
    const existing = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id });
    if (existing && existing.status !== A.WITHDRAWN) {
        throw new AppError("You've already applied. You can edit your application until the deadline.", 409, ERROR_CODES.CONFLICT);
    }

    const positions = readPositions(drive, payload.positions);
    const { answers, newFiles } = readAnswers(drive, actor, payload.answers);
    let application;
    try {
        if (existing) {
            Object.assign(existing, { positions, answers, status: A.APPLIED, roundResults: [], slots: [], remindersSent: [], withdrawnAt: null, finalRole: null, decidedAt: null });
            application = await existing.save();
        } else {
            application = await RecruitmentApplication.create({ drive: drive._id, club: club._id, applicant: actor._id, positions, answers });
        }
    } catch (error) {
        await Promise.all(newFiles.map((file) => media.deleteMediaQuietly(file)));
        if (error.code === 11000) {
            throw new AppError("You've already applied to this drive", 409, ERROR_CODES.CONFLICT);
        }
        throw error;
    }

    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_SUBMITTED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id, clubId: club._id } });
    const titles = positionTitles(drive, positions);
    await mailer.sendApplicationReceived(drive, club, actor, titles);
    await notify(await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MANAGE_RECRUITMENT), {
        type: NOTIFICATION_TYPES.APPLICATION_UPDATE,
        title: `New application: ${drive.title}`,
        message: `${actor.name} applied for ${titles.join(", ")}.`,
        link: `/recruitment/${drive._id}?tab=applications`
    });
    return getMyApplication(actor, drive._id);
};

const updateMyApplication = async (actor, driveId, payload) => {
    const drive = await drives.loadDrive(driveId);
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id });
    if (!application || application.status !== A.APPLIED) {
        throw new AppError("You haven't applied to this drive", 404, ERROR_CODES.NOT_FOUND);
    }
    if (!drives.applicationsOpen(drive)) {
        throw conflict("Applications are closed, so your answers can't change any more");
    }
    const positions = readPositions(drive, payload.positions);
    const { answers, newFiles, droppedFiles } = readAnswers(drive, actor, payload.answers, application.answers);
    application.positions = positions;
    application.answers = answers;
    try {
        await application.save();
    } catch (error) {
        await Promise.all(newFiles.map((file) => media.deleteMediaQuietly(file)));
        throw error;
    }
    await Promise.all(droppedFiles.map((file) => media.deleteMediaQuietly(file)));
    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_UPDATED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id } });
    return getMyApplication(actor, drive._id);
};

const withdraw = async (actor, driveId) => {
    const drive = await drives.loadDrive(driveId);
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id });
    if (!application || ![A.APPLIED, A.IN_ROUNDS].includes(application.status)) {
        throw new AppError("There's no active application to withdraw", 404, ERROR_CODES.NOT_FOUND);
    }
    application.status = A.WITHDRAWN;
    application.withdrawnAt = new Date();
    application.pendingOutcome = { round: null, outcome: null, note: null };
    application.slots = [];
    await application.save();
    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_WITHDRAWN, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id } });
};

/** Every application of the signed-in student, newest first, with what's next. */
const myApplications = async (actor) => {
    const applications = await RecruitmentApplication.find({ applicant: actor._id, status: { $ne: A.WITHDRAWN } }).sort({ createdAt: -1 }).limit(30);
    const driveDocs = await RecruitmentDrive.find({ _id: { $in: applications.map((item) => item.drive) } })
        .populate("club", "name logo")
        .populate("rounds.venue", "name location");
    const now = new Date();
    return applications
        .map((application) => {
            const drive = driveDocs.find((item) => String(item._id) === String(application.drive));
            if (!drive) {
                return null;
            }
            const rounds = roundsFor(drive, application);
            const next = rounds.filter((round) => round.slot && new Date(round.slot.endAt) > now && !round.result).sort((a, b) => new Date(a.slot.startAt) - new Date(b.slot.startAt))[0] || null;
            return {
                _id: application._id,
                status: application.status,
                createdAt: application.createdAt,
                finalRole: application.finalRole,
                positionTitles: positionTitles(drive, application.positions),
                drive: { _id: drive._id, title: drive.title, status: drive.status, phase: drives.phaseOf(drive, now), applicationEnd: drive.applicationEnd, club: drive.club },
                roundsPassed: application.roundResults.filter((result) => result.outcome === "QUALIFIED").length,
                nextInterview: next
            };
        })
        .filter(Boolean);
};

// ---------------------------------------------------------------- Club side

const staffApplicationView = (drive, application) => ({
    _id: application._id,
    applicant: application.applicant,
    status: application.status,
    positions: application.positions,
    positionTitles: positionTitles(drive, application.positions),
    roundResults: application.roundResults,
    pendingOutcome: application.pendingOutcome?.outcome ? application.pendingOutcome : null,
    slots: application.slots,
    finalRole: application.finalRole,
    createdAt: application.createdAt
});

/** President and mentor: the applications, searchable by name or email and filterable. */
const listApplications = async (actor, driveId, query = {}) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    const filter = { drive: drive._id };
    if (query.status === "active") {
        filter.status = { $in: drives.ACTIVE_APPLICATION };
    } else if (query.status && Object.values(A).includes(query.status)) {
        filter.status = query.status;
    } else {
        filter.status = { $ne: A.WITHDRAWN };
    }
    if (query.position) {
        filter.positions = query.position;
    }
    if (String(query.search || "").trim()) {
        const users = await User.find({ $or: [{ name: searchRegex(query.search) }, { email: searchRegex(query.search) }] }).select("_id");
        filter.applicant = { $in: users.map((user) => user._id) };
    }
    const applications = await RecruitmentApplication.find(filter).sort({ createdAt: 1 }).populate("applicant", "name email departmentCode batchCode").limit(500);
    return applications.map((application) => staffApplicationView(drive, application));
};

const getApplication = async (actor, driveId, applicationId) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id }).populate("applicant", "name email departmentCode batchCode");
    if (!application) {
        throw new AppError("Application not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return { ...staffApplicationView(drive, application), answers: answerViews(drive, application) };
};

module.exports = {
    readAnswers,
    createUploadTickets,
    uploadLocalFile,
    getMyApplication,
    apply,
    updateMyApplication,
    withdraw,
    myApplications,
    listApplications,
    getApplication,
    positionTitles
};
