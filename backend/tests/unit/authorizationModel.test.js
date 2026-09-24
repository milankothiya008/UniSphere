const { GLOBAL_ROLES, CLUB_ROLES } = require("../../constants/Roles");
const { EVENT_STATUS, CLUB_STATUS, EVENT_STATUSES_HOLDING_VENUE } = require("../../constants/Statuses");
const { CLUB_PERMISSIONS, roleHasPermission } = require("../../constants/Permissions");

describe("authorization model", () => {
    test("system roles are STUDENT, FACULTY and ADMIN only", () => {
        expect(Object.values(GLOBAL_ROLES).sort()).toEqual(["ADMIN", "FACULTY", "STUDENT"]);
        expect(GLOBAL_ROLES.CLUB_PRESIDENT).toBeUndefined();
    });

    test("president holds every club permission", () => {
        Object.values(CLUB_PERMISSIONS).forEach((permission) => {
            expect(roleHasPermission(CLUB_ROLES.PRESIDENT, permission)).toBe(true);
        });
    });

    test("event coordinator manages participants but not members or roles", () => {
        expect(roleHasPermission(CLUB_ROLES.EVENT_COORDINATOR, CLUB_PERMISSIONS.MANAGE_PARTICIPANTS)).toBe(true);
        expect(roleHasPermission(CLUB_ROLES.EVENT_COORDINATOR, CLUB_PERMISSIONS.MANAGE_MEMBERS)).toBe(false);
        expect(roleHasPermission(CLUB_ROLES.EVENT_COORDINATOR, CLUB_PERMISSIONS.ASSIGN_ROLES)).toBe(false);
    });

    test("marketing coordinator can post updates only", () => {
        expect(roleHasPermission(CLUB_ROLES.MARKETING_COORDINATOR, CLUB_PERMISSIONS.POST_UPDATES)).toBe(true);
        expect(roleHasPermission(CLUB_ROLES.MARKETING_COORDINATOR, CLUB_PERMISSIONS.VIEW_PARTICIPANTS)).toBe(false);
    });

    test("plain members have no management permissions", () => {
        Object.values(CLUB_PERMISSIONS).forEach((permission) => {
            expect(roleHasPermission(CLUB_ROLES.MEMBER, permission)).toBe(false);
        });
    });

    test("only role assignment is president-exclusive among officers", () => {
        const officers = Object.values(CLUB_ROLES).filter((role) => role !== CLUB_ROLES.PRESIDENT);
        officers.forEach((role) => expect(roleHasPermission(role, CLUB_PERMISSIONS.ASSIGN_ROLES)).toBe(false));
    });

    test("event lifecycle includes review, change-request and publication states", () => {
        expect(EVENT_STATUS.NEEDS_CHANGES).toBe("NEEDS_CHANGES");
        expect(EVENT_STATUS.APPROVED).not.toBe(EVENT_STATUS.PUBLISHED);
        expect(EVENT_STATUSES_HOLDING_VENUE).toEqual([EVENT_STATUS.PENDING_APPROVAL, EVENT_STATUS.APPROVED, EVENT_STATUS.PUBLISHED]);
    });

    test("suspended clubs are distinct from active clubs", () => {
        expect(CLUB_STATUS.ACTIVE).not.toBe(CLUB_STATUS.SUSPENDED);
    });
});
