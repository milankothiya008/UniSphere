const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { APPLICATION_STATUS, MEMBERSHIP_STATUS, QUESTION_TYPES, ROUND_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { SYSTEM, findRole } = require("../utils/ClubRoles");
const { searchRegex } = require("../utils/Query");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { clubUsersWithPermission } = require("./MembershipService");
const media = require("./RecruitmentMediaService");
const mailer = require("./RecruitmentMailer");
const drives = require("./RecruitmentService");

// Applications to recruitment drives. A student applies to a role by filling that role's page-wise form
// while applications are open — one application per role, and they may apply to several roles. They can
// edit or withdraw until the deadline, follow each application through its rounds, and when selected they
// get an offer. Accepting one offer makes them a member in that role and closes their other applications.

const A = APPLICATION_STATUS;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const LIMITS = { [QUESTION_TYPES.SHORT]: 300, [QUESTION_TYPES.PARAGRAPH]: 5000, [QUESTION_TYPES.LINK]: 500 };

// ---------------------------------------------------------------- Validation

/**
 * Checks answers against a role's questions (all pages). `previous` keeps already-uploaded files when an
 * application is edited (the browser sends { keepFile: true }). Returns { answers, newFiles, droppedFiles }.
 */
const readAnswers = (drive, position, actor, input = [], previous = []) => {
    const given = new Map((Array.isArray(input) ? input : []).map((answer) => [String(answer?.question), answer]));
    const before = new Map(previous.map((answer) => [String(answer.question), answer]));
    const newFiles = [];
    const droppedFiles = [];

    const answers = drives.questionsOf(position).map((question) => {
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

// ---------------------------------------------------------------- Views

const fileView = (file) => (file ? { name: file.name, format: file.format, bytes: file.bytes, kind: file.kind, url: media.mediaUrls(file).url } : null);

/** Answers grouped by the role form's pages. */
const answerPages = (position, application) =>
    position.form.pages.map((page) => ({
        _id: page._id,
        title: page.title,
        answers: page.questions.map((question) => {
            const answer = application.answers.find((item) => String(item.question) === String(question._id)) || {};
            return { question: question._id, label: question.label, type: question.type, text: answer.text || "", choices: answer.choices || [], file: fileView(answer.file) };
        })
    }));

// What the applicant sees of the rounds: the ones they have a result for, plus the round in progress.
const roundsFor = (position, application) => {
    const active = drives.ACTIVE_APPLICATION.includes(application.status);
    const current = position.rounds[position.rounds.length - 1];
    const resultOf = (round) => application.roundResults.find((item) => String(item.round) === String(round._id));
    return position.rounds
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

const myApplicationView = (drive, application) => {
    const position = drive.positions.id(application.position);
    return {
        _id: application._id,
        position: application.position,
        positionTitle: position?.title || "Role",
        status: application.status,
        pages: position ? answerPages(position, application) : [],
        rounds: position ? roundsFor(position, application) : [],
        offeredAt: application.offeredAt,
        offerExpiresAt: application.offerExpiresAt,
        respondedAt: application.respondedAt,
        closedReason: application.closedReason,
        createdAt: application.createdAt,
        updatedAt: application.updatedAt,
        canEdit: drives.applicationsOpen(drive) && application.status === A.APPLIED,
        canWithdraw: drives.OPEN_APPLICATION.includes(application.status) && application.status !== A.OFFERED
    };
};

// ---------------------------------------------------------------- Student actions

const createUploadTickets = async (actor, driveId, kinds) => {
    const drive = await drives.loadDrive(driveId);
    const club = await Club.findById(drive.club);
    const problem = await drives.applyProblem(actor, drive, club);
    if (problem) {
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

const loadForApplicant = async (driveId) => {
    const drive = await drives.loadDrive(driveId);
    await drive.populate("positions.rounds.venue", "name location");
    return drive;
};

/** The student's applications in this drive, one per role. */
// The student's applications, including ones closed for them because they joined in another role
// (applications they withdrew themselves drop out of the list).
const visibleToApplicant = { $or: [{ status: { $ne: A.WITHDRAWN } }, { closedReason: { $ne: null } }] };

const getMyApplications = async (actor, driveId) => {
    const drive = await loadForApplicant(driveId);
    const applications = await RecruitmentApplication.find({ drive: drive._id, applicant: actor._id, ...visibleToApplicant }).sort({ createdAt: 1 });
    return applications.map((application) => myApplicationView(drive, application));
};

const getMyApplication = async (actor, driveId, positionId) => {
    const drive = await loadForApplicant(driveId);
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id, position: positionId });
    if (!application || application.status === A.WITHDRAWN) {
        throw new AppError("You haven't applied for this role", 404, ERROR_CODES.NOT_FOUND);
    }
    return myApplicationView(drive, application);
};

const apply = async (actor, driveId, positionId, payload) => {
    const drive = await drives.loadDrive(driveId);
    const position = drives.findPosition(drive, positionId);
    const club = await Club.findById(drive.club);
    const problem = await drives.applyProblem(actor, drive, club);
    if (problem) {
        throw new AppError(problem, 403, ERROR_CODES.FORBIDDEN);
    }
    const existing = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id, position: position._id });
    if (existing && existing.status !== A.WITHDRAWN) {
        throw new AppError(`You've already applied for ${position.title}. You can edit your application until the deadline.`, 409, ERROR_CODES.CONFLICT);
    }

    const { answers, newFiles } = readAnswers(drive, position, actor, payload.answers);
    let application;
    try {
        if (existing) {
            Object.assign(existing, { answers, status: A.APPLIED, roundResults: [], slots: [], remindersSent: [], withdrawnAt: null, decidedAt: null, closedReason: null, offeredAt: null, offerExpiresAt: null, respondedAt: null });
            application = await existing.save();
        } else {
            application = await RecruitmentApplication.create({ drive: drive._id, club: club._id, applicant: actor._id, position: position._id, answers });
        }
    } catch (error) {
        await Promise.all(newFiles.map((file) => media.deleteMediaQuietly(file)));
        if (error.code === 11000) {
            throw new AppError(`You've already applied for ${position.title}`, 409, ERROR_CODES.CONFLICT);
        }
        throw error;
    }

    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_SUBMITTED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id, clubId: club._id, role: position.role } });
    await mailer.sendApplicationReceived(drive, club, actor, position.title);
    await notify(await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MANAGE_RECRUITMENT), {
        type: NOTIFICATION_TYPES.APPLICATION_UPDATE,
        title: `New application: ${position.title}`,
        message: `${actor.name} applied for ${position.title} (${drive.title}).`,
        link: `/recruitment/${drive._id}?tab=applications`
    });
    return getMyApplication(actor, drive._id, position._id);
};

const updateMyApplication = async (actor, driveId, positionId, payload) => {
    const drive = await drives.loadDrive(driveId);
    const position = drives.findPosition(drive, positionId);
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id, position: position._id });
    if (!application || application.status !== A.APPLIED) {
        throw new AppError("You haven't applied for this role", 404, ERROR_CODES.NOT_FOUND);
    }
    if (!drives.applicationsOpen(drive)) {
        throw conflict("Applications are closed, so your answers can't change any more");
    }
    const { answers, newFiles, droppedFiles } = readAnswers(drive, position, actor, payload.answers, application.answers);
    application.answers = answers;
    try {
        await application.save();
    } catch (error) {
        await Promise.all(newFiles.map((file) => media.deleteMediaQuietly(file)));
        throw error;
    }
    await Promise.all(droppedFiles.map((file) => media.deleteMediaQuietly(file)));
    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_UPDATED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id } });
    return getMyApplication(actor, drive._id, position._id);
};

const withdraw = async (actor, driveId, positionId) => {
    const drive = await drives.loadDrive(driveId);
    const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: actor._id, position: positionId });
    if (!application || ![A.APPLIED, A.IN_ROUNDS, A.RESERVE].includes(application.status)) {
        throw new AppError("There's no application to withdraw for this role", 404, ERROR_CODES.NOT_FOUND);
    }
    application.status = A.WITHDRAWN;
    application.withdrawnAt = new Date();
    application.pendingOutcome = { round: null, outcome: null, note: null };
    application.slots = [];
    await application.save();
    await recordAudit({ action: AUDIT_ACTIONS.APPLICATION_WITHDRAWN, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id } });
    await drives.completeIfDone(drive._id);
};

/**
 * The student answers an offer. Accepting makes them a member in that role and closes every other
 * application they have in the drive (they can hold one role); declining frees the seat.
 */
const respondToOffer = async (actor, driveId, applicationId, accept) => {
    const drive = await drives.loadDrive(driveId);
    const club = await Club.findById(drive.club);
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id, applicant: actor._id });
    if (!application || application.status !== A.OFFERED) {
        throw conflict("This offer is no longer open");
    }
    const position = drives.findPosition(drive, application.position);
    const now = new Date();
    if (application.offerExpiresAt && application.offerExpiresAt <= now) {
        application.status = A.EXPIRED;
        await application.save();
        throw conflict("This offer has expired");
    }
    const presidents = await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MANAGE_RECRUITMENT);
    const link = `/recruitment/${drive._id}?tab=selection&role=${position._id}`;

    if (!accept) {
        application.status = A.DECLINED;
        application.respondedAt = now;
        await application.save();
        await recordAudit({ action: AUDIT_ACTIONS.OFFER_DECLINED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id, role: position.role } });
        await notify(presidents, { type: NOTIFICATION_TYPES.RECRUITMENT_UPDATE, title: `Offer declined: ${position.title}`, message: `${actor.name} declined the ${position.title} offer. You can offer the seat to a reserve candidate.`, link });
        await drives.completeIfDone(drive._id);
        return getMyApplications(actor, drive._id);
    }

    if (await ClubMembership.exists({ club: club._id, user: actor._id, status: MEMBERSHIP_STATUS.APPROVED })) {
        throw conflict(`You're already a member of ${club.name}`);
    }
    if (!findRole(club, position.role)) {
        throw conflict(`${club.name} no longer has the ${position.title} role. Contact the club.`);
    }
    if (position.role === SYSTEM.VICE_PRESIDENT && (await ClubMembership.exists({ club: club._id, role: SYSTEM.VICE_PRESIDENT, status: MEMBERSHIP_STATUS.APPROVED }))) {
        throw conflict("The vice-president seat has already been filled");
    }
    try {
        await ClubMembership.findOneAndUpdate(
            { club: club._id, user: actor._id },
            { $set: { status: MEMBERSHIP_STATUS.APPROVED, role: position.role, joinedAt: now, decidedAt: now, decisionReason: null } },
            { upsert: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (error.code === 11000) {
            throw conflict("The vice-president seat has already been filled");
        }
        throw error;
    }
    application.status = A.ACCEPTED;
    application.respondedAt = now;
    application.decidedAt = now;
    await application.save();

    // One role per student: everything else they have in this drive closes now.
    const others = await RecruitmentApplication.find({ drive: drive._id, applicant: actor._id, _id: { $ne: application._id }, status: { $in: drives.OPEN_APPLICATION } });
    const closedTitles = others.map((other) => drive.positions.id(other.position)?.title).filter(Boolean);
    const freedOffers = others.filter((other) => other.status === A.OFFERED);
    await RecruitmentApplication.updateMany(
        { _id: { $in: others.map((other) => other._id) } },
        { $set: { status: A.WITHDRAWN, withdrawnAt: now, slots: [], closedReason: `Joined as ${position.title}`, pendingOutcome: { round: null, outcome: null, note: null } } }
    );

    await recordAudit({ action: AUDIT_ACTIONS.OFFER_ACCEPTED, actor: actor._id, targetType: "RecruitmentApplication", targetId: application._id, metadata: { driveId: drive._id, clubId: club._id, role: position.role, closed: others.length } });
    await mailer.sendWelcome(drive, club, actor, position.title, closedTitles);
    await notify(presidents, {
        type: NOTIFICATION_TYPES.RECRUITMENT_UPDATE,
        title: `${actor.name} joined as ${position.title}`,
        message: freedOffers.length
            ? `They accepted the ${position.title} offer, so their ${freedOffers.map((other) => drive.positions.id(other.position)?.title).join(", ")} offer is free again.`
            : `They accepted your offer for ${drive.title}.`,
        link
    });
    await drives.completeIfDone(drive._id);
    return getMyApplications(actor, drive._id);
};

/** Every application of the signed-in student, newest first, with what's next. */
const myApplications = async (actor) => {
    const applications = await RecruitmentApplication.find({ applicant: actor._id, ...visibleToApplicant }).sort({ createdAt: -1 }).limit(40);
    const driveDocs = await RecruitmentDrive.find({ _id: { $in: applications.map((item) => item.drive) } })
        .populate("club", "name logo")
        .populate("positions.rounds.venue", "name location");
    const now = new Date();
    return applications
        .map((application) => {
            const drive = driveDocs.find((item) => String(item._id) === String(application.drive));
            const position = drive?.positions.id(application.position);
            if (!drive || !position) {
                return null;
            }
            const rounds = roundsFor(position, application);
            const next = rounds.filter((round) => round.slot && new Date(round.slot.endAt) > now && !round.result).sort((a, b) => new Date(a.slot.startAt) - new Date(b.slot.startAt))[0] || null;
            return {
                _id: application._id,
                status: application.status,
                createdAt: application.createdAt,
                position: position._id,
                positionTitle: position.title,
                offerExpiresAt: application.offerExpiresAt,
                closedReason: application.closedReason,
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
    position: application.position,
    positionTitle: drive.positions.id(application.position)?.title || "Role",
    roundResults: application.roundResults,
    pendingOutcome: application.pendingOutcome?.outcome ? application.pendingOutcome : null,
    slots: application.slots,
    offerExpiresAt: application.offerExpiresAt,
    closedReason: application.closedReason,
    createdAt: application.createdAt
});

/** President and mentor: the applications, searchable by name or email and filterable by role and status. */
const listApplications = async (actor, driveId, query = {}) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    const filter = { drive: drive._id };
    if (query.status === "active") {
        filter.status = { $in: drives.OPEN_APPLICATION };
    } else if (query.status && Object.values(A).includes(query.status)) {
        filter.status = query.status;
    } else {
        filter.status = { $ne: A.WITHDRAWN };
    }
    if (query.position) {
        filter.position = query.position;
    }
    if (String(query.search || "").trim()) {
        const users = await User.find({ $or: [{ name: searchRegex(query.search) }, { email: searchRegex(query.search) }] }).select("_id");
        filter.applicant = { $in: users.map((user) => user._id) };
    }
    const applications = await RecruitmentApplication.find(filter).sort({ createdAt: 1 }).populate("applicant", "name email departmentCode batchCode").limit(500);
    // How many roles each student applied for, so the president can see overlaps.
    const perStudent = await RecruitmentApplication.aggregate([{ $match: { drive: drive._id, status: { $ne: A.WITHDRAWN } } }, { $group: { _id: "$applicant", count: { $sum: 1 } } }]);
    const countOf = new Map(perStudent.map((row) => [String(row._id), row.count]));
    return applications.map((application) => ({ ...staffApplicationView(drive, application), otherRoles: (countOf.get(String(application.applicant?._id)) || 1) - 1 }));
};

const getApplication = async (actor, driveId, applicationId) => {
    const drive = await drives.loadDrive(driveId);
    await drives.assertStaff(actor, drive);
    const application = await RecruitmentApplication.findOne({ _id: applicationId, drive: drive._id }).populate("applicant", "name email departmentCode batchCode");
    const position = application && drive.positions.id(application.position);
    if (!application || !position) {
        throw new AppError("Application not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const others = await RecruitmentApplication.find({ drive: drive._id, applicant: application.applicant._id, _id: { $ne: application._id }, status: { $ne: A.WITHDRAWN } }).select("position status");
    return {
        ...staffApplicationView(drive, application),
        pages: answerPages(position, application),
        otherApplications: others.map((other) => ({ position: other.position, positionTitle: drive.positions.id(other.position)?.title, status: other.status }))
    };
};

module.exports = {
    readAnswers,
    createUploadTickets,
    uploadLocalFile,
    getMyApplications,
    getMyApplication,
    apply,
    updateMyApplication,
    withdraw,
    respondToOffer,
    myApplications,
    listApplications,
    getApplication
};
