const User = require("../models/User");
const ClubMembership = require("../models/ClubMembership");
const logger = require("../utils/Logger");
const { emailUsers, notify } = require("./NotificationService");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { ACCOUNT_TYPES } = require("../constants/Roles");
const { MEMBERSHIP_STATUS, NOTIFICATION_TYPES, ROUND_MODES } = require("../constants/Statuses");
const { formatDate, formatSchedule, formatTime } = require("../utils/CampusTime");

// Every recruitment email. Messages to applicants about their own application are ACCOUNT emails (always
// delivered); the "applications are open" announcement uses the optional "Club recruitment" category.
// Nothing here may undo the change that triggered it, so failures are logged and swallowed.

const ACCOUNT = EMAIL_CATEGORIES.ACCOUNT;
const drivePath = (drive) => `/recruitment/${drive._id}`;
const firstName = (user) => String(user?.name || "there").split(" ")[0];

const safely = (label, task) =>
    task().catch((error) => {
        logger.error(`Recruitment email failed: ${label}`, { message: error.message });
    });

const deadline = (drive) => `${formatDate(drive.applicationEnd)}, ${formatTime(drive.applicationEnd)}`;

const positionsLabel = (drive) => drive.positions.map((position) => position.title).join(", ");

/** Students who could apply: in the club's department scope and batch filter, not already members. */
const recruitmentAudience = async (drive, club) => {
    const filter = { accountType: ACCOUNT_TYPES.STUDENT, isActive: true, isEmailVerified: true };
    if (!club.allDepartments) {
        filter.departmentCode = { $in: club.departmentCodes || [] };
    }
    if (drive.eligibility?.batches?.length) {
        filter.batchCode = { $in: drive.eligibility.batches };
    }
    const members = await ClubMembership.find({ club: club._id, status: MEMBERSHIP_STATUS.APPROVED }).distinct("user");
    filter._id = { $nin: members };
    return (await User.find(filter).select("_id").lean()).map((user) => user._id);
};

// ---------------------------------------------------------------- Drive published

const sendRecruitmentLaunch = (drive, club, actor) =>
    safely("launch", async () => {
        const audience = await recruitmentAudience(drive, club);
        const opensLater = new Date(drive.applicationStart) > new Date();
        const title = `${club.name} is recruiting: ${drive.title}`;

        await notify(audience, {
            type: NOTIFICATION_TYPES.RECRUITMENT_OPEN,
            title,
            message: opensLater ? `Applications open ${formatDate(drive.applicationStart)} and close ${deadline(drive)}.` : `Apply by ${deadline(drive)}. Positions: ${positionsLabel(drive)}.`,
            link: drivePath(drive),
            exclude: [actor._id]
        });

        await emailUsers(audience, {
            category: EMAIL_CATEGORIES.RECRUITMENT,
            exclude: [actor._id],
            dedupeKey: (user) => `recruitment-open:${drive._id}:${user._id}`,
            compose: () => ({
                subject: title,
                heading: `${club.name} is looking for new members`,
                paragraphs: [
                    `${club.name} has opened recruitment for ${drive.title}.`,
                    String(drive.description || "").slice(0, 600),
                    opensLater ? `Applications open on ${formatDate(drive.applicationStart)}.` : "Fill in the application form — it only takes a few minutes."
                ].filter(Boolean),
                details: [
                    ["Positions", positionsLabel(drive)],
                    ["Apply by", deadline(drive)]
                ],
                image: club.coverImage || null,
                action: { label: opensLater ? "See the details" : "Apply now", url: drivePath(drive) },
                reason: "You're receiving this because you can join this club."
            })
        });
    });

// ---------------------------------------------------------------- Applications

const sendApplicationReceived = (drive, club, applicant, positionTitle) =>
    safely("received", () =>
        emailUsers([applicant._id], {
            category: ACCOUNT,
            dedupeKey: () => `application-received:${drive._id}:${applicant._id}:${positionTitle}`,
            compose: () => ({
                subject: `Application received: ${positionTitle} — ${club.name}`,
                heading: "We've received your application",
                paragraphs: [
                    `Thank you for applying to be ${positionTitle} at ${club.name} (${drive.title}).`,
                    "The club will review applications after the deadline. You'll get an email for every step — interview invitations, round results and the final decision."
                ],
                details: [
                    ["Role", positionTitle],
                    ["Applications close", deadline(drive)]
                ],
                action: { label: "View your application", url: drivePath(drive) }
            })
        })
    );

// ---------------------------------------------------------------- Interviews

const roundWhere = (round, venue) =>
    round.mode === ROUND_MODES.ONLINE ? "Online meeting" : venue ? `${venue.name}${venue.location ? `, ${venue.location}` : ""}` : null;

const interviewDetails = (drive, position, round, slot, venue) => [
    ["Role", position.title],
    ["Round", round.name],
    ["When", formatSchedule(slot.startAt, slot.endAt)],
    ["Where", roundWhere(round, venue)],
    ["Meeting link", round.mode === ROUND_MODES.ONLINE ? round.meetingLink : null]
];

const interviewAction = (drive, round) =>
    round.mode === ROUND_MODES.ONLINE && round.meetingLink ? { label: "Join the meeting", url: round.meetingLink } : { label: "View details", url: drivePath(drive) };

/** Invitation (or an updated time) for one candidate. `kind`: invite | changed. */
const sendInterviewInvite = (drive, club, position, round, slot, user, venue, kind = "invite") =>
    safely("invite", async () => {
        const changed = kind === "changed";
        const title = changed ? `Updated time: ${round.name} (${position.title}) — ${club.name}` : `You're invited: ${round.name} (${position.title}) — ${club.name}`;
        await notify([user._id], {
            type: NOTIFICATION_TYPES.INTERVIEW_SCHEDULED,
            title,
            message: `${formatSchedule(slot.startAt, slot.endAt)}${roundWhere(round, venue) ? ` · ${roundWhere(round, venue)}` : ""}`,
            link: drivePath(drive)
        });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `interview-${kind}:${round._id}:${user._id}:${new Date(slot.startAt).getTime()}`,
            compose: () => ({
                subject: title,
                heading: changed ? "Your interview time has changed" : `${round.name}: you're invited`,
                paragraphs: [
                    changed
                        ? `${club.name} has moved your ${round.name.toLowerCase()} for ${position.title}. Here are the new details.`
                        : `Good news, ${firstName(user)} — ${club.name} would like to meet you for the ${round.name.toLowerCase()} for ${position.title}.`,
                    round.instructions || null,
                    round.mode === ROUND_MODES.ONLINE
                        ? "Join a couple of minutes early from a quiet place with a working camera and microphone."
                        : "Please arrive 5 minutes early and carry your college ID card.",
                    "We'll remind you 1 hour and 10 minutes before it starts."
                ].filter(Boolean),
                details: interviewDetails(drive, position, round, slot, venue),
                action: interviewAction(drive, round)
            })
        });
    });

/** Reminder 60 or 10 minutes before a candidate's interview. */
const sendInterviewReminder = (drive, club, position, round, slot, user, venue, minutes) =>
    safely("reminder", async () => {
        const title = `Starts in ${minutes} minutes: ${round.name} (${position.title}) — ${club.name}`;
        await notify([user._id], {
            type: NOTIFICATION_TYPES.INTERVIEW_REMINDER,
            title,
            message: `${formatTime(slot.startAt)}${roundWhere(round, venue) ? ` · ${roundWhere(round, venue)}` : ""}`,
            link: round.mode === ROUND_MODES.ONLINE && round.meetingLink ? round.meetingLink : drivePath(drive)
        });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `interview-reminder:${round._id}:${user._id}:${minutes}`,
            compose: () => ({
                subject: title,
                heading: `Your ${round.name.toLowerCase()} starts in ${minutes} minutes`,
                paragraphs: [
                    minutes >= 60
                        ? `A quick reminder about your ${round.name.toLowerCase()} with ${club.name} at ${formatTime(slot.startAt)}. Take a moment to prepare — you've got this!`
                        : round.mode === ROUND_MODES.ONLINE
                          ? "It's almost time. Open the meeting link now so you're ready when it starts."
                          : "It's almost time. Please head to the venue now."
                ],
                details: interviewDetails(drive, position, round, slot, venue),
                action: interviewAction(drive, round)
            })
        });
    });

// ---------------------------------------------------------------- Results

const sendRoundResult = (drive, club, position, round, user, qualified) =>
    safely("round result", async () => {
        const title = qualified ? `Congratulations! You cleared ${round.name} (${position.title}) — ${club.name}` : `${club.name} recruitment: ${round.name} result (${position.title})`;
        await notify([user._id], {
            type: NOTIFICATION_TYPES.APPLICATION_UPDATE,
            title,
            message: qualified ? "You've qualified for the next stage. Details will follow." : "Thank you for taking part — keep going!",
            link: drivePath(drive)
        });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `round-result:${round._id}:${user._id}`,
            compose: () => ({
                subject: title,
                heading: qualified ? `You've cleared ${round.name}! 🎉` : "Thank you for your effort",
                paragraphs: qualified
                    ? [
                          `Congratulations, ${firstName(user)}! You've qualified in the ${round.name.toLowerCase()} for ${position.title}.`,
                          "The club will share the next step soon — keep an eye on your email.",
                          "Well done, and all the best for what's next!"
                      ]
                    : [
                          `Thank you for applying to be ${position.title} at ${club.name}, ${firstName(user)}. After careful consideration, you haven't been selected to move beyond the ${round.name.toLowerCase()} this time.`,
                          "This was a competitive round, and the effort you put in genuinely counts. Every interview is practice for the next one — keep building your skills, and do apply again when the club recruits next.",
                          `You're always welcome at ${club.name}'s events. We hope to see you there!`
                      ],
                action: { label: "View your application", url: drivePath(drive) }
            })
        });
    });

const offerDeadline = (date) => `${formatDate(date)}, ${formatTime(date)}`;

/** An offer to join in one role; the student accepts or declines on the drive page. */
const sendOffer = (drive, club, position, user, expiresAt) =>
    safely("offer", async () => {
        const title = `Offer: ${position.title} at ${club.name} 🎉`;
        await notify([user._id], {
            type: NOTIFICATION_TYPES.RECRUITMENT_OFFER,
            title,
            message: `Accept by ${offerDeadline(expiresAt)}.`,
            link: `${drivePath(drive)}?offer=1`
        });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `offer:${drive._id}:${user._id}:${position._id}:${new Date(expiresAt).getTime()}`,
            compose: () => ({
                subject: title,
                heading: `You've been offered ${position.title}!`,
                paragraphs: [
                    `Congratulations, ${firstName(user)}! After the selection rounds, ${club.name} would love you to join as ${position.title}.`,
                    `Please accept or decline by ${offerDeadline(expiresAt)}. If you also applied for other roles, you can join in only one: accepting this offer closes your other applications.`
                ],
                details: [
                    ["Role", position.title],
                    ["Answer by", offerDeadline(expiresAt)]
                ],
                action: { label: "Accept or decline", url: `${drivePath(drive)}?offer=1` }
            })
        });
    });

const sendReserve = (drive, club, position, user) =>
    safely("reserve", async () => {
        const title = `You're on the reserve list: ${position.title} — ${club.name}`;
        await notify([user._id], { type: NOTIFICATION_TYPES.APPLICATION_UPDATE, title, message: "If a seat frees up, you'll get an offer.", link: drivePath(drive) });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `reserve:${drive._id}:${user._id}:${position._id}`,
            compose: () => ({
                subject: title,
                heading: "You're on the reserve list",
                paragraphs: [
                    `Well done, ${firstName(user)} — you made it to the final stage for ${position.title}. The seats have been offered for now, and you're next in line.`,
                    "If a seat frees up, you'll get an offer straight away by email."
                ],
                action: { label: "View your application", url: drivePath(drive) }
            })
        });
    });

const sendNotSelected = (drive, club, user, positionTitle) =>
    safely("not selected", async () => {
        const title = `${club.name} recruitment: ${positionTitle}`;
        await notify([user._id], { type: NOTIFICATION_TYPES.APPLICATION_UPDATE, title, message: "Thank you for applying — see the message from the club.", link: drivePath(drive) });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `not-selected:${drive._id}:${user._id}:${positionTitle}`,
            compose: () => ({
                subject: title,
                heading: "Thank you for applying",
                paragraphs: [
                    `Thank you for your time and effort throughout ${club.name}'s ${drive.title}, ${firstName(user)}.`,
                    `We couldn't offer you the ${positionTitle} role this time — it was very close. Please don't be discouraged: keep learning, and apply again when the club recruits next.`,
                    `You're always welcome at ${club.name}'s events.`
                ],
                action: { label: "View your application", url: drivePath(drive) }
            })
        });
    });

/** The student accepted an offer: they're a member now, and their other applications were closed. */
const sendWelcome = (drive, club, user, positionTitle, closedTitles = []) =>
    safely("welcome", async () => {
        const title = `Welcome to ${club.name}! 🎉`;
        await notify([user._id], { type: NOTIFICATION_TYPES.APPLICATION_UPDATE, title, message: `You've joined as ${positionTitle}.`, link: `/clubs/${club._id}` });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `welcome:${drive._id}:${user._id}`,
            compose: () => ({
                subject: title,
                heading: `You're in — welcome to ${club.name}!`,
                paragraphs: [
                    `Congratulations, ${firstName(user)}! You've accepted the offer and joined ${club.name} as ${positionTitle}.`,
                    "You'll see the club in your dashboard, get member updates and can help run its events. The team will reach out about your first meeting.",
                    closedTitles.length ? `As you can hold one role, your applications for ${closedTitles.join(", ")} have been closed.` : null,
                    "Welcome aboard!"
                ].filter(Boolean),
                details: [["Role", positionTitle]],
                action: { label: `Open ${club.name}`, url: `/clubs/${club._id}` }
            })
        });
    });

const sendOfferExpired = (drive, club, position, user) =>
    safely("offer expired", async () => {
        const title = `Your ${position.title} offer has expired — ${club.name}`;
        await notify([user._id], { type: NOTIFICATION_TYPES.APPLICATION_UPDATE, title, message: "The deadline passed without an answer.", link: drivePath(drive) });
        await emailUsers([user._id], {
            category: ACCOUNT,
            dedupeKey: () => `offer-expired:${drive._id}:${user._id}:${position._id}`,
            compose: () => ({
                subject: title,
                heading: "Your offer has expired",
                paragraphs: [`The offer to join ${club.name} as ${position.title} wasn't answered in time, so the seat may go to someone else.`, "If you think this is a mistake, contact the club."],
                action: { label: "View your application", url: drivePath(drive) }
            })
        });
    });

const sendDriveCancelled = (drive, club, userIds, reason) =>
    safely("cancelled", async () => {
        const title = `${club.name} recruitment cancelled`;
        await notify(userIds, { type: NOTIFICATION_TYPES.APPLICATION_UPDATE, title, message: reason || "The club cancelled this recruitment drive.", link: drivePath(drive) });
        await emailUsers(userIds, {
            category: ACCOUNT,
            dedupeKey: (user) => `recruitment-cancelled:${drive._id}:${user._id}`,
            compose: () => ({
                subject: title,
                heading: `${drive.title} has been cancelled`,
                paragraphs: [`${club.name} has cancelled this recruitment drive, so your application is closed.`, reason ? `Reason: ${reason}` : null, "Thank you for your interest — we'll let you know when the club recruits again."].filter(
                    Boolean
                )
            })
        });
    });

module.exports = {
    recruitmentAudience,
    sendRecruitmentLaunch,
    sendApplicationReceived,
    sendInterviewInvite,
    sendInterviewReminder,
    sendRoundResult,
    sendOffer,
    sendReserve,
    sendNotSelected,
    sendWelcome,
    sendOfferExpired,
    sendDriveCancelled
};
