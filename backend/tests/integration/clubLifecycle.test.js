const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, api } = require("../helpers/factory");
const Club = require("../../models/Club");
const ClubMembership = require("../../models/ClubMembership");
const FeedPost = require("../../models/FeedPost");
const AuditLog = require("../../models/AuditLog");
const Notification = require("../../models/Notification");

beforeAll(db.connect);
afterAll(db.disconnect);

const requestBody = (overrides = {}) => ({
    name: "Robotics Club",
    description: "Designing and building robots for campus competitions.",
    purpose: "Give students hands-on robotics experience.",
    proposedActivities: "Weekly build sessions, workshops and an annual robo-race.",
    reason: "There is no robotics community on campus yet.",
    departmentCodes: ["CE"],
    category: "TECHNOLOGY",
    ...overrides
});

describe("club creation → faculty review → admin approval → president", () => {
    let founder, cofounder, faculty, otherFaculty, admin;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [founder, cofounder, faculty, otherFaculty, admin] = await Promise.all([
            makeStudent({ name: "Founder" }),
            makeStudent({ name: "Co-founder" }),
            makeFaculty({ name: "Dr Mentor" }),
            makeFaculty({ name: "Dr Other" }),
            makeAdmin()
        ]);
    });

    let requestId;
    let clubId;

    test("only students can submit a club request; founding members are resolved by email", async () => {
        expect((await api(faculty).post("/api/club-requests", requestBody())).status).toBe(403);

        const res = await api(founder).post(
            "/api/club-requests",
            requestBody({ foundingMemberEmails: [cofounder.email], proposedMentor: String(faculty._id) })
        );

        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("PENDING_FACULTY_REVIEW");
        expect(res.body.data.foundingMembers.map((m) => m.email)).toEqual([cofounder.email]);
        requestId = res.body.data._id;
    });

    test("rejects unknown founding members and duplicate in-flight names", async () => {
        const unknown = await api(cofounder).post("/api/club-requests", requestBody({ name: "Another Club", foundingMemberEmails: ["24ce9999@ddu.ac.in"] }));
        expect(unknown.status).toBe(400);

        const duplicate = await api(cofounder).post("/api/club-requests", requestBody());
        expect(duplicate.status).toBe(409);
    });

    test("students cannot review, and a faculty member who was not named cannot review", async () => {
        expect((await api(founder).post(`/api/club-requests/${requestId}/verify`)).status).toBe(403);
        expect((await api(otherFaculty).post(`/api/club-requests/${requestId}/verify`)).status).toBe(403);
        expect((await api(admin).post(`/api/club-requests/${requestId}/approve`)).status).toBe(409);
    });

    test("faculty requests changes; the student edits and resubmits", async () => {
        const changes = await api(faculty).post(`/api/club-requests/${requestId}/request-changes`, {
            comment: "Please add a safety plan for workshop tools."
        });
        expect(changes.status).toBe(200);
        expect(changes.body.data.status).toBe("NEEDS_CHANGES");

        expect((await api(cofounder).put(`/api/club-requests/${requestId}`, { purpose: "Not my request to edit." })).status).toBe(403);

        const edit = await api(founder).put(`/api/club-requests/${requestId}`, {
            proposedActivities: "Weekly build sessions with a supervised safety induction, workshops and a robo-race."
        });
        expect(edit.status).toBe(200);

        const resubmit = await api(founder).post(`/api/club-requests/${requestId}/resubmit`);
        expect(resubmit.body.data.status).toBe("PENDING_FACULTY_REVIEW");
        expect(resubmit.body.data.history.map((h) => h.toStatus)).toEqual([
            "PENDING_FACULTY_REVIEW",
            "NEEDS_CHANGES",
            "PENDING_FACULTY_REVIEW"
        ]);
    });

    test("faculty verifies; faculty cannot give final approval", async () => {
        const verify = await api(faculty).post(`/api/club-requests/${requestId}/verify`, { comment: "Looks great." });
        expect(verify.body.data.status).toBe("FACULTY_VERIFIED");
        expect((await api(faculty).post(`/api/club-requests/${requestId}/approve`)).status).toBe(403);
    });

    test("admin approves: club is created with the verifying faculty as mentor and founders as members", async () => {
        const res = await api(admin).post(`/api/club-requests/${requestId}/approve`);
        expect(res.status).toBe(200);
        clubId = res.body.data.club._id;

        const club = await Club.findById(clubId);
        expect(club.status).toBe("APPROVED");
        expect(String(club.mentor)).toBe(String(faculty._id));

        const members = await ClubMembership.find({ club: clubId, status: "APPROVED" });
        expect(members.map((m) => String(m.user)).sort()).toEqual([String(founder._id), String(cofounder._id)].sort());

        expect(await AuditLog.exists({ action: "CLUB_REQUEST_APPROVED", targetId: requestId })).toBeTruthy();
        expect(await Notification.exists({ user: founder._id, type: "CLUB_REQUEST_UPDATE" })).toBeTruthy();
    });

    test("an approved (not yet active) club is hidden from the public directory", async () => {
        const res = await api(null).get("/api/clubs");
        expect(res.body.data.find((c) => c._id === clubId)).toBeUndefined();
        expect((await api(null).get(`/api/clubs/${clubId}`)).status).toBe(404);
    });

    test("only the mentor (or admin) can appoint the president; appointment activates the club", async () => {
        expect((await api(otherFaculty).post(`/api/clubs/${clubId}/president`, { userId: String(founder._id) })).status).toBe(403);
        expect((await api(cofounder).post(`/api/clubs/${clubId}/president`, { userId: String(cofounder._id) })).status).toBe(403);

        const res = await api(faculty).post(`/api/clubs/${clubId}/president`, { userId: String(founder._id) });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("ACTIVE");
        expect(res.body.data.president._id).toBe(String(founder._id));

        const membership = await ClubMembership.findOne({ club: clubId, user: founder._id });
        expect(membership.role).toBe("PRESIDENT");
        // A new club is announced to everyone on campus by notification (not as a feed post).
        expect(await FeedPost.exists({ club: clubId })).toBeNull();
        expect(await Notification.exists({ user: otherFaculty._id, type: "NEW_CLUB" })).toBeTruthy();
    });

    test("the club detail reports the viewer's club role and permissions", async () => {
        const res = await api(founder).get(`/api/clubs/${clubId}`);
        expect(res.body.data.viewer.role).toBe("PRESIDENT");
        expect(res.body.data.viewer.permissions).toContain("ASSIGN_ROLES");
        expect(res.body.data.mentor.name).toBe("Dr Mentor");
        expect(res.body.data.memberCount).toBe(2);
    });
});

describe("membership requests and club roles", () => {
    let mentor, president, member, applicant, outsider, club;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [mentor, president, member, applicant, outsider] = await Promise.all([
            makeFaculty(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Applicant" }),
            makeStudent({ name: "Outsider" })
        ]);
        club = await require("../helpers/factory").makeActiveClub({ mentor, president });
        await require("../helpers/factory").addMembership(club, member);
    });

    let membershipId;

    test("a student requests to join; duplicate requests are rejected", async () => {
        const res = await api(applicant).post(`/api/clubs/${club._id}/join`, { message: "I love robots" });
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("PENDING");
        membershipId = res.body.data._id;

        expect((await api(applicant).post(`/api/clubs/${club._id}/join`)).status).toBe(409);
        expect((await api(mentor).post(`/api/clubs/${club._id}/join`)).status).toBe(403);
    });

    test("plain members and outsiders cannot see or decide membership requests", async () => {
        expect((await api(member).get(`/api/clubs/${club._id}/membership-requests`)).status).toBe(403);
        expect((await api(outsider).post(`/api/clubs/${club._id}/membership-requests/${membershipId}/approve`)).status).toBe(403);
    });

    test("the president approves the request", async () => {
        const list = await api(president).get(`/api/clubs/${club._id}/membership-requests`);
        expect(list.body.data).toHaveLength(1);

        const res = await api(president).post(`/api/clubs/${club._id}/membership-requests/${membershipId}/approve`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("APPROVED");
        expect((await api(president).post(`/api/clubs/${club._id}/membership-requests/${membershipId}/approve`)).status).toBe(409);
    });

    test("a student cannot approve their own membership request", async () => {
        const self = await makeStudent({ name: "Self Approver" });
        const res = await api(self).post(`/api/clubs/${club._id}/join`);

        const attempt = await api(self).post(`/api/clubs/${club._id}/membership-requests/${res.body.data._id}/approve`);
        expect(attempt.status).toBe(403);
        expect((await ClubMembership.findById(res.body.data._id)).status).toBe("PENDING");
    });

    test("a vice president can decide requests from other students", async () => {
        const vp = await makeStudent({ name: "Vice President" });
        await require("../helpers/factory").addMembership(club, vp, "VICE_PRESIDENT");

        const pending = await api(outsider).post(`/api/clubs/${club._id}/join`);
        const res = await api(vp).post(`/api/clubs/${club._id}/membership-requests/${pending.body.data._id}/reject`, { reason: "Try next term" });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("REJECTED");
    });

    test("only the president assigns roles; the new role grants its permissions", async () => {
        expect((await api(member).patch(`/api/clubs/${club._id}/members/${applicant._id}/role`, { role: "EVENT_COORDINATOR" })).status).toBe(403);
        expect((await api(president).patch(`/api/clubs/${club._id}/members/${applicant._id}/role`, { role: "PRESIDENT" })).status).toBe(400);

        const res = await api(president).patch(`/api/clubs/${club._id}/members/${applicant._id}/role`, { role: "EVENT_COORDINATOR" });
        expect(res.status).toBe(200);
        expect(res.body.data.role).toBe("EVENT_COORDINATOR");

        const detail = await api(applicant).get(`/api/clubs/${club._id}`);
        expect(detail.body.data.viewer.permissions).toEqual(expect.arrayContaining(["MANAGE_EVENTS", "MANAGE_PARTICIPANTS"]));
        expect(detail.body.data.viewer.permissions).not.toContain("MANAGE_MEMBERS");
    });

    test("member list is restricted to members, the mentor and admins", async () => {
        expect((await api(outsider).get(`/api/clubs/${club._id}/members`)).status).toBe(403);
        expect((await api(member).get(`/api/clubs/${club._id}/members`)).status).toBe(200);
        const mentorView = await api(mentor).get(`/api/clubs/${club._id}/members`);
        expect(mentorView.body.data[0].role).toBe("PRESIDENT");
    });

    test("the president cannot be removed and cannot leave; members can leave", async () => {
        expect((await api(president).delete(`/api/clubs/${club._id}/members/${president._id}`)).status).toBe(400);
        expect((await api(president).post(`/api/clubs/${club._id}/leave`)).status).toBe(409);
        expect((await api(member).post(`/api/clubs/${club._id}/leave`)).status).toBe(200);
    });

    test("the president removes a member; notifications and audit entries are recorded", async () => {
        const res = await api(president).delete(`/api/clubs/${club._id}/members/${applicant._id}`);
        expect(res.status).toBe(200);
        expect(await ClubMembership.exists({ club: club._id, user: applicant._id })).toBeNull();
        expect(await AuditLog.exists({ action: "MEMBER_REMOVED" })).toBeTruthy();
        expect(await Notification.exists({ user: applicant._id, type: "MEMBERSHIP_APPROVED" })).toBeTruthy();
    });

    test("a rejected applicant can apply again", async () => {
        const again = await makeStudent();
        const first = await api(again).post(`/api/clubs/${club._id}/join`);
        await api(president).post(`/api/clubs/${club._id}/membership-requests/${first.body.data._id}/reject`, { reason: "Full for now" });
        const retry = await api(again).post(`/api/clubs/${club._id}/join`);
        expect(retry.status).toBe(201);
        expect(retry.body.data.status).toBe("PENDING");
    });
});

describe("club departments decide who can mentor", () => {
    let student, ceFaculty, itFaculty, ecFaculty, admin;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [student, ceFaculty, itFaculty, ecFaculty, admin] = await Promise.all([
            makeStudent(),
            makeFaculty({ department: "CE" }),
            makeFaculty({ department: "IT" }),
            makeFaculty({ department: "EC" }),
            makeAdmin()
        ]);
    });

    let counter = 0;
    const submit = (overrides) => api(student).post("/api/club-requests", requestBody({ name: `Scoped Club ${++counter}`, ...overrides }));

    test("a club needs at least one known department unless it is open to all", async () => {
        expect((await submit({ departmentCodes: [] })).status).toBe(400);
        expect((await submit({ departmentCodes: ["ZZ"] })).status).toBe(400);

        const all = await submit({ departmentCodes: undefined, allDepartments: true });
        expect(all.status).toBe(201);
        expect(all.body.data).toMatchObject({ allDepartments: true, departmentCodes: [] });
    });

    test("a single-department club only accepts a mentor from that department", async () => {
        const wrong = await submit({ proposedMentor: String(itFaculty._id) });
        expect(wrong.status).toBe(400);
        expect(wrong.body.message).toMatch(/needs a faculty mentor from that department/);

        expect((await submit({ proposedMentor: String(ceFaculty._id) })).status).toBe(201);
    });

    test("a multi-department club accepts a mentor from any of its departments", async () => {
        expect((await submit({ departmentCodes: ["CE", "IT"], proposedMentor: String(itFaculty._id) })).status).toBe(201);
        expect((await submit({ departmentCodes: ["CE", "IT"], proposedMentor: String(ecFaculty._id) })).status).toBe(400);
    });

    test("an all-departments club accepts any faculty mentor", async () => {
        expect((await submit({ allDepartments: true, proposedMentor: String(ecFaculty._id) })).status).toBe(201);
    });

    test("open requests are only offered to faculty from the club's departments", async () => {
        const open = await submit({ departmentCodes: ["CE", "IT"] });
        const id = open.body.data._id;

        const listFor = async (faculty) => (await api(faculty).get("/api/club-requests")).body.data.map((r) => r._id);
        expect(await listFor(itFaculty)).toContain(id);
        expect(await listFor(ecFaculty)).not.toContain(id);
        expect((await api(ecFaculty).get(`/api/club-requests/${id}`)).status).toBe(403);
        expect((await api(ecFaculty).post(`/api/club-requests/${id}/verify`)).status).toBe(403);

        expect((await api(itFaculty).post(`/api/club-requests/${id}/verify`)).status).toBe(200);
        const approved = await api(admin).post(`/api/club-requests/${id}/approve`);
        expect(approved.status).toBe(200);

        const club = await Club.findOne({ name: open.body.data.name });
        expect(club.departmentCodes).toEqual(["CE", "IT"]);
        expect(String(club.mentor)).toBe(String(itFaculty._id));

        // The admin can only reassign the mentor to faculty from the club's departments.
        expect((await api(admin).put(`/api/clubs/${club._id}/mentor`, { mentorId: String(ecFaculty._id) })).status).toBe(400);
        expect((await api(admin).put(`/api/clubs/${club._id}/mentor`, { mentorId: String(ceFaculty._id) })).status).toBe(200);
    });

    test("editing departments cannot leave the named mentor or the requester outside the club's departments", async () => {
        const res = await submit({ departmentCodes: ["CE", "IT"], proposedMentor: String(itFaculty._id) });
        const id = res.body.data._id;
        await api(itFaculty).post(`/api/club-requests/${id}/request-changes`, { comment: "Please add more detail." });

        const withoutMentor = await api(student).put(`/api/club-requests/${id}`, { departmentCodes: ["CE"] });
        expect(withoutMentor.status).toBe(400);
        expect(withoutMentor.body.message).toMatch(/needs a faculty mentor/);

        const withoutRequester = await api(student).put(`/api/club-requests/${id}`, { departmentCodes: ["IT"] });
        expect(withoutRequester.status).toBe(403);
        expect(withoutRequester.body.message).toMatch(/You are in CE/);

        const widened = await api(student).put(`/api/club-requests/${id}`, { departmentCodes: ["CE", "IT", "ME"] });
        expect(widened.status).toBe(200);
        expect(widened.body.data.departmentCodes).toEqual(["CE", "IT", "ME"]);
    });

    test("the mentor search offers only faculty from the given departments, never the admin", async () => {
        const search = async (q) => (await api(student).get(`/api/users/search?${q}`)).body.data.map((u) => u.email);
        const all = await search("q=ddu.ac.in&accountType=FACULTY");
        expect(all).toEqual(expect.arrayContaining([ceFaculty.email, itFaculty.email, ecFaculty.email]));
        expect(all).not.toContain(admin.email);
        expect(await search("q=ddu.ac.in&accountType=FACULTY&departments=CE,IT")).toEqual(expect.arrayContaining([ceFaculty.email, itFaculty.email]));
        expect(await search("q=ddu.ac.in&accountType=FACULTY&departments=CE,IT")).not.toContain(ecFaculty.email);
    });

    test("clubs and requests stored with a single department are migrated on startup", async () => {
        const { migrateDepartmentScope } = require("../../services/AdminService");
        await Club.collection.insertMany([
            { name: "Legacy CE", departmentCode: "CE", category: "TECHNOLOGY", status: "ACTIVE" },
            { name: "Legacy none", departmentCode: null, category: "TECHNOLOGY", status: "ACTIVE" }
        ]);

        await migrateDepartmentScope();

        const ce = await Club.collection.findOne({ name: "Legacy CE" });
        expect(ce).toMatchObject({ allDepartments: false, departmentCodes: ["CE"] });
        expect(ce.departmentCode).toBeUndefined();
        expect(await Club.collection.findOne({ name: "Legacy none" })).toMatchObject({ allDepartments: true, departmentCodes: [] });
    });

    test("the department filter on the club directory includes all-departments clubs", async () => {
        const president = await makeStudent();
        await Club.create([
            { name: "Only IT", description: "An IT-only club for tests.", category: "TECHNOLOGY", departmentCodes: ["IT"], status: "ACTIVE", mentor: itFaculty._id, president: president._id },
            { name: "Everyone", description: "Open to all departments.", category: "TECHNOLOGY", allDepartments: true, status: "ACTIVE", mentor: ecFaculty._id, president: president._id }
        ]);

        const names = (await api(student).get("/api/clubs?department=CE")).body.data.map((c) => c.name);
        expect(names).toContain("Everyone");
        expect(names).not.toContain("Only IT");
    });
});

describe("students only belong to clubs of their own department", () => {
    let ceStudent, itStudent, ecStudent, mentor, president, ceClub, openClub;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [ceStudent, itStudent, ecStudent, mentor, president] = await Promise.all([
            makeStudent({ department: "CE" }),
            makeStudent({ department: "IT" }),
            makeStudent({ department: "EC" }),
            makeFaculty({ department: "CE" }),
            makeStudent({ department: "CE", name: "President" })
        ]);
        ceClub = await makeActiveClub({ name: "CE Only", mentor, president });
        openClub = await makeActiveClub({ name: "Open Club", mentor, president });
        await Club.updateOne({ _id: openClub._id }, { allDepartments: true, departmentCodes: [] });
    });

    test("a student can request to join only clubs for their department or for all departments", async () => {
        const blocked = await api(itStudent).post(`/api/clubs/${ceClub._id}/join`);
        expect(blocked.status).toBe(403);
        expect(blocked.body.message).toMatch(/only for CE students; you are in IT/);

        expect((await api(ceStudent).post(`/api/clubs/${ceClub._id}/join`)).status).toBe(201);
        expect((await api(itStudent).post(`/api/clubs/${openClub._id}/join`)).status).toBe(201);
    });

    test("the president cannot add or approve a student from another department", async () => {
        const added = await api(president).post(`/api/clubs/${ceClub._id}/members`, { userId: String(ecStudent._id) });
        expect(added.status).toBe(403);
        expect(added.body.message).toMatch(/Not eligible: .*(EC)/);

        // A request left over from before the rule cannot be approved.
        const legacy = await ClubMembership.create({ club: ceClub._id, user: ecStudent._id, role: "MEMBER", status: "PENDING" });
        expect((await api(president).post(`/api/clubs/${ceClub._id}/membership-requests/${legacy._id}/approve`)).status).toBe(403);
    });

    test("the mentor can only appoint a president from the club's departments", async () => {
        expect((await api(mentor).post(`/api/clubs/${ceClub._id}/president`, { userId: String(itStudent._id) })).status).toBe(403);
    });

    test("the requester and founding members of a club request must be from its departments", async () => {
        const body = (overrides) => requestBody({ name: `Founders ${Math.random()}`, ...overrides });

        const notMine = await api(ceStudent).post("/api/club-requests", body({ departmentCodes: ["IT"] }));
        expect(notMine.status).toBe(403);
        expect(notMine.body.message).toMatch(/You are in CE/);

        const outsider = await api(ceStudent).post("/api/club-requests", body({ foundingMemberEmails: [itStudent.email] }));
        expect(outsider.status).toBe(403);
        expect(outsider.body.message).toMatch(/Not eligible: .*(IT)/);

        expect((await api(ceStudent).post("/api/club-requests", body({ departmentCodes: ["CE", "IT"], foundingMemberEmails: [itStudent.email] }))).status).toBe(201);
        expect((await api(ceStudent).post("/api/club-requests", body({ departmentCodes: undefined, allDepartments: true, foundingMemberEmails: [ecStudent.email] }))).status).toBe(201);
    });
});
