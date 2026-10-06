const mongoose = require("mongoose");
const User = require("../models/User");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { ACCOUNT_TYPES } = require("../constants/Roles");
const { ANNOUNCEMENT_AUDIENCE: A, FEED_VISIBILITY, MEMBERSHIP_STATUS } = require("../constants/Statuses");
const { findRole, roleName } = require("../utils/ClubRoles");
const { approvedMemberIds } = require("./MembershipService");
const { clubFollowerIds } = require("./SubscriptionService");

// Who a club announcement goes to. The club picks the audience instead of every message reaching the
// whole university:
//   EVERYONE   — the whole campus in-app (the followers also by email and on their phones)
//   FOLLOWERS  — people who follow the club (bell on): in-app, phone and email
//   MEMBERS    — the club's members and its mentor (members with the bell on also by email)
//   CUSTOM     — any mix of: club roles, students of chosen departments/batches, chosen people,
//                and the faculty mentor. Only they get it (in-app, phone, and email unless switched off).

const MAX_PEOPLE = 200;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const ids = (list) => [...new Set((list || []).filter(Boolean).map((id) => String(id._id || id)))];
const codes = (list) =>
    [
        ...new Set(
            (Array.isArray(list) ? list : [])
                .map((code) =>
                    String(code || "")
                        .trim()
                        .toUpperCase()
                )
                .filter(Boolean)
        )
    ].slice(0, 30);

/** Normalises what the client sent; the old visibility field still works (PUBLIC → everyone, MEMBERS → members). */
const parseAudience = (club, payload = {}) => {
    const raw = payload.audience && typeof payload.audience === "object" ? payload.audience : {};
    const mode = Object.values(A).includes(raw.mode) ? raw.mode : payload.visibility === FEED_VISIBILITY.MEMBERS ? A.MEMBERS : A.EVERYONE;
    if (mode !== A.CUSTOM) return { mode };

    const roles = [...new Set((Array.isArray(raw.roles) ? raw.roles : []).map(String))];
    if (roles.some((key) => !findRole(club, key))) throw invalid("One of the chosen roles doesn't exist in this club");
    const people = ids(Array.isArray(raw.users) ? raw.users : []).filter((id) => mongoose.isValidObjectId(id));
    if (people.length > MAX_PEOPLE) throw invalid(`Choose at most ${MAX_PEOPLE} people — or pick a role or department instead`);
    const audience = {
        mode,
        roles,
        departments: codes(raw.departments),
        batches: codes(raw.batches),
        users: people,
        includeMentor: Boolean(raw.includeMentor)
    };
    if (!audience.roles.length && !audience.departments.length && !audience.batches.length && !audience.users.length && !audience.includeMentor) {
        throw invalid("Choose who should get this announcement");
    }
    return audience;
};

/** The people a CUSTOM audience reaches (active, verified accounts only). */
const customRecipients = async (club, audience) => {
    const [roleHolders, students, people] = await Promise.all([
        audience.roles.length
            ? ClubMembership.find({ club: club._id, status: MEMBERSHIP_STATUS.APPROVED, role: { $in: audience.roles } })
                  .select("user")
                  .lean()
            : [],
        audience.departments.length || audience.batches.length
            ? User.find({
                  accountType: ACCOUNT_TYPES.STUDENT,
                  isActive: true,
                  isEmailVerified: true,
                  ...(audience.departments.length ? { departmentCode: { $in: audience.departments } } : {}),
                  ...(audience.batches.length ? { batchCode: { $in: audience.batches } } : {})
              })
                  .select("_id")
                  .lean()
            : [],
        audience.users.length
            ? User.find({ _id: { $in: audience.users }, isActive: true, isEmailVerified: true })
                  .select("_id")
                  .lean()
            : []
    ]);
    const chosen = ids([
        ...roleHolders.map((row) => row.user),
        ...students.map((user) => user._id),
        ...people.map((user) => user._id),
        audience.includeMentor ? club.mentor : null
    ]);
    if (!chosen.length) return [];
    // Role holders and the mentor are known accounts; make sure everyone is still active and verified.
    return ids(
        (
            await User.find({ _id: { $in: chosen }, isActive: true, isEmailVerified: true })
                .select("_id")
                .lean()
        ).map((user) => user._id)
    );
};

/**
 * Everything createPost needs: the post's visibility, who is notified in-app (null = the whole campus),
 * who also gets a phone notification, and who is emailed.
 */
const resolveAudience = async (club, audience) => {
    if (audience.mode === A.EVERYONE) {
        const followers = await clubFollowerIds(club._id);
        return { visibility: FEED_VISIBILITY.PUBLIC, notifyTo: null, pushTo: followers, emailTo: followers };
    }
    if (audience.mode === A.FOLLOWERS) {
        const followers = await clubFollowerIds(club._id);
        return { visibility: FEED_VISIBILITY.PUBLIC, notifyTo: followers, pushTo: followers, emailTo: followers };
    }
    if (audience.mode === A.MEMBERS) {
        const [members, followingMembers] = await Promise.all([approvedMemberIds(club._id), clubFollowerIds(club._id, { membersOnly: true })]);
        const everyone = ids([...members, club.mentor]);
        return { visibility: FEED_VISIBILITY.MEMBERS, notifyTo: everyone, pushTo: everyone, emailTo: followingMembers };
    }
    const recipients = await customRecipients(club, audience);
    return { visibility: FEED_VISIBILITY.AUDIENCE, notifyTo: recipients, pushTo: recipients, emailTo: recipients, recipients };
};

/** A short description for the post ("Vice-president, Treasurer · CE 2024 · 3 people"). */
const describeAudience = (club, audience) => {
    if (audience.mode !== A.CUSTOM) return null;
    const parts = [];
    if (audience.roles.length) parts.push(audience.roles.map((key) => roleName(club, key)).join(", "));
    if (audience.departments.length || audience.batches.length) {
        parts.push(
            `Students${audience.departments.length ? ` of ${audience.departments.join(", ")}` : ""}${audience.batches.length ? ` (batch ${audience.batches.join(", ")})` : ""}`
        );
    }
    if (audience.users.length) parts.push(`${audience.users.length} ${audience.users.length === 1 ? "person" : "people"}`);
    if (audience.includeMentor) parts.push("Faculty mentor");
    return parts.join(" · ");
};

/** How many people an audience reaches, shown in the composer before sending. */
const countAudience = async (club, audience) => {
    if (audience.mode === A.EVERYONE) {
        return { count: await User.countDocuments({ isActive: true, isEmailVerified: true }), email: (await clubFollowerIds(club._id)).length };
    }
    const resolved = await resolveAudience(club, audience);
    return { count: resolved.notifyTo.length, email: resolved.emailTo.length };
};

// ---------------------------------------------------------------- Who hears about campus activity
// Instead of notifying every account on campus, news goes to the people it concerns. The campus feed
// still shows every event and result to everyone.

/** A new or changed event: the club's followers and members, and the students the event is open to — minus anyone who muted the club. */
const eventAudience = async (event, clubId) => {
    const { eligibleStudentIds } = require("./CampusMailer");
    const { optedOutIds } = require("./SubscriptionService");
    const [followers, members, eligible, muted] = await Promise.all([
        clubFollowerIds(clubId),
        approvedMemberIds(clubId),
        eligibleStudentIds(event),
        optedOutIds(clubId)
    ]);
    const skip = new Set(muted);
    return ids([...followers, ...members, ...eligible.filter((id) => !skip.has(id))]);
};

/** The people involved in an event: registered or waitlisted. */
const eventParticipantIds = async (eventId) => {
    const EventRegistration = require("../models/EventRegistration");
    const { REGISTRATION_STATUS } = require("../constants/Statuses");
    return ids(
        (
            await EventRegistration.find({ event: eventId, status: { $in: [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED] } })
                .select("user")
                .lean()
        ).map((row) => row.user)
    );
};

/** A new club: the students and faculty of the departments it is open to (everyone for all-department clubs). */
const clubScopeAudience = async (club) => {
    const filter = { isActive: true, isEmailVerified: true };
    if (!club.allDepartments && club.departmentCodes?.length) filter.departmentCode = { $in: club.departmentCodes };
    return ids((await User.find(filter).select("_id").lean()).map((user) => user._id));
};

module.exports = { parseAudience, resolveAudience, describeAudience, countAudience, eventAudience, eventParticipantIds, clubScopeAudience };
