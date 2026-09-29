const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, eventPayload, futureDate, api } = require("../helpers/factory");
const Club = require("../../models/Club");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("department labs", () => {
    let admin, mentor, president, allPresident, venues, club, openClub, ceLab, itLab, meLab;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [admin, mentor, president, allPresident] = await Promise.all([makeAdmin(), makeFaculty(), makeStudent({ name: "CE President" }), makeStudent({ name: "Open President" })]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await Club.updateOne({ _id: club._id }, { $set: { departmentCodes: ["CE", "IT"] } });
        openClub = await makeActiveClub({ name: "Music Club", mentor, president: allPresident });
        await Club.updateOne({ _id: openClub._id }, { $set: { allDepartments: true, departmentCodes: [] } });
    });

    test("the admin adds labs that belong to departments", async () => {
        const noDepartment = await api(admin).post("/api/venues", { name: "Robotics Lab", location: "ME Block", capacity: 30, type: "LAB" });
        expect(noDepartment.status).toBe(400);
        expect(noDepartment.body.message).toMatch(/department/);
        expect((await api(admin).post("/api/venues", { name: "X Lab", location: "Nowhere", capacity: 30, type: "LAB", departmentCodes: ["ZZ"] })).body.message).toMatch(/Unknown department: ZZ/);
        expect((await api(president).post("/api/venues", { name: "Sneaky Lab", location: "CE", capacity: 30, type: "LAB", departmentCodes: ["CE"] })).status).toBe(403);

        ceLab = (await api(admin).post("/api/venues", { name: "CE Software Lab", location: "CE Block", capacity: 60, type: "LAB", departmentCodes: ["ce"] })).body.data;
        itLab = (await api(admin).post("/api/venues", { name: "IT Networks Lab", location: "IT Block", capacity: 50, type: "LAB", departmentCodes: ["IT"] })).body.data;
        meLab = (await api(admin).post("/api/venues", { name: "ME Workshop", location: "ME Block", capacity: 40, type: "LAB", departmentCodes: ["ME"] })).body.data;
        expect(ceLab).toMatchObject({ type: "LAB", departmentCodes: ["CE"] });

        // A hall never keeps departments.
        const hall = await api(admin).put(`/api/venues/${venues.hall._id}`, { type: "HALL", departmentCodes: ["CE"] });
        expect(hall.body.data).toMatchObject({ type: "HALL", departmentCodes: [] });
    });

    test("availability lists only the labs of the event's departments", async () => {
        const window = `eventDate=${futureDate(10)}&startTime=10:00&endTime=12:00`;
        const names = async (user, extra) => (await api(user).get(`/api/venues/available?${window}&${extra}`)).body.data.map((venue) => venue.name);

        // Coding Club (CE, IT): CE and IT labs, never the ME workshop; halls are always there.
        expect(await names(president, `club=${club._id}`)).toEqual(expect.arrayContaining(["CE Software Lab", "IT Networks Lab", "Auditorium"]));
        expect(await names(president, `club=${club._id}`)).not.toContain("ME Workshop");
        // An event for IT students only: only the IT lab.
        const itOnly = await names(president, `club=${club._id}&departments=IT`);
        expect(itOnly).toContain("IT Networks Lab");
        expect(itOnly).not.toContain("CE Software Lab");
        // An all-department club: every lab — unless the event names its departments.
        expect(await names(allPresident, `club=${openClub._id}`)).toEqual(expect.arrayContaining(["CE Software Lab", "IT Networks Lab", "ME Workshop"]));
        expect(await names(allPresident, `club=${openClub._id}&departments=ME`)).not.toContain("CE Software Lab");
        // The plain venue list filters the same way.
        expect((await api(president).get(`/api/venues?status=ACTIVE&club=${club._id}`)).body.data.map((venue) => venue.name)).not.toContain("ME Workshop");
    });

    test("events can't book another department's lab, on create or on edit", async () => {
        const wrong = await api(president).post("/api/events", eventPayload(club, meLab));
        expect(wrong.status).toBe(400);
        expect(wrong.body.message).toMatch(/ME Workshop is a ME lab/);

        const itEvent = await api(president).post("/api/events", eventPayload(club, itLab, { title: "Networking 101", eligibility: { departments: ["IT"] } }));
        expect(itEvent.status).toBe(201);
        // Narrowing the audience to CE makes the IT lab wrong.
        const narrowed = await api(president).put(`/api/events/${itEvent.body.data._id}`, { eligibility: { departments: ["CE"] } });
        expect(narrowed.status).toBe(400);
        expect(narrowed.body.message).toMatch(/IT Networks Lab/);
        expect((await api(president).put(`/api/events/${itEvent.body.data._id}`, { venue: String(ceLab._id), eligibility: { departments: ["CE"] } })).status).toBe(200);

        // An all-department club's open event may use any lab.
        expect((await api(allPresident).post("/api/events", eventPayload(openClub, meLab, { title: "Jam session", maxParticipants: 30 }))).status).toBe(201);
    });
});
