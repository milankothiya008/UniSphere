const Club = require("../models/Club");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");
const { GLOBAL_ROLES } = require("../constants/Roles");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const {
    CLUB_STATUS,
    EVENT_STATUS,
    REGISTRATION_STATUS,
    RECRUITMENT_STATUS,
    APPLICATION_STATUS,
    NOTIFICATION_TYPES,
    AUDIT_ACTIONS
} = require("../constants/Statuses");
const { formatDate, formatTime } = require("../utils/CampusTime");
const { recordAudit } = require("./AuditService");
const { notify, emailUsers } = require("./NotificationService");

// Suspending or archiving a club pauses it: its upcoming events and live recruitment stay as they are but
// are hidden from students and closed to registrations, applications and offers. Reactivating resumes
// them, and recruitment deadlines and offer deadlines move on by however long the club was paused, so
// nobody loses time. The president, the mentor, registered students and applicants are told both times.

const PAUSED = [CLUB_STATUS.SUSPENDED, CLUB_STATUS.ARCHIVED];
const OPEN_APPLICATIONS = [APPLICATION_STATUS.APPLIED, APPLICATION_STATUS.IN_ROUNDS, APPLICATION_STATUS.OFFERED, APPLICATION_STATUS.RESERVE];
const HELD_REGISTRATIONS = [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED];
const ACCOUNT = EMAIL_CATEGORIES.ACCOUNT;
const MINIMUM_REASON = 5;

// Which status can follow which. A club in APPROVED becomes ACTIVE only when the mentor appoints a president.
const TRANSITIONS = {
    [CLUB_STATUS.ACTIVE]: [CLUB_STATUS.SUSPENDED, CLUB_STATUS.ARCHIVED],
    [CLUB_STATUS.SUSPENDED]: [CLUB_STATUS.ACTIVE, CLUB_STATUS.ARCHIVED],
    [CLUB_STATUS.ARCHIVED]: [CLUB_STATUS.ACTIVE],
    [CLUB_STATUS.APPROVED]: [CLUB_STATUS.ARCHIVED]
};

const isPaused = (club) => PAUSED.includes(club?.status);

/** Ids of clubs that are suspended or archived, so their events and drives can be left out of listings. */
const pausedClubIds = async () => (await Club.find({ status: { $in: PAUSED } }).select("_id").lean()).map((club) => club._id);

const firstName = (user) => String(user?.name || "there").split(" ")[0];
const when = (date) => `${formatDate(date)}, ${formatTime(date)}`;

const WORDS = {
    [CLUB_STATUS.SUSPENDED]: { verb: "suspended", title: "suspended" },
    [CLUB_STATUS.ARCHIVED]: { verb: "archived", title: "archived" },
    [CLUB_STATUS.ACTIVE]: { verb: "reactivated", title: "active again" }
};

// ---------------------------------------------------------------- Who is affected

const affected = async (club, now) => {
    const events = await Event.find({ club: club._id, status: EVENT_STATUS.PUBLISHED, endAt: { $gt: now } }).select("title startAt endAt venue").sort({ startAt: 1 });
    const registrations = events.length
        ? await EventRegistration.find({ event: { $in: events.map((event) => event._id) }, status: { $in: HELD_REGISTRATIONS } }).select("event user")
        : [];
    const drives = await RecruitmentDrive.find({ club: club._id, status: RECRUITMENT_STATUS.PUBLISHED }).select("title applicationStart applicationEnd closedAt");
    const applications = drives.length
        ? await RecruitmentApplication.find({ drive: { $in: drives.map((drive) => drive._id) }, status: { $in: OPEN_APPLICATIONS } }).select("drive applicant status offerExpiresAt")
        : [];
    return { events, registrations, drives, applications };
};

// Recruitment and offer deadlines resume where they stopped.
const shiftDeadlines = async (club, drives, pausedAt, now) => {
    const pausedFor = pausedAt ? now - new Date(pausedAt) : 0;
    if (pausedFor <= 0) {
        return 0;
    }
    for (const drive of drives) {
        const update = {};
        if (!drive.closedAt && drive.applicationEnd > pausedAt) update.applicationEnd = new Date(drive.applicationEnd.getTime() + pausedFor);
        if (drive.applicationStart > pausedAt) update.applicationStart = new Date(drive.applicationStart.getTime() + pausedFor);
        if (Object.keys(update).length) await RecruitmentDrive.updateOne({ _id: drive._id }, { $set: update });
    }
    const offers = await RecruitmentApplication.find({ drive: { $in: drives.map((drive) => drive._id) }, status: APPLICATION_STATUS.OFFERED, offerExpiresAt: { $ne: null } }).select("offerExpiresAt");
    for (const offer of offers) {
        await RecruitmentApplication.updateOne({ _id: offer._id }, { $set: { offerExpiresAt: new Date(offer.offerExpiresAt.getTime() + pausedFor) } });
    }
    return pausedFor;
};

// ---------------------------------------------------------------- Messages

const leadershipEmail = (club, status, note, counts, actor) => {
    const { verb } = WORDS[status];
    const resumed = status === CLUB_STATUS.ACTIVE;
    const heading = resumed ? `${club.name} is active again` : `${club.name} has been ${verb}`;
    const paragraphs = resumed
        ? [
              `The university admin has reactivated ${club.name}. Everything that was on hold is running again.`,
              counts.events || counts.drives
                  ? `Resumed: ${[counts.events && `${counts.events} upcoming ${counts.events === 1 ? "event" : "events"}`, counts.drives && `${counts.drives} recruitment ${counts.drives === 1 ? "drive" : "drives"}`].filter(Boolean).join(" and ")}. Recruitment and offer deadlines have moved on by the time the club was paused, and registered students and applicants have been told.`
                  : null
          ]
        : [
              `The university admin has ${verb} ${club.name}.`,
              `While the club is ${verb}, its upcoming events and recruitment are on hold: students can't see them, register or apply, and new events, posts and members are paused. Nothing is deleted — it all resumes if the club is reactivated.`,
              counts.people ? `${counts.people} registered ${counts.people === 1 ? "student has" : "students have"} been told their event is on hold.` : null
          ];
    return {
        subject: resumed ? `${club.name} has been reactivated` : `${club.name} has been ${verb}`,
        heading,
        paragraphs: paragraphs.filter(Boolean),
        details: [
            ["Club", club.name],
            ["Status", resumed ? "Active" : verb[0].toUpperCase() + verb.slice(1)],
            [resumed ? "Admin's note" : "Reason", note || "—"],
            ["Changed by", actor.name || "University admin"]
        ],
        action: { label: `Open ${club.name}`, url: `/clubs/${club._id}` }
    };
};

const participantEmail = (club, status, eventsFor) => (user) => {
    const resumed = status === CLUB_STATUS.ACTIVE;
    const events = eventsFor(user);
    const list = events.map((event) => `${event.title} (${when(event.startAt)})`).join("; ");
    return {
        subject: resumed ? `Back on: ${events.length === 1 ? events[0].title : `${club.name} events`}` : `On hold: ${events.length === 1 ? events[0].title : `${club.name} events`}`,
        heading: resumed ? "Your event is back on" : "Your event is on hold",
        paragraphs: resumed
            ? [`Good news, ${firstName(user)} — ${club.name} is active again, and your registration still stands.`, `Event: ${list}.`, "Check the event page for any updates from the club."]
            : [
                  `${club.name} has been ${WORDS[status].verb} by the university, so its upcoming events are on hold for now.`,
                  `You're registered for: ${list}. Your registration is kept — if the club is reactivated before the event, it goes ahead and we'll email you.`
              ],
        action: { label: events.length === 1 ? "View event" : "Your registrations", url: events.length === 1 ? `/events/${events[0]._id}` : "/my-registrations" }
    };
};

const applicantEmail = (club, status, drivesFor, pausedFor) => (user) => {
    const resumed = status === CLUB_STATUS.ACTIVE;
    const drives = drivesFor(user);
    const days = Math.max(1, Math.round(pausedFor / 86400000));
    return {
        subject: resumed ? `${club.name} recruitment has resumed` : `${club.name} recruitment is on hold`,
        heading: resumed ? "Recruitment has resumed" : "Recruitment is on hold",
        paragraphs: resumed
            ? [
                  `${club.name} is active again, so ${drives.map((drive) => drive.title).join(", ")} continues where it stopped.`,
                  pausedFor ? `Deadlines — including any offer waiting for your answer — have moved on by about ${days} ${days === 1 ? "day" : "days"}.` : null
              ].filter(Boolean)
            : [
                  `${club.name} has been ${WORDS[status].verb} by the university, so ${drives.map((drive) => drive.title).join(", ")} is on hold.`,
                  "Your application is kept as it is. If the club is reactivated, recruitment continues and deadlines move on by the time it was paused."
              ],
        action: { label: "Your applications", url: "/my-applications" }
    };
};

// ---------------------------------------------------------------- Change the status

const changeClubStatus = async (actor, clubId, status, reason = null) => {
    if (actor?.globalRole !== GLOBAL_ROLES.ADMIN) {
        throw new AppError("Only the university admin can change a club's status", 403, ERROR_CODES.FORBIDDEN);
    }
    const club = await Club.findById(clubId).populate("president", "name").populate("mentor", "name");
    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (club.status === status) {
        throw new AppError(`${club.name} is already ${String(status).toLowerCase()}`, 409, ERROR_CODES.INVALID_STATE);
    }
    if (!(TRANSITIONS[club.status] || []).includes(status)) {
        throw new AppError(`A ${String(club.status).toLowerCase()} club can't become ${String(status).toLowerCase()}`, 409, ERROR_CODES.INVALID_STATE);
    }
    if (status === CLUB_STATUS.ACTIVE && !club.president) {
        throw new AppError("A president must be assigned before the club can become active", 409, ERROR_CODES.INVALID_STATE);
    }
    const note = String(reason || "").trim() || null;
    if (PAUSED.includes(status) && (!note || note.length < MINIMUM_REASON)) {
        throw new AppError(`Give a reason (at least ${MINIMUM_REASON} characters) — it's emailed to the president and mentor`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const now = new Date();
    const from = club.status;
    const wasPaused = isPaused(club);
    const pausedAt = club.pausedAt;
    club.status = status;
    club.statusNote = note;
    club.statusChangedAt = now;
    if (PAUSED.includes(status) && !wasPaused) club.pausedAt = now;
    if (status === CLUB_STATUS.ACTIVE) club.pausedAt = null;
    await club.save();

    await recordAudit({ action: AUDIT_ACTIONS.CLUB_STATUS_CHANGED, actor: actor._id, targetType: "Club", targetId: club._id, fromState: from, toState: status, reason: note });

    // Only a pause or a resume changes anything for students (archiving a suspended club doesn't).
    const pausing = PAUSED.includes(status) && !wasPaused;
    const resuming = status === CLUB_STATUS.ACTIVE && wasPaused;
    try {
        const { events, registrations, drives, applications } = pausing || resuming ? await affected(club, now) : { events: [], registrations: [], drives: [], applications: [] };
        const pausedFor = resuming ? await shiftDeadlines(club, drives, pausedAt, now) : 0;
        const leaders = [club.president?._id, club.mentor?._id].filter(Boolean);
        const participants = [...new Set(registrations.map((registration) => String(registration.user)))];
        const applicants = [...new Set(applications.map((application) => String(application.applicant)))];
        const stamp = now.getTime();

        await notify(leaders, {
            type: NOTIFICATION_TYPES.CLUB_UPDATE,
            title: status === CLUB_STATUS.ACTIVE ? `${club.name} is active again` : `${club.name} has been ${WORDS[status].verb}`,
            message: note || "",
            link: `/clubs/${club._id}`
        });
        await emailUsers(leaders, {
            category: ACCOUNT,
            dedupeKey: (user) => `club-status:${club._id}:${status}:${stamp}:${user._id}`,
            compose: () => leadershipEmail(club, status, note, { events: events.length, drives: drives.length, people: participants.length }, actor)
        });

        if (participants.length) {
            const eventsFor = (user) => {
                const mine = new Set(registrations.filter((registration) => String(registration.user) === String(user._id)).map((registration) => String(registration.event)));
                return events.filter((event) => mine.has(String(event._id)));
            };
            await notify(participants, {
                type: NOTIFICATION_TYPES.EVENT_UPDATED,
                title: resuming ? `${club.name}'s events are back on` : `${club.name}'s events are on hold`,
                message: resuming ? "Your registration still stands." : "Your registration is kept while the club is paused.",
                link: "/my-registrations"
            });
            await emailUsers(participants, { category: ACCOUNT, dedupeKey: (user) => `club-status-events:${club._id}:${stamp}:${user._id}`, compose: participantEmail(club, status, eventsFor) });
        }
        if (applicants.length) {
            const drivesFor = (user) => {
                const mine = new Set(applications.filter((application) => String(application.applicant) === String(user._id)).map((application) => String(application.drive)));
                return drives.filter((drive) => mine.has(String(drive._id)));
            };
            await notify(applicants, {
                type: NOTIFICATION_TYPES.APPLICATION_UPDATE,
                title: resuming ? `${club.name} recruitment has resumed` : `${club.name} recruitment is on hold`,
                message: resuming ? "Deadlines have moved on by the time it was paused." : "Your application is kept.",
                link: "/my-applications"
            });
            await emailUsers(applicants, { category: ACCOUNT, dedupeKey: (user) => `club-status-recruitment:${club._id}:${stamp}:${user._id}`, compose: applicantEmail(club, status, drivesFor, pausedFor) });
        }
    } catch (error) {
        logger.error("Club status side effects failed", { clubId: String(club._id), status, message: error.message });
    }

    return require("./ClubService").getClub(actor, club._id);
};

module.exports = { changeClubStatus, pausedClubIds, isPaused, PAUSED };
