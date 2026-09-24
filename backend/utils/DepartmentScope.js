const Department = require("../models/Department");
const AppError = require("./AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

// A club (and the request that creates it) is either open to all departments or limited to a
// list of departments. The scope decides which faculty may mentor it and which students may belong to it.

const describeScope = (scope) => (scope.allDepartments ? "all departments" : (scope.departmentCodes || []).join(", "));

const belongsToScope = (user, scope) =>
    Boolean(scope.allDepartments) || (scope.departmentCodes || []).includes(String(user?.departmentCode || "").toUpperCase());

// Mongo condition matching clubs/requests that include the given department.
const scopeIncludes = (departmentCode) => ({
    $or: [{ allDepartments: true }, { departmentCodes: String(departmentCode).toUpperCase() }]
});

const resolveScope = async ({ allDepartments, departmentCodes } = {}) => {
    if (allDepartments === true || allDepartments === "true") {
        return { allDepartments: true, departmentCodes: [] };
    }

    const codes = [...new Set((departmentCodes || []).map((code) => String(code).trim().toUpperCase()).filter(Boolean))];

    if (!codes.length) {
        throw new AppError("Choose at least one department, or open the club to all departments", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const found = (await Department.find({ code: { $in: codes }, isActive: true }).select("code")).map((d) => d.code);
    const unknown = codes.filter((code) => !found.includes(code));

    if (unknown.length) {
        throw new AppError(`Department not recognized: ${unknown.join(", ")}`, 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return { allDepartments: false, departmentCodes: codes };
};

const assertMentorMatchesScope = (faculty, scope) => {
    if (!belongsToScope(faculty, scope)) {
        throw new AppError(
            `${faculty.name} is from ${faculty.departmentCode || "another department"}. A club for ${describeScope(scope)} needs a faculty mentor from ${
                scope.departmentCodes.length > 1 ? "one of those departments" : "that department"
            }.`,
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
};

// Students can only belong to clubs of their own department (or clubs open to all departments).
// `self` words the message for the student themself rather than for someone adding them.
const assertStudentsMatchScope = (students, scope, { self = false, clubName = "This club" } = {}) => {
    const outside = students.filter((student) => !belongsToScope(student, scope));

    if (!outside.length) {
        return;
    }

    const message = self
        ? `${clubName} is only for ${describeScope(scope)} students; you are in ${outside[0].departmentCode}.`
        : `${clubName} is only for ${describeScope(scope)} students. Not eligible: ${outside.map((s) => `${s.name} (${s.departmentCode})`).join(", ")}.`;

    throw new AppError(message, 403, ERROR_CODES.NOT_ELIGIBLE);
};

module.exports = { describeScope, belongsToScope, scopeIncludes, resolveScope, assertMentorMatchesScope, assertStudentsMatchScope };
