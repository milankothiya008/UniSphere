const mongoose = require("mongoose");
const { CLUB_PERMISSIONS: P } = require("../constants/Permissions");

// Club roles are defined per club (Club.roles). Three are built in and exist in every club:
//   PRESIDENT       — every authority; exactly one; handed over, never assigned like other roles.
//   VICE_PRESIDENT  — at most one; the president chooses its authorities.
//   MEMBER          — no authorities.
// Everything else is a custom role the president creates, with a name and chosen authorities.
// Authorities in PRESIDENT_ONLY can never be given to another role.

const SYSTEM = Object.freeze({ PRESIDENT: "PRESIDENT", VICE_PRESIDENT: "VICE_PRESIDENT", MEMBER: "MEMBER" });

const PRESIDENT_ONLY = Object.freeze([P.MANAGE_CLUB, P.ASSIGN_ROLES, P.MANAGE_RECRUITMENT, P.PUBLISH_RESULTS, P.MANAGE_CHECK_IN]);

const GRANTABLE = Object.freeze(Object.values(P).filter((permission) => !PRESIDENT_ONLY.includes(permission)));

// Roles every new club starts with. The starter roles keep the keys clubs used before roles became
// per-club, so existing memberships keep their meaning; presidents can rename or delete them.
const DEFAULT_ROLES = () => [
    { key: SYSTEM.PRESIDENT, name: "President", description: "Leads the club. Holds every authority.", permissions: Object.values(P), system: true, order: 0 },
    {
        key: SYSTEM.VICE_PRESIDENT,
        name: "Vice-president",
        description: "Second in command.",
        permissions: [P.MANAGE_MEMBERS, P.MANAGE_EVENTS, P.PUBLISH_EVENTS, P.VIEW_PARTICIPANTS, P.MANAGE_PARTICIPANTS, P.MANAGE_RESULTS, P.POST_UPDATES, P.MARK_ATTENDANCE, P.MODERATE_GALLERY],
        system: true,
        order: 1
    },
    {
        key: "EVENT_COORDINATOR",
        name: "Event coordinator",
        description: "Plans events and runs them on the day.",
        permissions: [P.MANAGE_EVENTS, P.VIEW_PARTICIPANTS, P.MANAGE_PARTICIPANTS, P.MANAGE_RESULTS, P.MARK_ATTENDANCE],
        system: false,
        order: 2
    },
    { key: "MARKETING_COORDINATOR", name: "Marketing coordinator", description: "Announcements, posters and social media.", permissions: [P.POST_UPDATES, P.MARK_ATTENDANCE], system: false, order: 3 },
    { key: "TECHNICAL_COORDINATOR", name: "Technical coordinator", description: "Technical side of events.", permissions: [P.MANAGE_EVENTS, P.VIEW_PARTICIPANTS, P.MARK_ATTENDANCE], system: false, order: 4 },
    { key: "TREASURER", name: "Treasurer", description: "Budgets and registrations.", permissions: [P.VIEW_PARTICIPANTS, P.MARK_ATTENDANCE], system: false, order: 5 },
    { key: SYSTEM.MEMBER, name: "Member", description: "Part of the club.", permissions: [], system: true, order: 99 }
];

/** The club's roles, falling back to the defaults for clubs stored before roles were per-club. */
const rolesOf = (club) => (club?.roles?.length ? club.roles : DEFAULT_ROLES());

const findRole = (club, key) => rolesOf(club).find((role) => role.key === key) || null;

/** Authorities of a role in this club. The president always holds every authority. */
const permissionsFor = (club, key) => {
    if (!key) {
        return [];
    }
    if (key === SYSTEM.PRESIDENT) {
        return Object.values(P);
    }
    return [...(findRole(club, key)?.permissions || [])].filter((permission) => GRANTABLE.includes(permission));
};

const roleName = (club, key) => findRole(club, key)?.name || (key ? String(key).replace(/_/g, " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()) : null);

/** Keys of the roles in this club that hold a permission (always including the president). */
const keysWith = (club, permission) => rolesOf(club).filter((role) => permissionsFor(club, role.key).includes(permission)).map((role) => role.key);

const sortedRoles = (club) => [...rolesOf(club)].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

/** Order of a membership in member lists: president, vice-president, custom roles, members. */
const roleRank = (club, key) => {
    const index = sortedRoles(club).findIndex((role) => role.key === key);
    return index === -1 ? 50 : index;
};

const newRoleKey = () => `R_${new mongoose.Types.ObjectId().toString()}`;

module.exports = { SYSTEM, PRESIDENT_ONLY, GRANTABLE, DEFAULT_ROLES, rolesOf, findRole, permissionsFor, roleName, keysWith, sortedRoles, roleRank, newRoleKey };
