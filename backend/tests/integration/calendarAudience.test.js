const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Notification = require("../../models/Notification");
const Event = require("../../models/Event");
const ClubSubscription = require("../../models/ClubSubscription");

beforeAll(db.connect);
afterAll(db.disconnect);

const pathOf = (url) => new URL(url).pathname;

describe("add to calendar and the personal calendar feed", () => {
    let venues, club, mentor, president, asha, bina, eventId, otherId;

    const publishEvent = async (overrides) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides));
        if (draft.status !== 201) throw new Error(JSON.stringify(draft.body));
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, asha, bina] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeStudent({ name: "Prez" }),
            makeStudent({ name: "Asha" }),
            makeStudent({ name: "Bina" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        eventId = await publishEvent({ title: "Hack Night", eventDate: futureDate(8), startTime: "18:00", endTime: "21:00" });
        otherId = await publishEvent({ title: "Quiz Day", eventDate: futureDate(9), startTime: "10:00", endTime: "12:00" });
    });

    test("anyone can download a published event as an .ics file", async () => {
        const res = await request(app).get(`/api/calendar/events/${eventId}.ics`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/text\/calendar/);
        expect(res.headers["content-disposition"]).toMatch(/Hack Night\.ics/);
        expect(res.text).toMatch(/BEGIN:VCALENDAR/);
        expect(res.text).toMatch(new RegExp(`UID:event-${eventId}@campusconnect`));
        expect(res.text).toMatch(/SUMMARY:Hack Night/);
        expect(res.text).toMatch(/STATUS:CONFIRMED/);

        const draft = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Secret draft" }));
        expect((await request(app).get(`/api/calendar/events/${draft.body.data._id}.ics`)).status).toBe(404);
    });

    test("the feed holds the student's own events, follows changes and cancellations, and its link can be reset", async () => {
        await api(asha).post(`/api/events/${eventId}/register`);
        await api(bina).post(`/api/events/${otherId}/register`);

        const link = (await api(asha).get("/api/calendar/link")).body.data;
        expect(link.webcal).toMatch(/^webcal:\/\//);
        expect(link.google).toMatch(/calendar\.google\.com/);
        const feed = await request(app).get(pathOf(link.url));
        expect(feed.status).toBe(200);
        expect(feed.text).toMatch(/SUMMARY:Hack Night/);
        expect(feed.text).not.toMatch(/Quiz Day/);
        expect(feed.text).toMatch(/REFRESH-INTERVAL/);

        // A cancelled event stays in the calendar, marked cancelled, so the calendar app updates it.
        await Event.updateOne({ _id: eventId }, { $set: { status: "CANCELLED" } });
        expect((await request(app).get(pathOf(link.url))).text).toMatch(/STATUS:CANCELLED/);

        // Someone else's token, a tampered one, or one from before a reset: not found.
        const tampered = link.url.replace(/\.([^.]+)\.ics$/, ".AAAA$1.ics");
        expect((await request(app).get(pathOf(tampered))).status).toBe(404);
        const fresh = (await api(asha).post("/api/calendar/link/reset")).body.data;
        expect(fresh.url).not.toBe(link.url);
        expect((await request(app).get(pathOf(link.url))).status).toBe(404);
        expect((await request(app).get(pathOf(fresh.url))).status).toBe(200);
        expect((await request(app).get("/api/calendar/link")).status).toBe(401);
    });
});

describe("announcements go only to the audience the club picks", () => {
    let club, mentor, president, treasurer, member, follower, itStudent, ceStudent, faculty;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [president, treasurer, member, follower, ceStudent] = await Promise.all(["Prez", "Tara", "Mona", "Fola", "Cee"].map((name) => makeStudent({ name })));
        itStudent = await makeStudent({ name: "Ita", department: "IT" });
        [mentor, faculty] = await Promise.all([makeFaculty({ name: "Dr Mentor" }), makeFaculty({ name: "Dr Other" })]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, treasurer, "TREASURER");
        await addMembership(club, member);
        await ClubSubscription.create({ club: club._id, user: follower._id, enabled: true });
    });

    const post = (body) => api(president).post("/api/feed", { club: String(club._id), title: body.title, body: "Details", ...body });
    const got = async (user, title) => Boolean(await Notification.exists({ user: user._id, type: "ANNOUNCEMENT", title: `Coding Club: ${title}` }));

    test("chosen roles, departments and people — nobody else is notified or can see it", async () => {
        const preview = await api(president).post("/api/feed/audience-preview", {
            club: String(club._id),
            audience: { mode: "CUSTOM", roles: ["TREASURER"], includeMentor: true }
        });
        expect(preview.body.data).toMatchObject({ count: 2, label: "Treasurer · Faculty mentor" });

        const res = await post({ title: "Budget meeting", audience: { mode: "CUSTOM", roles: ["TREASURER"], includeMentor: true } });
        expect(res.status).toBe(201);
        expect(await got(treasurer, "Budget meeting")).toBe(true);
        expect(await got(mentor, "Budget meeting")).toBe(true);
        for (const user of [member, follower, ceStudent, faculty]) expect(await got(user, "Budget meeting")).toBe(false);

        // Only the audience (and the club's posting team) can see the post on the club page.
        const titles = async (user) => (await api(user).get(`/api/feed?club=${club._id}`)).body.data.map((item) => item.title);
        expect(await titles(treasurer)).toContain("Budget meeting");
        expect(await titles(president)).toContain("Budget meeting");
        expect(await titles(member)).not.toContain("Budget meeting");
        expect(await titles(ceStudent)).not.toContain("Budget meeting");

        await post({ title: "IT workshop", audience: { mode: "CUSTOM", departments: ["IT"] } });
        expect(await got(itStudent, "IT workshop")).toBe(true);
        expect(await got(ceStudent, "IT workshop")).toBe(false);

        await post({ title: "Hi Cee", audience: { mode: "CUSTOM", users: [String(ceStudent._id)] } });
        expect(await got(ceStudent, "Hi Cee")).toBe(true);
        expect(await got(member, "Hi Cee")).toBe(false);

        expect((await post({ title: "Nobody", audience: { mode: "CUSTOM" } })).status).toBe(400);
        expect((await post({ title: "Bad role", audience: { mode: "CUSTOM", roles: ["NOPE"] } })).status).toBe(400);
    });

    test("followers, members, and everyone", async () => {
        await post({ title: "For followers", audience: { mode: "FOLLOWERS" } });
        expect(await got(follower, "For followers")).toBe(true);
        expect(await got(member, "For followers")).toBe(true);
        expect(await got(ceStudent, "For followers")).toBe(false);

        await post({ title: "Members only", audience: { mode: "MEMBERS" } });
        expect(await got(member, "Members only")).toBe(true);
        expect(await got(mentor, "Members only")).toBe(true);
        expect(await got(follower, "Members only")).toBe(false);

        // The old visibility field still works.
        await post({ title: "Old style", visibility: "MEMBERS" });
        expect(await got(member, "Old style")).toBe(true);
        expect(await got(follower, "Old style")).toBe(false);

        await post({ title: "Big news", audience: { mode: "EVERYONE" } });
        for (const user of [member, follower, ceStudent, faculty]) expect(await got(user, "Big news")).toBe(true);
    });
});
