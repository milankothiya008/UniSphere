const db = require("../helpers/testDb");
const {
    seedReferenceData,
    makeStudent,
    makeFaculty,
    makeAdmin,
    makeActiveClub,
    addMembership,
    eventPayload,
    api
} = require("../helpers/factory");
const Event = require("../../models/Event");
const FeedPost = require("../../models/FeedPost");
const ClubMembership = require("../../models/ClubMembership");

beforeAll(db.connect);
afterAll(db.disconnect);

// The university admin approves clubs, changes club status and reassigns mentors — nothing else inside a club.
describe("university admin authority is limited to approval, status and mentor", () => {
    let venues, admin, mentor, otherFaculty, president, vicePresident, member, applicant, club;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [admin, mentor, otherFaculty, president, vicePresident, member, applicant] = await Promise.all([
            makeAdmin(),
            makeFaculty({ name: "Mentor" }),
            makeFaculty({ name: "Other Faculty" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice President" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Applicant" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, vicePresident, "VICE_PRESIDENT");
        await addMembership(club, member, "MEMBER");
    });

    const clubUrl = () => `/api/clubs/${club._id}`;

    test("club details: only members with MANAGE_CLUB (the president) can edit, including the logo and name", async () => {
        const change = { description: "Changed by someone without authority.", logo: "https://example.com/logo.png" };

        expect((await api(admin).put(clubUrl(), change)).status).toBe(403);
        expect((await api(mentor).put(clubUrl(), change)).status).toBe(403);
        expect((await api(vicePresident).put(clubUrl(), change)).status).toBe(403);
        expect((await api(member).put(clubUrl(), change)).status).toBe(403);

        const res = await api(president).put(clubUrl(), {
            name: "Coding & Robotics Club",
            description: "Building software and robots together on campus.",
            logo: "https://example.com/logo.png"
        });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ name: "Coding & Robotics Club", logo: "https://example.com/logo.png" });
    });

    test("president: only the faculty mentor can appoint a new one", async () => {
        const body = { userId: String(vicePresident._id) };
        expect((await api(admin).post(`${clubUrl()}/president`, body)).status).toBe(403);
        expect((await api(otherFaculty).post(`${clubUrl()}/president`, body)).status).toBe(403);
        expect((await api(president).post(`${clubUrl()}/president`, body)).status).toBe(403);
    });

    test("admin gets no club permissions in the club view", async () => {
        const res = await api(admin).get(clubUrl());
        expect(res.status).toBe(200);
        expect(res.body.data.viewer.permissions).toEqual([]);
        expect(res.body.data.viewer.isAdmin).toBe(true);
    });

    test("admin can see the member list but cannot manage members, roles or recruitment", async () => {
        expect((await api(admin).get(`${clubUrl()}/members`)).status).toBe(200);
        expect((await api(admin).patch(`${clubUrl()}/members/${member._id}/role`, { role: "TREASURER" })).status).toBe(403);
        expect((await api(admin).delete(`${clubUrl()}/members/${member._id}`)).status).toBe(403);
        expect((await api(admin).post(`${clubUrl()}/members`, { userId: String(applicant._id) })).status).toBe(403);
        expect((await api(admin).post(`${clubUrl()}/recruitment`, { title: "Drive" })).status).toBe(403);
        expect(await ClubMembership.exists({ user: applicant._id })).toBeNull();
    });

    test("admin cannot create, review, publish, cancel or see participants of club events", async () => {
        expect((await api(admin).post("/api/events", eventPayload(club, venues.auditorium))).status).toBe(403);

        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium));
        const id = draft.body.data._id;
        expect((await api(admin).get(`/api/events/${id}`)).status).toBe(404);

        await api(president).post(`/api/events/${id}/submit`);
        expect((await api(admin).post(`/api/events/${id}/approve`)).status).toBe(403);
        expect((await api(admin).post(`/api/events/${id}/reject`, { reason: "Admin should not decide this" })).status).toBe(403);

        expect((await api(mentor).post(`/api/events/${id}/approve`)).status).toBe(200);
        expect((await api(admin).post(`/api/events/${id}/publish`)).status).toBe(403);
        expect((await api(president).post(`/api/events/${id}/publish`)).status).toBe(200);

        expect((await api(admin).get(`/api/events/${id}/registrations`)).status).toBe(403);
        expect((await api(admin).post(`/api/events/${id}/cancel`, { reason: "Admin cancelling" })).status).toBe(403);
        expect((await api(admin).put(`/api/events/${id}`, { rules: "Admin edit" })).status).toBe(403);

        await Event.updateOne({ _id: id }, { startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() - 1800000), registrationStart: new Date(Date.now() - 7200000), registrationEnd: new Date(Date.now() - 5400000) });
        expect((await api(admin).post(`/api/events/${id}/complete`)).status).toBe(403);
        await api(president).post(`/api/events/${id}/complete`);
        expect((await api(admin).put(`/api/events/${id}/results`, { summary: "Admin results", awards: [] })).status).toBe(403);
    });

    test("admin cannot post for a club, delete club posts or read members-only posts", async () => {
        expect((await api(admin).post("/api/feed", { club: String(club._id), title: "Admin announcement" })).status).toBe(403);

        const post = await api(president).post("/api/feed", { club: String(club._id), title: "Members meeting", visibility: "MEMBERS" });
        expect(post.status).toBe(201);

        const feed = await api(admin).get(`/api/feed?club=${club._id}&limit=50`);
        expect(feed.body.data.map((p) => p.title)).not.toContain("Members meeting");

        const clubPost = await FeedPost.findOne({ club: club._id, title: "Members meeting" });
        expect((await api(admin).delete(`/api/feed/${clubPost._id}`)).status).toBe(403);
    });

    test("admin CAN change club status and reassign the faculty mentor", async () => {
        const suspended = await api(admin).post(`${clubUrl()}/status`, { status: "SUSPENDED", reason: "Pending review" });
        expect(suspended.status).toBe(200);
        expect(suspended.body.data.status).toBe("SUSPENDED");
        expect((await api(admin).post(`${clubUrl()}/status`, { status: "ACTIVE" })).body.data.status).toBe("ACTIVE");

        expect((await api(president).post(`${clubUrl()}/status`, { status: "ARCHIVED" })).status).toBe(403);
        expect((await api(mentor).put(`${clubUrl()}/mentor`, { mentorId: String(otherFaculty._id) })).status).toBe(403);

        const reassigned = await api(admin).put(`${clubUrl()}/mentor`, { mentorId: String(otherFaculty._id) });
        expect(reassigned.status).toBe(200);
        expect(reassigned.body.data.mentor._id).toBe(String(otherFaculty._id));

        // The new mentor now holds the mentor's powers; the old one no longer does.
        expect((await api(mentor).post(`${clubUrl()}/president`, { userId: String(vicePresident._id) })).status).toBe(403);
        expect((await api(otherFaculty).post(`${clubUrl()}/president`, { userId: String(vicePresident._id) })).status).toBe(200);
    });
});
