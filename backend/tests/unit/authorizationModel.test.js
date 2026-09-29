const { CLUB_PERMISSIONS: P } = require("../../constants/Permissions");
const { DEFAULT_ROLES, GRANTABLE, PRESIDENT_ONLY, permissionsFor, keysWith, roleName, rolesOf, roleRank } = require("../../utils/ClubRoles");

const club = (roles) => ({ roles });

describe("per-club roles", () => {
    test("the president holds every authority, whatever the club's roles say", () => {
        const custom = club([{ key: "PRESIDENT", name: "President", permissions: [], system: true }]);
        Object.values(P).forEach((permission) => expect(permissionsFor(custom, "PRESIDENT")).toContain(permission));
    });

    test("president-only authorities can never come from another role", () => {
        expect(PRESIDENT_ONLY).toEqual(expect.arrayContaining([P.MANAGE_CLUB, P.ASSIGN_ROLES, P.MANAGE_RECRUITMENT, P.PUBLISH_RESULTS, P.MANAGE_CHECK_IN]));
        const sneaky = club([...DEFAULT_ROLES(), { key: "R_1", name: "Sneaky", permissions: [P.ASSIGN_ROLES, P.POST_UPDATES], system: false }]);
        expect(permissionsFor(sneaky, "R_1")).toEqual([P.POST_UPDATES]);
        PRESIDENT_ONLY.forEach((permission) => expect(GRANTABLE).not.toContain(permission));
    });

    test("a club's custom roles grant exactly what the president chose", () => {
        const roles = club([...DEFAULT_ROLES(), { key: "R_design", name: "Design lead", permissions: [P.POST_UPDATES, P.MODERATE_GALLERY], system: false, order: 6 }]);
        expect(permissionsFor(roles, "R_design")).toEqual([P.POST_UPDATES, P.MODERATE_GALLERY]);
        expect(roleName(roles, "R_design")).toBe("Design lead");
        expect(keysWith(roles, P.MODERATE_GALLERY)).toEqual(expect.arrayContaining(["PRESIDENT", "VICE_PRESIDENT", "R_design"]));
        expect(keysWith(roles, P.MODERATE_GALLERY)).not.toContain("MEMBER");
        expect(permissionsFor(roles, "MEMBER")).toEqual([]);
        expect(permissionsFor(roles, "R_unknown")).toEqual([]);
    });

    test("clubs stored before roles were per-club use the default roles, keyed as before", () => {
        const legacy = { roles: undefined };
        expect(rolesOf(legacy).map((role) => role.key)).toEqual(["PRESIDENT", "VICE_PRESIDENT", "EVENT_COORDINATOR", "MARKETING_COORDINATOR", "TECHNICAL_COORDINATOR", "TREASURER", "MEMBER"]);
        expect(permissionsFor(legacy, "EVENT_COORDINATOR")).toEqual(expect.arrayContaining([P.MANAGE_EVENTS, P.MANAGE_PARTICIPANTS, P.MARK_ATTENDANCE]));
        expect(permissionsFor(legacy, "MARKETING_COORDINATOR")).not.toContain(P.VIEW_PARTICIPANTS);
        expect(permissionsFor(legacy, "VICE_PRESIDENT")).not.toContain(P.ASSIGN_ROLES);
        expect(roleRank(legacy, "PRESIDENT")).toBeLessThan(roleRank(legacy, "TREASURER"));
        expect(roleRank(legacy, "TREASURER")).toBeLessThan(roleRank(legacy, "MEMBER"));
    });
});
