const { GLOBAL_ROLES } = require("../constants/Roles");
const { EVENT_STATUS, CLUB_STATUS } = require("../constants/Statuses");

describe("authorization constants", () => {
    test("club-specific roles are not global user roles", () => {
        expect(GLOBAL_ROLES.STUDENT).toBe("STUDENT");
        expect(GLOBAL_ROLES.COORDINATOR).toBe("COORDINATOR");
        expect(GLOBAL_ROLES.UNIVERSITY_ADMIN).toBe("UNIVERSITY_ADMIN");
        expect(GLOBAL_ROLES.CLUB_PRESIDENT).toBeUndefined();
        expect(GLOBAL_ROLES.CLUB_MEMBER).toBeUndefined();
    });

    test("event lifecycle includes distinct approval and publication states", () => {
        expect(EVENT_STATUS.DRAFT).toBe("DRAFT");
        expect(EVENT_STATUS.PENDING_APPROVAL).toBe("PENDING_APPROVAL");
        expect(EVENT_STATUS.APPROVED).toBe("APPROVED");
        expect(EVENT_STATUS.PUBLISHED).toBe("PUBLISHED");
        expect(EVENT_STATUS.APPROVED).not.toBe(EVENT_STATUS.PUBLISHED);
    });

    test("suspended clubs are distinct from active clubs", () => {
        expect(CLUB_STATUS.ACTIVE).not.toBe(CLUB_STATUS.SUSPENDED);
    });
});
