const { assertAdmin, assertFaculty, assertStudent } = require("../../services/AuthorizationService");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../../constants/Roles");
const AppError = require("../../utils/AppError");

const student = { globalRole: GLOBAL_ROLES.STUDENT, accountType: ACCOUNT_TYPES.STUDENT };
const faculty = { globalRole: GLOBAL_ROLES.FACULTY, accountType: ACCOUNT_TYPES.FACULTY };
const admin = { globalRole: GLOBAL_ROLES.ADMIN, accountType: ACCOUNT_TYPES.FACULTY };

describe("global role guards", () => {
    test("students cannot perform admin actions", () => {
        expect(() => assertAdmin(student)).toThrow(AppError);
    });

    test("students cannot perform faculty actions", () => {
        expect(() => assertFaculty(student)).toThrow(AppError);
    });

    test("faculty cannot perform admin actions", () => {
        expect(() => assertAdmin(faculty)).toThrow(AppError);
    });

    test("admins pass the admin guard", () => {
        expect(() => assertAdmin(admin)).not.toThrow();
    });

    test("faculty and admins are not treated as students", () => {
        expect(() => assertStudent(faculty)).toThrow(AppError);
        expect(() => assertStudent(admin)).toThrow(AppError);
        expect(() => assertStudent(student)).not.toThrow();
    });
});
