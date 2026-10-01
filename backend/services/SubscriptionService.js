const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const ClubSubscription = require("../models/ClubSubscription");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_STATUS, MEMBERSHIP_STATUS } = require("../constants/Statuses");

// The club "bell", like YouTube's: with it on, a user is emailed the club's new events and
// announcements. Members are subscribed by default and can switch it off; anyone else can switch it on.

const ids = (list) => list.map((id) => String(id));

const approvedMemberIds = async (clubId) =>
    ids((await ClubMembership.find({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED }).select("user")).map((m) => m.user));

// Everyone whose bell is on for this club. membersOnly limits it to members (for members-only posts).
const clubFollowerIds = async (clubId, { membersOnly = false } = {}) => {
    const [members, choices] = await Promise.all([approvedMemberIds(clubId), ClubSubscription.find({ club: clubId }).select("user enabled")]);

    const optedOut = new Set(ids(choices.filter((choice) => !choice.enabled).map((choice) => choice.user)));
    const followers = new Set(members.filter((id) => !optedOut.has(id)));

    if (!membersOnly) {
        choices.filter((choice) => choice.enabled).forEach((choice) => followers.add(String(choice.user)));
    }

    return [...followers];
};

// People who explicitly switched this club off; they should not hear from it through other routes either.
const optedOutIds = async (clubId) =>
    ids((await ClubSubscription.find({ club: clubId, enabled: false }).select("user")).map((choice) => choice.user));

/** The ids (as strings) of the given clubs that this user follows. */
const followedAmong = async (userId, clubIds) => {
    if (!clubIds.length) return new Set();
    const [memberships, choices] = await Promise.all([
        ClubMembership.find({ user: userId, club: { $in: clubIds }, status: MEMBERSHIP_STATUS.APPROVED }).select("club").lean(),
        ClubSubscription.find({ user: userId, club: { $in: clubIds } }).select("club enabled").lean()
    ]);
    const choice = new Map(choices.map((row) => [String(row.club), row.enabled]));
    const followed = new Set(choices.filter((row) => row.enabled).map((row) => String(row.club)));
    memberships.forEach((membership) => {
        if (choice.get(String(membership.club)) !== false) followed.add(String(membership.club));
    });
    return followed;
};

const followerCount = async (clubId) => (await clubFollowerIds(clubId)).length;

const isSubscribed = async (userId, clubId) => {
    const [choice, member] = await Promise.all([
        ClubSubscription.findOne({ club: clubId, user: userId }).select("enabled"),
        ClubMembership.exists({ club: clubId, user: userId, status: MEMBERSHIP_STATUS.APPROVED })
    ]);
    return choice ? choice.enabled : Boolean(member);
};

const subscriptionSummary = async (actor, clubId) => {
    const [subscribed, user, followers] = await Promise.all([
        isSubscribed(actor._id, clubId),
        User.findById(actor._id).select("emailPreferences"),
        followerCount(clubId)
    ]);
    return {
        subscribed,
        // The bell only sends email while the "Clubs you follow" email setting is on.
        emailsEnabled: user?.emailPreferences?.clubUpdates !== false,
        followerCount: followers
    };
};

const getSubscription = async (actor, clubId) => {
    const club = await Club.findById(clubId).select("status");
    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return subscriptionSummary(actor, club._id);
};

const setSubscription = async (actor, clubId, enabled) => {
    const club = await Club.findById(clubId).select("status name");
    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    // Switching the bell off always works; switching it on needs a club that is running.
    if (enabled && club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("You can only turn on notifications for active clubs", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    }

    await ClubSubscription.updateOne({ club: club._id, user: actor._id }, { $set: { enabled: Boolean(enabled) } }, { upsert: true });
    return subscriptionSummary(actor, club._id);
};

// Clubs whose bell is on for this user, for the notification settings page.
const listMySubscriptions = async (actor) => {
    const [memberships, choices] = await Promise.all([
        ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club"),
        ClubSubscription.find({ user: actor._id }).select("club enabled")
    ]);

    const choiceByClub = new Map(choices.map((choice) => [String(choice.club), choice.enabled]));
    const memberOf = new Set(ids(memberships.map((m) => m.club)));
    const clubIds = [...new Set([...memberOf, ...choiceByClub.keys()])].filter((id) => choiceByClub.get(id) ?? memberOf.has(id));

    const clubs = await Club.find({ _id: { $in: clubIds } }).select("name logo category status").sort({ name: 1 });
    return clubs.map((club) => ({ club, isMember: memberOf.has(String(club._id)) }));
};

// Used by one-click unsubscribe links: switches the bell off without needing the club to be active.
const turnOffForUser = async (userId, clubId) => {
    const club = await Club.findById(clubId).select("name");
    if (!club) {
        return null;
    }
    await ClubSubscription.updateOne({ club: club._id, user: userId }, { $set: { enabled: false } }, { upsert: true });
    return club;
};

module.exports = {
    followedAmong,
    clubFollowerIds,
    optedOutIds,
    followerCount,
    isSubscribed,
    getSubscription,
    setSubscription,
    listMySubscriptions,
    turnOffForUser
};
