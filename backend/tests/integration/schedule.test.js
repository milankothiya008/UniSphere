const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const Club = require("../../models/Club");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("event planner schedule", () => {
    let venues, admin, mentor, codingPresident, dramaPresident, member, outsider, coding, drama;
    const day = futureDate(12);

    const makeEvent = async (president, club, status, overrides = {}) => {
        const created = await api(president).post("/api/events", eventPayload(club, overrides.venueIndex ? venues.hall : venues.auditorium, { eventDate: day, ...overrides }));
        expect(created.status).toBe(201);
        await Event.updateOne({ _id: created.body.data._id }, { $set: { status } });
        return created.body.data;
    };

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [admin, mentor, codingPresident, dramaPresident, member, outsider] = await Promise.all([
            makeAdmin(),
            makeFaculty({ name: "Mentor" }),
            makeStudent({ name: "Coding President" }),
            makeStudent({ name: "Drama President" }),
            makeStudent({ name: "Plain Member" }),
            makeStudent({ name: "Outsider" })
        ]);
        coding = await makeActiveClub({ name: "Coding Club", mentor, president: codingPresident });
        drama = await makeActiveClub({ name: "Drama Club", mentor, president: dramaPresident });
        await addMembership(coding, member, "MEMBER");

        await makeEvent(codingPresident, coding, "PUBLISHED", { title: "Hack Night", startTime: "18:00", endTime: "22:00", eligibility: { departments: ["CE", "IT"] } });
        await makeEvent(dramaPresident, drama, "PENDING_APPROVAL", { title: "Open Mic", startTime: "19:00", endTime: "21:00", venueIndex: 1 });
        await makeEvent(dramaPresident, drama, "DRAFT", { title: "Secret Draft", startTime: "10:00", endTime: "11:00", venueIndex: 1 });
        await makeEvent(codingPresident, coding, "CANCELLED", { title: "Called Off", startTime: "10:00", endTime: "11:00" });
    });

    const schedule = (viewer, from = day, days = 1) => api(viewer).get(`/api/events/schedule?from=${from}&days=${days}`);

    test("shows live and approved events, and events awaiting approval as tentative; never drafts or cancelled ones", async () => {
        const res = await schedule(dramaPresident);
        expect(res.status).toBe(200);
        expect(res.body.data.fromDate).toBe(day);
        const titles = res.body.data.items.map((item) => item.title);
        expect(titles).toEqual(["Hack Night", "Open Mic"]);
        const [hack, mic] = res.body.data.items;
        expect(hack).toMatchObject({ tentative: false, club: { name: "Coding Club" }, audience: ["CE", "IT"], mine: false });
        expect(mic).toMatchObject({ tentative: true, status: "PENDING_APPROVAL", mine: true });
        expect(new Date(hack.endAt) - new Date(hack.startAt)).toBe(4 * 3600000);
    });

    test("the window follows the university calendar day", async () => {
        const res = await schedule(admin, futureDate(13));
        expect(res.body.data.items).toEqual([]);
        const week = await schedule(admin, futureDate(9), 7);
        expect(week.body.data.items).toHaveLength(2);
    });

    test("officers, faculty and the admin can plan; plain members and other students cannot", async () => {
        for (const viewer of [admin, mentor, codingPresident]) {
            expect((await schedule(viewer)).status).toBe(200);
        }
        expect((await schedule(member)).status).toBe(403);
        expect((await schedule(outsider)).status).toBe(403);
        expect((await api(admin).get("/api/events/schedule?days=90")).status).toBe(400);
    });

    test("paused clubs' events free their slots", async () => {
        await Club.updateOne({ _id: drama._id }, { $set: { status: "SUSPENDED" } });
        const { pausedClubsCache } = require("../../utils/Caches");
        pausedClubsCache.clear();
        const res = await schedule(admin);
        expect(res.body.data.items.map((item) => item.title)).toEqual(["Hack Night"]);
        await Club.updateOne({ _id: drama._id }, { $set: { status: "ACTIVE" } });
        pausedClubsCache.clear();
    });
});
