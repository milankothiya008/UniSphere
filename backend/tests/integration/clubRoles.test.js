const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Club = require("../../models/Club");
const ClubMembership = require("../../models/ClubMembership");
const Notification = require("../../models/Notification");
const AuditLog = require("../../models/AuditLog");
const RecruitmentDrive = require("../../models/RecruitmentDrive");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("club-defined roles", () => {
    let venues, club, mentor, president, vice, member, designer, other;
    const roles = (user = president) => api(user).get(`/api/clubs/${club._id}/roles`);

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, vice, member, designer, other] = await Promise.all([
            makeFaculty(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice" }),
            makeStudent({ name: "Plain Member" }),
            makeStudent({ name: "Dia Designer" }),
            makeStudent({ name: "Other Member" })
        ]);
        club = await makeActiveClub({ name: "Robotics", mentor, president });
        await addMembership(club, vice, "VICE_PRESIDENT");
        await addMembership(club, member);
        await addMembership(club, designer);
        await addMembership(club, other);
    });

    test("members and the mentor see the club's roles; everyone starts with the defaults", async () => {
        const res = await roles(member);
        expect(res.status).toBe(200);
        expect(res.body.data.canManage).toBe(false);
        expect(res.body.data.roles.map((role) => role.name)).toEqual(["President", "Vice-president", "Event coordinator", "Marketing coordinator", "Technical coordinator", "Treasurer", "Member"]);
        const vp = res.body.data.roles.find((role) => role.key === "VICE_PRESIDENT");
        expect(vp).toMatchObject({ system: true, unique: true, holder: { name: "Vice" }, editable: true, renamable: false, deletable: false });
        expect((await roles(mentor)).status).toBe(200);
        expect((await roles(await makeStudent())).status).toBe(403);
    });

    test("only the president creates roles, and president-only authorities can't be given", async () => {
        const body = { name: "Design lead", description: "Posters and reels", permissions: ["POST_UPDATES", "MODERATE_GALLERY"] };
        expect((await api(vice).post(`/api/clubs/${club._id}/roles`, body)).status).toBe(403);
        const refused = await api(president).post(`/api/clubs/${club._id}/roles`, { ...body, permissions: ["POST_UPDATES", "MANAGE_RECRUITMENT"] });
        expect(refused.status).toBe(400);
        expect(refused.body.message).toMatch(/stay with the president/);

        const created = await api(president).post(`/api/clubs/${club._id}/roles`, body);
        expect(created.status).toBe(201);
        const design = created.body.data.roles.find((role) => role.name === "Design lead");
        expect(design).toMatchObject({ permissions: ["POST_UPDATES", "MODERATE_GALLERY"], system: false, deletable: true });
        expect(design.key).toMatch(/^R_[a-f0-9]{24}$/);
        expect((await api(president).post(`/api/clubs/${club._id}/roles`, { ...body, name: "design LEAD" })).status).toBe(409);
        expect(await AuditLog.exists({ action: "CLUB_ROLE_CREATED" })).toBeTruthy();
    });

    test("a custom role's authorities take effect for whoever holds it, and change when the role changes", async () => {
        const design = (await roles()).body.data.roles.find((role) => role.name === "Design lead");
        const assigned = await api(president).patch(`/api/clubs/${club._id}/members/${designer._id}/role`, { role: design.key });
        expect(assigned.status).toBe(200);
        expect(assigned.body.data.roleName).toBe("Design lead");
        expect((await Notification.findOne({ user: designer._id, type: "CLUB_ROLE_CHANGED" })).message).toBe("You are now Design lead.");

        let detail = await api(designer).get(`/api/clubs/${club._id}`);
        expect(detail.body.data.viewer).toMatchObject({ roleName: "Design lead" });
        expect(detail.body.data.viewer.permissions).toEqual(["POST_UPDATES", "MODERATE_GALLERY"]);
        expect((await api(designer).post("/api/events", eventPayload(club, venues.auditorium, { eventDate: futureDate(9) }))).status).toBe(403);

        await api(president).put(`/api/clubs/${club._id}/roles/${design.key}`, { permissions: ["POST_UPDATES", "MANAGE_EVENTS"] });
        detail = await api(designer).get(`/api/clubs/${club._id}`);
        expect(detail.body.data.viewer.permissions).toEqual(["POST_UPDATES", "MANAGE_EVENTS"]);
        expect((await api(designer).post("/api/events", eventPayload(club, venues.auditorium, { eventDate: futureDate(9) }))).status).toBe(201);

        const mine = await api(designer).get("/api/clubs/mine");
        expect(mine.body.data.memberships[0]).toMatchObject({ roleName: "Design lead", permissions: ["POST_UPDATES", "MANAGE_EVENTS"] });
    });

    test("built-in roles: the president and member roles are fixed, the vice-president's authorities can change", async () => {
        expect((await api(president).put(`/api/clubs/${club._id}/roles/PRESIDENT`, { permissions: [] })).status).toBe(409);
        expect((await api(president).delete(`/api/clubs/${club._id}/roles/MEMBER`)).status).toBe(409);
        const vp = await api(president).put(`/api/clubs/${club._id}/roles/VICE_PRESIDENT`, { name: "Deputy", permissions: ["MANAGE_EVENTS"] });
        expect(vp.status).toBe(200);
        const updated = vp.body.data.roles.find((role) => role.key === "VICE_PRESIDENT");
        expect(updated).toMatchObject({ name: "Vice-president", permissions: ["MANAGE_EVENTS"] });
        expect((await api(vice).get(`/api/clubs/${club._id}`)).body.data.viewer.permissions).toEqual(["MANAGE_EVENTS"]);
    });

    test("one vice-president per club; nobody is made president by a role change", async () => {
        const clash = await api(president).patch(`/api/clubs/${club._id}/members/${other._id}/role`, { role: "VICE_PRESIDENT" });
        expect(clash.status).toBe(409);
        expect(clash.body.message).toMatch(/Vice is already vice-president/);
        expect((await api(president).patch(`/api/clubs/${club._id}/members/${other._id}/role`, { role: "PRESIDENT" })).status).toBe(400);
        expect((await api(president).patch(`/api/clubs/${club._id}/members/${other._id}/role`, { role: "R_000000000000000000000000" })).body.message).toMatch(/no such role/);

        // The database refuses a second vice-president too.
        await expect(ClubMembership.updateOne({ club: club._id, user: other._id }, { $set: { role: "VICE_PRESIDENT" } })).rejects.toThrow(/duplicate key/);
    });

    test("deleting a role makes its holders members; not while recruitment uses it", async () => {
        const design = (await roles()).body.data.roles.find((role) => role.name === "Design lead");
        const drive = await RecruitmentDrive.create({
            club: club._id,
            title: "Design team",
            description: "Join",
            positions: [{ role: design.key, title: "Design lead", form: { pages: [{ title: "About you", questions: [] }] } }],
            applicationStart: new Date(),
            applicationEnd: new Date(Date.now() + 86400000),
            createdBy: president._id
        });
        expect((await api(president).delete(`/api/clubs/${club._id}/roles/${design.key}`)).body.message).toMatch(/"Design team" is recruiting for this role/);
        await drive.deleteOne();

        const deleted = await api(president).delete(`/api/clubs/${club._id}/roles/${design.key}`);
        expect(deleted.status).toBe(200);
        expect(deleted.body.data.roles.some((role) => role.key === design.key)).toBe(false);
        expect((await ClubMembership.findOne({ club: club._id, user: designer._id })).role).toBe("MEMBER");
        expect(await Notification.exists({ user: designer._id, message: /"Design lead" role was removed/ })).toBeTruthy();
    });

    test("the president hands over the presidency; the old president becomes a member", async () => {
        expect((await api(vice).post(`/api/clubs/${club._id}/president/transfer`, { userId: String(member._id) })).status).toBe(403);
        expect((await api(president).post(`/api/clubs/${club._id}/president/transfer`, { userId: String((await makeStudent())._id) })).status).toBe(400);
        expect((await api(president).post(`/api/clubs/${club._id}/leave`)).body.message).toMatch(/Hand over the presidency/);

        const res = await api(president).post(`/api/clubs/${club._id}/president/transfer`, { userId: String(vice._id) });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Vice is now president");

        expect((await ClubMembership.findOne({ club: club._id, user: vice._id })).role).toBe("PRESIDENT");
        expect((await ClubMembership.findOne({ club: club._id, user: president._id })).role).toBe("MEMBER");
        expect(String((await Club.findById(club._id)).president)).toBe(String(vice._id));
        expect(await Notification.exists({ user: mentor._id, title: "New president for Robotics" })).toBeTruthy();
        expect(await AuditLog.exists({ action: "PRESIDENCY_TRANSFERRED" })).toBeTruthy();

        // The vice-president seat is free again, and the new president runs the roles now.
        expect((await api(vice).patch(`/api/clubs/${club._id}/members/${other._id}/role`, { role: "VICE_PRESIDENT" })).status).toBe(200);
        expect((await api(president).post(`/api/clubs/${club._id}/roles`, { name: "Advisor", permissions: [] })).status).toBe(403);
        expect((await api(president).post(`/api/clubs/${club._id}/leave`)).status).toBe(200);
    });

    test("startup migration gives old clubs their roles and keeps one vice-president", async () => {
        const oldClub = await makeActiveClub({ name: "Old Club", mentor, president: await makeStudent() });
        await Club.collection.updateOne({ _id: oldClub._id }, { $unset: { roles: "" } });
        await ClubMembership.collection.dropIndex("one_president_one_vice_president");
        const [a, b] = [await makeStudent(), await makeStudent()];
        await ClubMembership.collection.insertMany([
            { club: oldClub._id, user: a._id, role: "VICE_PRESIDENT", status: "APPROVED", decidedAt: new Date(Date.now() - 1000) },
            { club: oldClub._id, user: b._id, role: "VICE_PRESIDENT", status: "APPROVED", decidedAt: new Date() }
        ]);

        await require("../../services/AdminService").migrateClubRoles();

        expect((await Club.findById(oldClub._id)).roles.map((role) => role.key)).toContain("TREASURER");
        expect((await ClubMembership.findOne({ user: a._id })).role).toBe("VICE_PRESIDENT");
        expect((await ClubMembership.findOne({ user: b._id })).role).toBe("MEMBER");
        await expect(ClubMembership.updateOne({ user: b._id }, { $set: { role: "VICE_PRESIDENT" } })).rejects.toThrow(/duplicate key/);
    });
});
