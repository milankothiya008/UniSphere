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
    MODERATE_GALLERY: "MODERATE_GALLERY",
    // Running recruitment drives (form, rounds, results, final selection): the president only.
    MANAGE_RECRUITMENT: "MANAGE_RECRUITMENT"
});

// Which roles hold which authorities is decided per club: see utils/ClubRoles.js and Club.roles.
module.exports = { CLUB_PERMISSIONS };
