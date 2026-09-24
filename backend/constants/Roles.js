const GLOBAL_ROLES = Object.freeze({
    STUDENT: "STUDENT",
    FACULTY: "FACULTY",
    ADMIN: "ADMIN"
});

const ACCOUNT_TYPES = Object.freeze({
    STUDENT: "STUDENT",
    FACULTY: "FACULTY"
});

const CLUB_ROLES = Object.freeze({
    PRESIDENT: "PRESIDENT",
    VICE_PRESIDENT: "VICE_PRESIDENT",
    EVENT_COORDINATOR: "EVENT_COORDINATOR",
    MARKETING_COORDINATOR: "MARKETING_COORDINATOR",
    TECHNICAL_COORDINATOR: "TECHNICAL_COORDINATOR",
    TREASURER: "TREASURER",
    MEMBER: "MEMBER"
});

const USER_PUBLIC_FIELDS = "name email accountType globalRole isEmailVerified departmentCode batchCode isActive createdAt";

module.exports = {
    GLOBAL_ROLES,
    ACCOUNT_TYPES,
    CLUB_ROLES,
    USER_PUBLIC_FIELDS
};
