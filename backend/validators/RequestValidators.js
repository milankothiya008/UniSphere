const { body, param, query } = require("express-validator");

const registerRules = [
    body("name").trim().isLength({ min: 2, max: 80 }).withMessage("Name must be 2-80 characters"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
];

const loginRules = [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required")
];

const mongoIdParam = (name = "id") => [
    param(name).isMongoId().withMessage(`Invalid ${name}`)
];

const clubRequestRules = [
    body("name").trim().isLength({ min: 3, max: 120 }),
    body("description").trim().isLength({ min: 10, max: 4000 }),
    body("purpose").trim().isLength({ min: 10, max: 2000 }),
    body("proposedActivities").trim().isLength({ min: 10, max: 4000 }),
    body("reason").trim().isLength({ min: 10, max: 2000 }),
    body("departmentCode").trim().isLength({ min: 2, max: 4 }),
    body("category").notEmpty()
];

const eventDraftRules = [
    body("title").trim().isLength({ min: 3, max: 160 }),
    body("shortDescription").trim().isLength({ min: 10, max: 280 }),
    body("description").trim().isLength({ min: 10, max: 8000 }),
    body("category").notEmpty(),
    body("club").isMongoId(),
    body("venue").isMongoId(),
    body("eventDate").notEmpty(),
    body("startTime").matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body("endTime").matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    body("registrationStart").notEmpty(),
    body("registrationEnd").notEmpty()
];

const availabilityRules = [
    query("eventDate").notEmpty(),
    query("startTime").matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
    query("endTime").matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
];

const rejectRules = [body("reason").trim().isLength({ min: 5 }).withMessage("Reason is required")];

module.exports = {
    registerRules,
    loginRules,
    mongoIdParam,
    clubRequestRules,
    eventDraftRules,
    availabilityRules,
    rejectRules
};
