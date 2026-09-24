const { body, oneOf, param, query } = require("express-validator");
const { CLUB_CATEGORIES, EVENT_CATEGORIES } = require("../constants/Categories");
const { CLUB_ROLES } = require("../constants/Roles");
const { CLUB_STATUS, FEED_POST_TYPES, FEED_VISIBILITY } = require("../constants/Statuses");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

const passwordRule = (field) =>
    body(field)
        .isString()
        .isLength({ min: 8, max: 128 })
        .withMessage("Password must be 8-128 characters")
        .matches(/[A-Za-z]/)
        .withMessage("Password must include a letter")
        .matches(/\d/)
        .withMessage("Password must include a number");

const optionalUrl = (field) =>
    body(field)
        .optional({ values: "null" })
        .isString()
        .custom((value) => value === "" || /^(https?:\/\/|\/uploads\/)/i.test(value))
        .withMessage(`${field} must be an http(s) URL or an uploaded file`);

const registerRules = [
    body("name").isString().trim().isLength({ min: 2, max: 80 }).withMessage("Name must be 2-80 characters"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("accountType").isIn(["STUDENT", "FACULTY"]).withMessage("Choose whether you are registering as a student or faculty"),
    passwordRule("password")
];

const loginRules = [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").isString().notEmpty().withMessage("Password is required")
];

const emailRules = [body("email").isEmail().withMessage("Valid email is required")];

const otpRules = [
    body("email").isEmail().withMessage("Valid email is required"),
    body("code").isString().trim().matches(/^\d{6}$/).withMessage("Enter the 6-digit code from your email")
];

const resetPasswordRules = [
    body("token").isString().isLength({ min: 20, max: 200 }).withMessage("Your reset session is invalid. Start the password reset again."),
    passwordRule("password")
];

const changePasswordRules = [
    body("currentPassword").isString().notEmpty().withMessage("Current password is required"),
    passwordRule("newPassword")
];

const mongoIdParam = (name = "id") => [param(name).isMongoId().withMessage(`Invalid ${name}`)];

const mongoIdBody = (name) => [body(name).isMongoId().withMessage(`A valid ${name} is required`)];

const clubRequestFields = (optional = false) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("name").isString().trim().isLength({ min: 3, max: 120 }).withMessage("Club name must be 3-120 characters"),
        f("description").isString().trim().isLength({ min: 10, max: 4000 }).withMessage("Description must be 10-4000 characters"),
        f("purpose").isString().trim().isLength({ min: 10, max: 2000 }).withMessage("Purpose must be 10-2000 characters"),
        f("proposedActivities")
            .isString()
            .trim()
            .isLength({ min: 10, max: 4000 })
            .withMessage("Proposed activities must be 10-4000 characters"),
        f("reason").isString().trim().isLength({ min: 10, max: 2000 }).withMessage("Reason must be 10-2000 characters"),
        body("allDepartments").optional().isBoolean().withMessage("allDepartments must be true or false").toBoolean(),
        body("departmentCodes").optional().isArray({ max: 30 }).withMessage("departmentCodes must be a list"),
        body("departmentCodes.*").isString().trim().isLength({ min: 2, max: 4 }).withMessage("Invalid department code"),
        f("category").isIn(CLUB_CATEGORIES).withMessage("Invalid category"),
        body("foundingMemberEmails").optional().isArray({ max: 20 }).withMessage("Up to 20 founding members are allowed"),
        body("foundingMemberEmails.*").optional().isEmail().withMessage("Founding members must be university emails"),
        body("proposedMentor").optional({ values: "falsy" }).isMongoId().withMessage("Invalid proposed mentor")
    ];
};

const clubRequestRules = clubRequestFields(false);
const clubRequestUpdateRules = clubRequestFields(true);

const commentRules = [
    body("comment").isString().trim().isLength({ min: 5, max: 2000 }).withMessage("Please describe the required changes (min 5 characters)")
];

const optionalCommentRules = [body("comment").optional().isString().trim().isLength({ max: 2000 })];

const rejectRules = [
    body("reason").isString().trim().isLength({ min: 5, max: 2000 }).withMessage("A rejection reason is required (min 5 characters)")
];

const optionalReasonRules = [body("reason").optional().isString().trim().isLength({ max: 2000 })];

const clubUpdateRules = [
    body("name").optional().isString().trim().isLength({ min: 3, max: 120 }),
    body("description").optional().isString().trim().isLength({ min: 10, max: 4000 }),
    body("purpose").optional().isString().trim().isLength({ max: 2000 }),
    body("category").optional().isIn(CLUB_CATEGORIES).withMessage("Invalid category"),
    body("contactEmail").optional({ values: "falsy" }).isEmail().withMessage("Invalid contact email"),
    optionalUrl("logo"),
    optionalUrl("coverImage"),
    body("tagline").optional({ values: "null" }).isString().trim().isLength({ max: 140 }).withMessage("Tagline must be at most 140 characters"),
    body("website").optional({ values: "null" }).isString().isLength({ max: 300 }).withMessage("Website link is too long"),
    body("contactPhone").optional({ values: "null" }).isString().trim().isLength({ max: 20 }).withMessage("Phone number is too long"),
    body("meetingSchedule").optional({ values: "null" }).isString().trim().isLength({ max: 120 }).withMessage("Meeting schedule must be at most 120 characters"),
    body("meetingLocation").optional({ values: "null" }).isString().trim().isLength({ max: 120 }).withMessage("Meeting place must be at most 120 characters"),
    body("socialLinks").optional({ values: "null" }).isObject().withMessage("Social links must be an object")
];

const subscriptionRules = [body("enabled").isBoolean().withMessage("enabled must be true or false")];

const emailPreferenceRules = [
    body("clubUpdates").optional().isBoolean(),
    body("eventRecommendations").optional().isBoolean(),
    body("eventActivity").optional().isBoolean()
];

const unsubscribeRules = [
    body("token").optional().isString().isLength({ max: 500 }),
    query("token").optional().isString().isLength({ max: 500 }),
    oneOf([body("token").exists(), query("token").exists()], { message: "Unsubscribe token is missing" })
];

const clubStatusRules = [
    body("status").isIn(Object.values(CLUB_STATUS)).withMessage("Invalid club status"),
    body("reason").optional().isString().trim().isLength({ max: 1000 })
];

const joinRules = [body("message").optional().isString().trim().isLength({ max: 500 })];

const roleRules = [
    body("role")
        .isIn(Object.values(CLUB_ROLES).filter((role) => role !== CLUB_ROLES.PRESIDENT))
        .withMessage("Invalid club role")
];

const eventFields = (optional = false) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("title").isString().trim().isLength({ min: 3, max: 160 }).withMessage("Title must be 3-160 characters"),
        f("shortDescription")
            .isString()
            .trim()
            .isLength({ min: 10, max: 280 })
            .withMessage("Short description must be 10-280 characters"),
        f("description").isString().trim().isLength({ min: 10, max: 8000 }).withMessage("Description must be 10-8000 characters"),
        f("category").isIn(EVENT_CATEGORIES).withMessage("Invalid category"),
        f("venue").isMongoId().withMessage("Venue is required"),
        f("eventDate").matches(DATE_PATTERN).withMessage("Event date must be YYYY-MM-DD"),
        f("startTime").matches(TIME_PATTERN).withMessage("Start time must be HH:mm"),
        f("endTime").matches(TIME_PATTERN).withMessage("End time must be HH:mm"),
        f("registrationEnd").isISO8601().withMessage("Registration deadline is required"),
        body("registrationStart").optional({ values: "falsy" }).isISO8601().withMessage("Invalid registration start"),
        body("maxParticipants").optional({ values: "null" }).isInt({ min: 1, max: 100000 }).withMessage("Participant limit must be a positive number"),
        body("eligibility.departments").optional().isArray(),
        body("eligibility.batches").optional().isArray(),
        body("eligibility.notes").optional().isString().isLength({ max: 1000 }),
        body("rules").optional().isString().isLength({ max: 8000 }),
        body("contact.name").optional().isString().isLength({ max: 120 }),
        body("contact.email").optional({ values: "falsy" }).isEmail().withMessage("Invalid contact email"),
        body("contact.phone").optional().isString().isLength({ max: 30 }),
        body("organizer").optional({ values: "falsy" }).isMongoId(),
        body("registrationClosed").optional().isBoolean(),
        body("updateNote").optional().isString().isLength({ max: 2000 }),
        body("participationMode").optional().isIn(["INDIVIDUAL", "TEAM"]).withMessage("Choose individual or team entry"),
        body("minTeamSize").optional({ values: "null" }).isInt({ min: 1, max: 20 }).withMessage("Minimum team size must be 1-20"),
        body("maxTeamSize").optional({ values: "null" }).isInt({ min: 1, max: 20 }).withMessage("Maximum team size must be 1-20"),
        optionalUrl("poster")
    ];
};

const eventDraftRules = [body("club").isMongoId().withMessage("Club is required"), ...eventFields(false)];
const eventUpdateRules = eventFields(true);

const availabilityRules = [
    query("eventDate").matches(DATE_PATTERN).withMessage("eventDate must be YYYY-MM-DD"),
    query("startTime").matches(TIME_PATTERN).withMessage("startTime must be HH:mm"),
    query("endTime").matches(TIME_PATTERN).withMessage("endTime must be HH:mm"),
    query("excludeEventId").optional().isMongoId()
];

const venueRules = (optional = false) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("name").isString().trim().isLength({ min: 2, max: 120 }).withMessage("Venue name is required"),
        f("location").isString().trim().isLength({ min: 2, max: 200 }).withMessage("Location is required"),
        f("capacity").isInt({ min: 1, max: 100000 }).withMessage("Capacity must be a positive number"),
        body("status").optional().isIn(["ACTIVE", "INACTIVE"])
    ];
};

const departmentRules = (optional = false) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("code").isString().trim().isLength({ min: 2, max: 4 }).isAlpha().withMessage("Code must be 2-4 letters"),
        f("name").isString().trim().isLength({ min: 2, max: 120 }).withMessage("Name is required"),
        body("isActive").optional().isBoolean()
    ];
};

const batchRules = (optional = false) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("code").matches(/^\d{2}$/).withMessage("Batch code must be 2 digits"),
        f("label").isString().trim().isLength({ min: 2, max: 60 }).withMessage("Label is required"),
        body("isActive").optional().isBoolean()
    ];
};

const resultRules = [
    body("summary").isString().trim().isLength({ min: 5, max: 4000 }).withMessage("Result summary is required"),
    body("awards").optional().isArray({ max: 50 }),
    body("awards.*.title").isString().trim().isLength({ min: 1, max: 120 }).withMessage("Each award needs a title"),
    body("awards.*.position").optional({ values: "null" }).isInt({ min: 1, max: 1000 }),
    body("awards.*.recipientUser").optional({ values: "falsy" }).isMongoId(),
    body("awards.*.recipientName").optional({ values: "null" }).isString().isLength({ max: 120 }),
    body("awards.*.teamName").optional({ values: "null" }).isString().isLength({ max: 120 }),
    body("awards.*.prize").optional({ values: "null" }).isString().isLength({ max: 200 }),
    body("awards.*.recognition").optional({ values: "null" }).isString().isLength({ max: 300 })
];

// optional=true for updates, where every field may be left out.
const roundRules = (optional) => {
    const f = (field) => (optional ? body(field).optional() : body(field));
    return [
        f("name").isString().trim().isLength({ min: 1, max: 80 }).withMessage("Round name must be 1-80 characters"),
        body("description").optional({ values: "null" }).isString().isLength({ max: 1000 }),
        body("entries").optional().isArray({ max: 500 }).withMessage("Entries must be a list of at most 500 rows"),
        body("entries.*.rank").optional({ values: "null" }).isInt({ min: 1, max: 100000 }).withMessage("Rank must be a positive whole number"),
        body("entries.*.recipientUser").optional({ values: "falsy" }).isMongoId(),
        body("entries.*.recipientName").optional({ values: "null" }).isString().isLength({ max: 120 }),
        body("entries.*.teamName").optional({ values: "null" }).isString().isLength({ max: 120 }),
        body("entries.*.score").optional({ values: "null" }).isString().isLength({ max: 40 }).withMessage("Score must be at most 40 characters"),
        body("entries.*.qualified").optional({ values: "null" }).isBoolean(),
        body("entries.*.note").optional({ values: "null" }).isString().isLength({ max: 200 })
    ];
};

const feedPostRules = [
    body("club").isMongoId().withMessage("Club is required"),
    body("type")
        .optional()
        .isIn([FEED_POST_TYPES.ANNOUNCEMENT, FEED_POST_TYPES.CLUB_UPDATE, FEED_POST_TYPES.EVENT_UPDATE])
        .withMessage("Invalid post type"),
    body("title").isString().trim().isLength({ min: 3, max: 200 }).withMessage("Title must be 3-200 characters"),
    body("body").optional().isString().isLength({ max: 4000 }),
    body("event").optional({ values: "falsy" }).isMongoId(),
    body("visibility").optional().isIn(Object.values(FEED_VISIBILITY)),
    optionalUrl("image")
];

const userStatusRules = [body("isActive").isBoolean().withMessage("isActive must be true or false")];

const userSearchRules = [
    query("q").isString().trim().isLength({ min: 2, max: 80 }).withMessage("Enter at least 2 characters"),
    query("accountType").optional().isIn(["STUDENT", "FACULTY"]),
    query("departments").optional().matches(/^[A-Za-z]{2,4}(,[A-Za-z]{2,4})*$/).withMessage("Invalid departments")
];

module.exports = {
    registerRules,
    loginRules,
    emailRules,
    otpRules,
    resetPasswordRules,
    changePasswordRules,
    mongoIdParam,
    mongoIdBody,
    clubRequestRules,
    clubRequestUpdateRules,
    commentRules,
    optionalCommentRules,
    rejectRules,
    optionalReasonRules,
    clubUpdateRules,
    clubStatusRules,
    subscriptionRules,
    emailPreferenceRules,
    unsubscribeRules,
    joinRules,
    roleRules,
    eventDraftRules,
    eventUpdateRules,
    availabilityRules,
    venueRules,
    departmentRules,
    batchRules,
    resultRules,
    roundRules,
    feedPostRules,
    userStatusRules,
    userSearchRules
};
