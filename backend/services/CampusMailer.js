const User = require("../models/User");
const Venue = require("../models/Venue");
const EventRegistration = require("../models/EventRegistration");
const logger = require("../utils/Logger");
const { emailUsers } = require("./NotificationService");
const { clubFollowerIds, optedOutIds } = require("./SubscriptionService");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { ACCOUNT_TYPES } = require("../constants/Roles");
const { REGISTRATION_STATUS } = require("../constants/Statuses");
const { formatDate, formatSchedule, formatTime } = require("../utils/CampusTime");

// Campaign emails for the moments people care about. Each person gets at most one copy of each
// (dedupe keys), in the most relevant wording, and only if their email settings allow it.

const ids = (list) => list.map((id) => String(id));

const batchLabel = (code) => `20${code}`;

const audienceLabel = (event) => {
    const departments = event.eligibility?.departments || [];
    const batches = event.eligibility?.batches || [];
    if (!departments.length && !batches.length) {
        return "All students";
    }
    return [departments.length ? departments.join(", ") : null, batches.length ? `batch ${batches.map(batchLabel).join(", ")}` : null]
        .filter(Boolean)
        .join(" · ");
};

// Students who could register for the event (same rule as RegistrationService.eligibilityProblem).
const eligibleStudentIds = async (event) => {
    const filter = { accountType: ACCOUNT_TYPES.STUDENT, isActive: true, isEmailVerified: true };
    if (event.eligibility?.departments?.length) {
        filter.departmentCode = { $in: event.eligibility.departments };
    }
    if (event.eligibility?.batches?.length) {
        filter.batchCode = { $in: event.eligibility.batches };
    }
    return ids((await User.find(filter).select("_id").lean()).map((user) => user._id));
};

const eventDetails = (event, venue) => [
    ["When", formatSchedule(event.startAt, event.endAt)],
    ["Where", venue ? `${venue.name}, ${venue.location}` : null],
    ["Register by", `${formatDate(event.registrationEnd)}, ${formatTime(event.registrationEnd)}`],
    ["Open to", audienceLabel(event)],
    ["Seats", event.maxParticipants ? `${event.maxParticipants} places` : null]
];

// New event: the club's followers hear it from the club; other eligible students get it as a recommendation.
const sendEventLaunchEmails = async (event, club, actor) => {
    const venue = await Venue.findById(event.venue).select("name location");
    const [followers, mutedClub] = await Promise.all([clubFollowerIds(club._id), optedOutIds(club._id)]);
    // Followers hear it from the club; anyone who muted this club is not re-targeted as a "recommendation".
    const skip = new Set([...followers, ...mutedClub]);
    const eligible = (await eligibleStudentIds(event)).filter((id) => !skip.has(id));

    const shared = {
        heading: event.title,
        image: event.poster,
        details: eventDetails(event, venue),
        action: { label: "View event & register", url: `/events/${event._id}` }
    };
    const dedupeKey = (user) => `event-published:${event._id}:${user._id}`;

    const toFollowers = await emailUsers(followers, {
        category: EMAIL_CATEGORIES.CLUB_UPDATES,
        exclude: [actor._id],
        dedupeKey,
        compose: () => ({
            ...shared,
            subject: `${club.name} just announced: ${event.title}`,
            paragraphs: [event.shortDescription],
            reason: `You're receiving this because notifications are on for ${club.name}.`,
            club
        })
    });

    const toEligible = await emailUsers(eligible, {
        category: EMAIL_CATEGORIES.EVENT_RECOMMENDATIONS,
        exclude: [actor._id],
        dedupeKey,
        compose: () => ({
            ...shared,
            subject: `New event you can join: ${event.title}`,
            paragraphs: [`${club.name} is hosting a new event that's open to you.`, event.shortDescription],
            reason: "You're receiving this because this event is open to your department and batch."
        })
    });

    logger.info("Event launch emails queued", { eventId: String(event._id), followers: toFollowers, recommendations: toEligible });
};

const winnerLine = (award) => [award.title, award.teamName || award.recipientName].filter(Boolean).join(": ");

// Results: winners get a personal congratulations, participants the results, members the club news.
const sendResultEmails = async (event, result, club, actor) => {
    const registrations = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED }).select("user");
    const participants = ids(registrations.map((registration) => registration.user));

    const awards = [...result.awards].sort((a, b) => (a.position || 99) - (b.position || 99));
    const awardByWinner = new Map();
    awards.forEach((award) => {
        if (award.recipientUser && !awardByWinner.has(String(award.recipientUser))) {
            awardByWinner.set(String(award.recipientUser), award);
        }
    });

    const winners = [...awardByWinner.keys()];
    const notified = new Set(winners);
    const others = participants.filter((id) => !notified.has(id));
    others.forEach((id) => notified.add(id));
    const members = (await clubFollowerIds(club._id, { membersOnly: true })).filter((id) => !notified.has(id));

    const shared = {
        heading: `Results: ${event.title}`,
        details: awards.slice(0, 5).map((award) => [award.position ? `#${award.position}` : "Award", winnerLine(award)]),
        action: { label: "See full results", url: `/results/${event._id}` }
    };
    const dedupeKey = (user) => `results:${event._id}:${user._id}`;
    const summary = result.summary ? [result.summary.slice(0, 600)] : [];

    await emailUsers(winners, {
        category: EMAIL_CATEGORIES.EVENT_ACTIVITY,
        exclude: [actor._id],
        dedupeKey,
        compose: (user) => {
            const award = awardByWinner.get(String(user._id));
            return {
                ...shared,
                subject: `Congratulations! ${award.title} at ${event.title}`,
                heading: `Congratulations, you won ${award.title}!`,
                paragraphs: [
                    `${club.name} has published the results of ${event.title}, and you're among the winners.`,
                    award.prize ? `Prize: ${award.prize}` : null,
                    ...summary
                ].filter(Boolean),
                reason: `You're receiving this because you took part in ${event.title}.`
            };
        }
    });

    await emailUsers(others, {
        category: EMAIL_CATEGORIES.EVENT_ACTIVITY,
        exclude: [actor._id],
        dedupeKey,
        compose: () => ({
            ...shared,
            subject: `Results are out: ${event.title}`,
            paragraphs: [`Thanks for taking part! ${club.name} has published the results.`, ...summary],
            reason: `You're receiving this because you registered for ${event.title}.`
        })
    });

    await emailUsers(members, {
        category: EMAIL_CATEGORIES.CLUB_UPDATES,
        exclude: [actor._id],
        dedupeKey,
        compose: () => ({
            ...shared,
            subject: `${club.name} results: ${event.title}`,
            paragraphs: [`The results of ${event.title} are now published.`, ...summary],
            reason: `You're receiving this because you're a member of ${club.name}.`,
            club
        })
    });
};

const entryName = (entry) => entry.teamName || entry.recipientName || "—";

// A round's results go to everyone registered; people named as qualifying get a personal
// "you're through" version.
const sendRoundResultEmails = async (event, round, club, actor) => {
    const registrations = await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED }).select("user");
    const participants = ids(registrations.map((registration) => registration.user));
    const qualifiedUsers = new Set(round.entries.filter((entry) => entry.qualified === true && entry.recipientUser).map((entry) => String(entry.recipientUser)));
    const qualifiedCount = round.entries.filter((entry) => entry.qualified === true).length;

    const shared = {
        heading: `${round.name}: ${event.title}`,
        details: round.entries
            .slice(0, 5)
            .map((entry) => [entry.rank ? `#${entry.rank}` : "•", [entryName(entry), entry.score].filter(Boolean).join(" · ")]),
        action: { label: "See the standings", url: `/results/${event._id}` },
        reason: `You're receiving this because you registered for ${event.title}.`
    };
    const dedupeKey = (user) => `round:${round._id}:${user._id}`;

    await emailUsers(
        participants.filter((id) => qualifiedUsers.has(id)),
        {
            category: EMAIL_CATEGORIES.EVENT_ACTIVITY,
            exclude: [actor._id],
            dedupeKey,
            compose: () => ({
                ...shared,
                subject: `You're through! ${round.name} results for ${event.title}`,
                paragraphs: [`Great work — you've qualified from ${round.name}. ${club.name} will share what's next.`, round.description].filter(Boolean)
            })
        }
    );

    await emailUsers(
        participants.filter((id) => !qualifiedUsers.has(id)),
        {
            category: EMAIL_CATEGORIES.EVENT_ACTIVITY,
            exclude: [actor._id],
            dedupeKey,
            compose: () => ({
                ...shared,
                subject: `${round.name} results are out: ${event.title}`,
                paragraphs: [
                    `${club.name} has published the results of ${round.name}.`,
                    qualifiedCount ? `${qualifiedCount} ${qualifiedCount === 1 ? "entry goes" : "entries go"} through to the next round.` : null,
                    round.description
                ].filter(Boolean)
            })
        }
    );
};

// Announcements go to the club's followers (members only, for members-only posts).
// recipients: who to email (chosen by AudienceService); audience: how they were chosen, for the footer.
const AUDIENCE_REASON = {
    EVERYONE: (club) => `You're receiving this because notifications are on for ${club.name}.`,
    FOLLOWERS: (club) => `You're receiving this because notifications are on for ${club.name}.`,
    MEMBERS: (club) => `You're receiving this members-only update because you're in ${club.name}.`,
    CUSTOM: (club) => `${club.name} sent this to you directly.`
};

const sendAnnouncementEmails = async (post, club, actor, { audience = "EVERYONE", recipients = null, link }) => {
    const followers = recipients || (await clubFollowerIds(club._id, { membersOnly: audience === "MEMBERS" }));
    const paragraphs = String(post.body || "")
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .slice(0, 8);

    await emailUsers(followers, {
        category: EMAIL_CATEGORIES.CLUB_UPDATES,
        exclude: [actor._id],
        dedupeKey: (user) => `announcement:${post._id}:${user._id}`,
        compose: () => ({
            subject: `${club.name}: ${post.title}`,
            heading: post.title,
            paragraphs,
            image: post.image,
            action: { label: "Open in CampusConnect", url: link },
            reason: (AUDIENCE_REASON[audience] || AUDIENCE_REASON.EVERYONE)(club),
            club
        })
    });
};

// Emails are a side effect: a failure here is logged and must never undo the publish that triggered it.
const safely = (name, send) => async (...args) => {
    try {
        await send(...args);
    } catch (error) {
        logger.error(`Failed to queue ${name} emails`, { message: error.message });
    }
};

module.exports = {
    sendEventLaunchEmails: safely("event launch", sendEventLaunchEmails),
    sendResultEmails: safely("result", sendResultEmails),
    sendRoundResultEmails: safely("round result", sendRoundResultEmails),
    sendAnnouncementEmails: safely("announcement", sendAnnouncementEmails),
    eligibleStudentIds
};
