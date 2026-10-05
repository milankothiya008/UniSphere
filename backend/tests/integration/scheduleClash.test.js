const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const Team = require("../../models/Team");

beforeAll(db.connect);
afterAll(db.disconnect);

// A student can't hold places at two events at the same time; they can switch while the other hasn't started.
describe("registering for events at the same time", () => {
    let venues, club, mentor, president, asha, bina, chirag, dev;
    const ids = {};

    const publishEvent = async ({ venue, ...overrides }) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venue || venues.auditorium, overrides));
        if (draft.status !== 201) throw new Error(JSON.stringify(draft.body));
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };
    const register = (student, id, body) => api(student).post(`/api/events/${id}/register`, body);
    const statusOf = async (student, id) => (await EventRegistration.findOne({ event: id, user: student._id }))?.status;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, asha, bina, chirag, dev] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Asha" }),
            makeStudent({ name: "Bina" }),
            makeStudent({ name: "Chirag" }),
            makeStudent({ name: "Dev" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        // Day 10: A 10–13 (one seat), B 11–14, C 13–15 (right after A).
        ids.A = await publishEvent({ title: "Workshop A", eventDate: futureDate(10), startTime: "10:00", endTime: "13:00", maxParticipants: 1 });
        ids.B = await publishEvent({ title: "Talk B", venue: venues.hall, eventDate: futureDate(10), startTime: "11:00", endTime: "14:00" });
        ids.C = await publishEvent({ title: "Quiz C", eventDate: futureDate(10), startTime: "13:00", endTime: "15:00" });
        // Day 12: team event T 10–13 and individual I 11–12.
        ids.T = await publishEvent({ title: "Team Hack T", eventDate: futureDate(12), startTime: "10:00", endTime: "13:00", participationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3 });
        ids.I = await publishEvent({ title: "Seminar I", venue: venues.hall, eventDate: futureDate(12), startTime: "11:00", endTime: "12:00" });
        // Day 15: W 10–12 (one seat) and X 10–12.
        ids.W = await publishEvent({ title: "Lab W", eventDate: futureDate(15), startTime: "10:00", endTime: "12:00", maxParticipants: 1 });
        ids.X = await publishEvent({ title: "Lab X", venue: venues.hall, eventDate: futureDate(15), startTime: "10:00", endTime: "12:00" });
    });

    test("an overlapping registration is refused with the clashing event; back-to-back events are fine", async () => {
        expect((await register(asha, ids.A)).status).toBe(201);
        expect((await register(bina, ids.A)).body.data.waitlisted).toBe(true);

        const refused = await register(asha, ids.B);
        expect(refused.status).toBe(409);
        expect(refused.body.errorCode).toBe("SCHEDULE_CONFLICT");
        expect(refused.body.details.clashes).toEqual([expect.objectContaining({ event: expect.objectContaining({ title: "Workshop A" }), status: "REGISTERED", canSwitch: true })]);
        expect(await statusOf(asha, ids.B)).toBeUndefined();

        // The event page warns before the student even tries.
        expect((await api(asha).get(`/api/events/${ids.B}`)).body.data.viewer.clashes).toHaveLength(1);

        // C starts exactly when A ends: no overlap.
        expect((await register(asha, ids.C)).status).toBe(201);
    });

    test("switching gives up every overlapping place (the seat goes to the waitlist) and registers", async () => {
        // B overlaps both A and C: agreeing to give up only A isn't enough.
        const partial = await register(asha, ids.B, { replace: [ids.A] });
        expect(partial.status).toBe(409);
        expect(partial.body.details.clashes.map((clash) => clash.event.title)).toEqual(["Workshop A", "Quiz C"]);
        expect(await statusOf(asha, ids.A)).toBe("REGISTERED");

        const switched = await register(asha, ids.B, { replace: [ids.A, ids.C] });
        expect(switched.status).toBe(201);
        expect(switched.body.data.switchedFrom.map((event) => event.title)).toEqual(["Workshop A", "Quiz C"]);
        expect(await statusOf(asha, ids.B)).toBe("REGISTERED");
        expect([await statusOf(asha, ids.A), await statusOf(asha, ids.C)]).toEqual(["CANCELLED", "CANCELLED"]);
        // A's freed seat went to Bina, who was waiting.
        expect(await statusOf(bina, ids.A)).toBe("REGISTERED");
    });

    test("a waitlist place counts too", async () => {
        await register(dev, ids.W);
        expect((await register(chirag, ids.W)).body.data.waitlisted).toBe(true);
        const refused = await register(chirag, ids.X);
        expect(refused.status).toBe(409);
        expect(refused.body.details.clashes[0]).toMatchObject({ status: "WAITLISTED", event: expect.objectContaining({ title: "Lab W" }) });
        expect((await register(chirag, ids.X, { replace: [ids.W] })).status).toBe(201);
        expect(await statusOf(chirag, ids.W)).toBe("CANCELLED");
    });

    test("teams: a busy leader can't start a team without switching; a busy invitee is asked when accepting", async () => {
        await register(bina, ids.I);
        const teamsBefore = await Team.countDocuments();
        const refused = await register(bina, ids.T, { teamName: "Bina's team" });
        expect(refused.status).toBe(409);
        expect(refused.body.errorCode).toBe("SCHEDULE_CONFLICT");
        expect(await Team.countDocuments()).toBe(teamsBefore);

        await register(dev, ids.I);
        const created = await register(chirag, ids.T, { teamName: "Byte Busters", invitees: [String(dev._id)] });
        expect(created.status).toBe(201);
        // The leader sees who's busy when inviting.
        const candidates = (await api(chirag).get(`/api/events/${ids.T}/team/candidates?search=Dev`)).body.data;
        expect(candidates.find((user) => user.name === "Dev")).toMatchObject({ busyWith: "Seminar I" });
        const binaRow = (await api(chirag).get(`/api/events/${ids.T}/team/candidates?search=Bina`)).body.data[0];
        expect(binaRow).toMatchObject({ name: "Bina", busyWith: "Seminar I" });

        const teamId = created.body.data.team._id;
        const accept = await api(dev).post(`/api/events/${ids.T}/teams/${teamId}/accept`);
        expect(accept.status).toBe(409);
        expect(accept.body.details.clashes[0].event.title).toBe("Seminar I");
        const joined = await api(dev).post(`/api/events/${ids.T}/teams/${teamId}/accept`, { replace: [ids.I] });
        expect(joined.status).toBe(200);
        expect(joined.body.data.switchedFrom[0].title).toBe("Seminar I");
        expect(await statusOf(dev, ids.I)).toBe("CANCELLED");
        expect(await statusOf(dev, ids.T)).toBe("REGISTERED");
    });

    test("you can't switch away from an event that has already started", async () => {
        // B is now under way (started an hour ago, still running until day 10).
        await Event.updateOne({ _id: ids.B }, { $set: { startAt: new Date(Date.now() - 3600000) } });
        const Z = await publishEvent({ title: "Meetup Z", eventDate: futureDate(5), startTime: "10:00", endTime: "11:00", registrationEnd: new Date(Date.now() + 4 * 86400000).toISOString() });
        const refused = await register(asha, Z);
        expect(refused.status).toBe(409);
        expect(refused.body.details.clashes[0]).toMatchObject({ canSwitch: false, event: expect.objectContaining({ title: "Talk B" }) });
        const stillRefused = await register(asha, Z, { replace: [ids.B] });
        expect(stillRefused.status).toBe(409);
        expect(stillRefused.body.message).toMatch(/already started/);
        expect(await statusOf(asha, ids.B)).toBe("REGISTERED");
    });
});
