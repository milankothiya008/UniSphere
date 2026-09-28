const { CLUB_ROLES } = require("./Roles");

const CLUB_PERMISSIONS = Object.freeze({
    MANAGE_CLUB: "MANAGE_CLUB",
    MANAGE_MEMBERS: "MANAGE_MEMBERS",
    ASSIGN_ROLES: "ASSIGN_ROLES",
    MANAGE_EVENTS: "MANAGE_EVENTS",
    PUBLISH_EVENTS: "PUBLISH_EVENTS",
    VIEW_PARTICIPANTS: "VIEW_PARTICIPANTS",
    MANAGE_PARTICIPANTS: "MANAGE_PARTICIPANTS",
    MANAGE_RESULTS: "MANAGE_RESULTS",
    // Publishing, withdrawing and correcting official results: the president only.
    PUBLISH_RESULTS: "PUBLISH_RESULTS",
    POST_UPDATES: "POST_UPDATES",
    // Opening and closing check-in at the door: the president only.
    MANAGE_CHECK_IN: "MANAGE_CHECK_IN",
    // Scanning tickets and marking attendance while check-in is open: every officer.
    MARK_ATTENDANCE: "MARK_ATTENDANCE",
    // Approving photos and videos for an event's gallery: president and vice-president.
    MODERATE_GALLERY: "MODERATE_GALLERY"
});

const P = CLUB_PERMISSIONS;

const CLUB_ROLE_PERMISSIONS = Object.freeze({
    [CLUB_ROLES.PRESIDENT]: Object.values(P),
    [CLUB_ROLES.VICE_PRESIDENT]: [
        P.MANAGE_MEMBERS,
        P.MANAGE_EVENTS,
        P.PUBLISH_EVENTS,
        P.VIEW_PARTICIPANTS,
        P.MANAGE_PARTICIPANTS,
        P.MANAGE_RESULTS,
        P.POST_UPDATES,
        P.MARK_ATTENDANCE,
        P.MODERATE_GALLERY
    ],
    [CLUB_ROLES.EVENT_COORDINATOR]: [
        P.MANAGE_EVENTS,
        P.VIEW_PARTICIPANTS,
        P.MANAGE_PARTICIPANTS,
        P.MANAGE_RESULTS,
        P.MARK_ATTENDANCE
    ],
    [CLUB_ROLES.MARKETING_COORDINATOR]: [P.POST_UPDATES, P.MARK_ATTENDANCE],
    [CLUB_ROLES.TECHNICAL_COORDINATOR]: [P.MANAGE_EVENTS, P.VIEW_PARTICIPANTS, P.MARK_ATTENDANCE],
    [CLUB_ROLES.TREASURER]: [P.VIEW_PARTICIPANTS, P.MARK_ATTENDANCE],
    [CLUB_ROLES.MEMBER]: []
});

const roleHasPermission = (role, permission) => {
    return (CLUB_ROLE_PERMISSIONS[role] || []).includes(permission);
};

module.exports = {
    CLUB_PERMISSIONS,
    CLUB_ROLE_PERMISSIONS,
    roleHasPermission
};
