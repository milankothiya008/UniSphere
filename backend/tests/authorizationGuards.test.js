const { assertAdmin, assertCoordinatorRole } = require("../services/AuthorizationService");
const { GLOBAL_ROLES } = require("../constants/Roles");
const AppError = require("../utils/AppError");

describe("global role guards", () => {
    test("students cannot perform admin actions", () => {
        expect(() => assertAdmin({ globalRole: GLOBAL_ROLES.STUDENT })).toThrow(AppError);
    });

    test("students cannot perform coordinator actions", () => {
        expect(() => assertCoordinatorRole({ globalRole: GLOBAL_ROLES.STUDENT })).toThrow(AppError);
    });

    test("admins pass the admin guard", () => {
        expect(() => assertAdmin({ globalRole: GLOBAL_ROLES.UNIVERSITY_ADMIN })).not.toThrow();
    });
});
