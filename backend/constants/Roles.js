const GLOBAL_ROLES = Object.freeze({
    STUDENT: "STUDENT",
    FACULTY: "FACULTY",
    ADMIN: "ADMIN"
});

const ACCOUNT_TYPES = Object.freeze({
    STUDENT: "STUDENT",
    FACULTY: "FACULTY"
});

// The built-in club roles present in every club. Other roles are defined per club (Club.roles).
const CLUB_ROLES = Object.freeze({
    PRESIDENT: "PRESIDENT",
    VICE_PRESIDENT: "VICE_PRESIDENT",
    MEMBER: "MEMBER"
});

const USER_PUBLIC_FIELDS = "name email accountType globalRole isEmailVerified departmentCode batchCode isActive createdAt";

module.exports = {
    GLOBAL_ROLES,
    ACCOUNT_TYPES,
    CLUB_ROLES,
    USER_PUBLIC_FIELDS
};
