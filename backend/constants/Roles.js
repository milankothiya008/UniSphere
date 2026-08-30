const GLOBAL_ROLES = Object.freeze({
    STUDENT: "STUDENT",
    COORDINATOR: "COORDINATOR",
    UNIVERSITY_ADMIN: "UNIVERSITY_ADMIN"
});

const ACCOUNT_TYPES = Object.freeze({
    STUDENT: "STUDENT",
    FACULTY: "FACULTY"
});

const MEMBERSHIP_ROLES = Object.freeze({
    PRESIDENT: "PRESIDENT",
    MEMBER: "MEMBER"
});

const USER_PUBLIC_FIELDS = "name email accountType globalRole isEmailVerified departmentCode batchCode";

module.exports = {
    GLOBAL_ROLES,
    ACCOUNT_TYPES,
    MEMBERSHIP_ROLES,
    USER_PUBLIC_FIELDS
};
