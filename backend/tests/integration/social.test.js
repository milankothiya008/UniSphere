const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const Notification = require("../../models/Notification");
const ClubSubscription = require("../../models/ClubSubscription");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("profiles, the activity badge and following from the feed", () => {
    let venues, mentor, president, member, stranger, club, otherClub;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, member, stranger] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeStudent({ name: "Club President" }),
            makeStudent({ name: "Asha Member" }),
            makeStudent({ name: "Stranger" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        otherClub = await makeActiveClub({ name: "Drama Club", mentor, president: stranger });
        await addMembership(club, member, "MEMBER");
    });

    describe("someone else's profile", () => {
        test("shows name, role, department, batch, clubs and history — never email or upcoming schedule", async () => {
            const loner = await makeStudent({ name: "Not In A Club" });
            const res = await api(loner).get(`/api/users/${member._id}/profile`);
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ name: "Asha Member", departmentCode: "CE", batchCode: "24", isSelf: false, history: { events: [], awards: [], certificates: [] } });
            expect(res.body.data.clubs).toEqual([expect.objectContaining({ club: expect.objectContaining({ name: "Coding Club" }), roleName: "Member" })]);
            const body = JSON.stringify(res.body.data);
            expect(body).not.toContain(member.email);
            // Students outside every club don't see mobile numbers; club members (the club directory rule) do.
            expect(res.body.data.phone).toBeNull();
            expect((await api(stranger).get(`/api/users/${member._id}/profile`)).body.data.phone).toMatch(/^\+91/);
            expect(res.body.data).not.toHaveProperty("registrations");
        });

        test("a faculty member's number is shown to club members, faculty and the admin — not other students", async () => {
            const loner = await makeStudent({ name: "Another Loner" });
            expect((await api(loner).get(`/api/users/${mentor._id}/profile`)).body.data.phone).toBeNull();
            const facultyPhone = "+919811112222";
            await require("../../models/User").updateOne({ _id: mentor._id }, { $set: { phone: facultyPhone } });
            expect((await api(member).get(`/api/users/${mentor._id}/profile`)).body.data.phone).toBe(facultyPhone);
            const clubView = async (viewer) => (await api(viewer).get(`/api/clubs/${club._id}`)).body.data.mentor;
            expect((await clubView(member)).phone).toBe(facultyPhone);
            expect((await clubView(loner)).phone).toBeUndefined();
            expect((await api(loner).get("/api/clubs")).body.data.every((item) => !item.mentor?.phone)).toBe(true);
        });

        test("a faculty profile lists the clubs they mentor; your own profile is marked as yours", async () => {
            const faculty = await api(member).get(`/api/users/${mentor._id}/profile`);
            expect(faculty.body.data.mentoredClubs.map((item) => item.name)).toEqual(["Coding Club", "Drama Club"]);
            expect((await api(member).get(`/api/users/${member._id}/profile`)).body.data.isSelf).toBe(true);
        });

        test("signed-in users only", async () => {
            expect((await api(null).get(`/api/users/${member._id}/profile`)).status).toBe(401);
            expect((await api(member).get("/api/users/64b000000000000000000000/profile")).status).toBe(404);
        });
    });

    test("the unread count is split into events, clubs and recruitment for the activity bubble", async () => {
        await Notification.insertMany([
            { user: member._id, type: "EVENT_PUBLISHED", title: "New event" },
            { user: member._id, type: "REGISTRATION_CONFIRMED", title: "You're in" },
            { user: member._id, type: "ANNOUNCEMENT", title: "News" },
            { user: member._id, type: "RECRUITMENT_OFFER", title: "Offer" },
            { user: member._id, type: "EVENT_UPDATED", title: "Seen", readAt: new Date() }
        ]);
        const res = await api(member).get("/api/notifications/unread-count");
        expect(res.body.data).toEqual({ count: 4, kinds: { events: 2, clubs: 1, recruitment: 1 } });

        await api(member).post("/api/notifications/read-all");
        expect((await api(member).get("/api/notifications/unread-count")).body.data.count).toBe(0);
    });

    test("feed events say whether the viewer follows the club", async () => {
        const make = async (owner, host, title, venue) => {
            const created = await api(owner).post("/api/events", eventPayload(host, venue, { title }));
            await Event.updateOne({ _id: created.body.data._id }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
        };
        await make(president, club, "Hack Night", venues.auditorium);
        await make(stranger, otherClub, "Open Mic", venues.hall);
        const following = async (viewer) => {
            const res = await api(viewer).get("/api/events?timeframe=upcoming");
            return Object.fromEntries(res.body.data.map((event) => [event.title, event.followingClub]));
        };
        // Members follow their club unless they switch it off; others follow by choice.
        expect(await following(member)).toEqual({ "Hack Night": true, "Open Mic": false });
        await ClubSubscription.create({ user: member._id, club: otherClub._id, enabled: true });
        await ClubSubscription.create({ user: member._id, club: club._id, enabled: false });
        expect(await following(member)).toEqual({ "Hack Night": false, "Open Mic": true });
    });
});
