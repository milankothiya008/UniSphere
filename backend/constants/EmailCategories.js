// Every email CampusConnect sends belongs to one category. Users can switch off the optional ones;
// ACCOUNT emails (verification codes, approvals, registration confirmations) always go out.
const EMAIL_CATEGORIES = Object.freeze({
    ACCOUNT: "account",
    CLUB_UPDATES: "clubUpdates",
    EVENT_RECOMMENDATIONS: "eventRecommendations",
    EVENT_ACTIVITY: "eventActivity",
    RECRUITMENT: "recruitment"
});

const EMAIL_PREFERENCES = Object.freeze([
    {
        key: EMAIL_CATEGORIES.CLUB_UPDATES,
        label: "Clubs you follow",
        description: "New events and announcements from clubs whose bell you turned on."
    },
    {
        key: EMAIL_CATEGORIES.EVENT_RECOMMENDATIONS,
        label: "New events for you",
        description: "Newly published campus events you are eligible to join."
    },
    {
        key: EMAIL_CATEGORIES.EVENT_ACTIVITY,
        label: "Your events",
        description: "Updates, cancellations and results for events you registered for."
    },
    {
        key: EMAIL_CATEGORIES.RECRUITMENT,
        label: "Club recruitment",
        description: "When a club you can join opens applications. Emails about your own applications always reach you."
    }
]);

const OPTIONAL_EMAIL_CATEGORIES = EMAIL_PREFERENCES.map((preference) => preference.key);

const EMAIL_JOB_STATUS = Object.freeze({
    PENDING: "PENDING",
    SENDING: "SENDING",
    SENT: "SENT",
    FAILED: "FAILED"
});

module.exports = { EMAIL_CATEGORIES, EMAIL_PREFERENCES, OPTIONAL_EMAIL_CATEGORIES, EMAIL_JOB_STATUS };
