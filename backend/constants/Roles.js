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

const USER_PUBLIC_FIELDS = "name email accountType globalRole isEmailVerified departmentCode batchCode avatar isActive createdAt";

// What a signed-in user (and the admin) sees of an account: the public fields plus the mobile number.
const USER_ACCOUNT_FIELDS = `${USER_PUBLIC_FIELDS} phone`;

module.exports = {
    GLOBAL_ROLES,
    ACCOUNT_TYPES,
    CLUB_ROLES,
    USER_PUBLIC_FIELDS,
    USER_ACCOUNT_FIELDS
};
