export const ROLES = {
    STUDENT: "STUDENT",
    FACULTY: "FACULTY",
    ADMIN: "ADMIN"
};

export const ROLE_LABELS = {
    STUDENT: "Student",
    FACULTY: "Faculty",
    ADMIN: "University Admin"
};

export const CLUB_ROLES = [
    "PRESIDENT",
    "VICE_PRESIDENT",
    "EVENT_COORDINATOR",
    "MARKETING_COORDINATOR",
    "TECHNICAL_COORDINATOR",
    "TREASURER",
    "MEMBER"
];

export const ASSIGNABLE_CLUB_ROLES = CLUB_ROLES.filter((role) => role !== "PRESIDENT");

export const CLUB_ROLE_DESCRIPTIONS = {
    PRESIDENT: "Full club management, publishes results",
    VICE_PRESIDENT: "Members, events, publishing, participants, result drafts, posts",
    EVENT_COORDINATOR: "Events, participants and result drafts",
    MARKETING_COORDINATOR: "Club announcements and updates",
    TECHNICAL_COORDINATOR: "Event drafts and participant lists",
    TREASURER: "View participant lists",
    MEMBER: "Basic club access"
};

export const PERMISSIONS = {
    MANAGE_CLUB: "MANAGE_CLUB",
    MANAGE_MEMBERS: "MANAGE_MEMBERS",
    ASSIGN_ROLES: "ASSIGN_ROLES",
    MANAGE_EVENTS: "MANAGE_EVENTS",
    PUBLISH_EVENTS: "PUBLISH_EVENTS",
    VIEW_PARTICIPANTS: "VIEW_PARTICIPANTS",
    MANAGE_PARTICIPANTS: "MANAGE_PARTICIPANTS",
    MANAGE_RESULTS: "MANAGE_RESULTS",
    PUBLISH_RESULTS: "PUBLISH_RESULTS",
    MANAGE_CHECK_IN: "MANAGE_CHECK_IN",
    MARK_ATTENDANCE: "MARK_ATTENDANCE",
    MODERATE_GALLERY: "MODERATE_GALLERY",
    MANAGE_RECRUITMENT: "MANAGE_RECRUITMENT",
    POST_UPDATES: "POST_UPDATES"
};

export const CLUB_CATEGORIES = [
    "TECHNOLOGY",
    "SPORTS",
    "CULTURAL",
    "LITERARY",
    "MUSIC",
    "ART",
    "SOCIAL_SERVICE",
    "ENTREPRENEURSHIP",
    "OTHER"
];

export const EVENT_CATEGORIES = [
    "TECHNOLOGY",
    "SPORTS",
    "CULTURAL",
    "LITERARY",
    "MUSIC",
    "ART",
    "SOCIAL_SERVICE",
    "ENTREPRENEURSHIP",
    "WORKSHOP",
    "SEMINAR",
    "COMPETITION",
    "OTHER"
];

export const FEED_TYPES = ["EVENT", "ANNOUNCEMENT", "EVENT_UPDATE", "RESULT", "CLUB_UPDATE"];

// Status → [label, badge tone]
export const STATUS_STYLES = {
    DRAFT: ["Draft", "neutral"],
    PENDING_APPROVAL: ["Awaiting approval", "warning"],
    NEEDS_CHANGES: ["Changes requested", "violet"],
    APPROVED: ["Approved", "info"],
    PUBLISHED: ["Published", "success"],
    REJECTED: ["Rejected", "danger"],
    CANCELLED: ["Cancelled", "danger"],
    COMPLETED: ["Completed", "ink"],
    PENDING_FACULTY_REVIEW: ["Faculty review", "warning"],
    FACULTY_VERIFIED: ["Awaiting admin", "info"],
    ACTIVE: ["Active", "success"],
    SUSPENDED: ["Suspended", "danger"],
    ARCHIVED: ["Archived", "neutral"],
    PENDING: ["Pending", "warning"],
    REGISTERED: ["Registered", "success"],
    WAITLISTED: ["Waitlisted", "warning"],
    CHECKED_IN: ["Checked in", "success"],
    OPEN: ["Registration open", "success"],
    NOT_OPEN: ["Opens soon", "info"],
    CLOSED: ["Registration closed", "neutral"],
    FULL: ["Full", "danger"],
    INACTIVE: ["Inactive", "neutral"]
};

// Where a recruitment drive stands (the API's `phase`) → [label, badge tone].
export const RECRUITMENT_PHASES = {
    DRAFT: ["Draft", "neutral"],
    PENDING_APPROVAL: ["With faculty mentor", "warning"],
    NEEDS_CHANGES: ["Changes requested", "violet"],
    APPROVED: ["Approved · not published", "info"],
    REJECTED: ["Not approved", "danger"],
    UPCOMING: ["Opens soon", "info"],
    OPEN: ["Applications open", "success"],
    CLOSED: ["Applications closed", "neutral"],
    ROUNDS: ["Selection rounds", "violet"],
    COMPLETED: ["Completed", "ink"],
    CANCELLED: ["Cancelled", "danger"]
};

export const APPLICATION_STATUSES = {
    APPLIED: ["Applied", "info"],
    IN_ROUNDS: ["In selection", "violet"],
    SELECTED: ["Selected", "success"],
    ELIMINATED: ["Not shortlisted", "neutral"],
    NOT_SELECTED: ["Not selected", "neutral"],
    WITHDRAWN: ["Withdrawn", "neutral"]
};

export const QUESTION_TYPES = [
    { value: "SHORT", label: "Short answer" },
    { value: "PARAGRAPH", label: "Paragraph" },
    { value: "SINGLE_CHOICE", label: "Multiple choice (one)" },
    { value: "MULTI_CHOICE", label: "Checkboxes (several)" },
    { value: "LINK", label: "Link (portfolio, GitHub…)" },
    { value: "FILE", label: "File upload (PDF or image)" }
];

export const ROUND_MODES = {
    SCREENING: { label: "Screening", hint: "Review applications — no meeting" },
    ONLINE: { label: "Online interview", hint: "Candidates join a meeting link" },
    OFFLINE: { label: "Offline interview", hint: "Candidates come to a campus venue" }
};

export const FEED_TYPE_LABELS = {
    EVENT: "New event",
    ANNOUNCEMENT: "Announcement",
    EVENT_UPDATE: "Event update",
    RESULT: "Results",
    CLUB_UPDATE: "Club update"
};
