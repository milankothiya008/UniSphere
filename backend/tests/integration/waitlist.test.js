const db = require("../helpers/testDb");
const {
    seedReferenceData,
    makeStudent,
    makeFaculty,
    makeActiveClub,
    addMembership,
    eventPayload,
    futureDate,
    api,
    outbox,
    flushEmails,
    mailsTo
} = require("../helpers/factory");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const Notification = require("../../models/Notification");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("event waitlist", () => {
    let venues, club, mentor, president, coordinator;

    const publishEvent = async (overrides = {}) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides));
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    const register = (student, id) => api(student).post(`/api/events/${id}/register`);
    const cancel = (student, id) => api(student).delete(`/api/events/${id}/register`);
    const statusOf = async (student, id) => (await EventRegistration.findOne({ event: id, user: student._id }))?.status;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, coordinator] = await Promise.all([makeFaculty(), makeStudent({ name: "President" }), makeStudent({ name: "Coordinator" })]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
    });

    describe("joining and promotion", () => {
        let eventId, anu, bina, chirag, dev, esha;

        beforeAll(async () => {
            eventId = await publishEvent({ title: "Hack Night", maxParticipants: 2, eventDate: futureDate(10) });
            [anu, bina, chirag, dev, esha] = await Promise.all(["Anu", "Bina", "Chirag", "Dev", "Esha"].map((name) => makeStudent({ name })));
            outbox.length = 0;
        });

        test("once the event is full, students join the waitlist in order instead of being turned away", async () => {
            expect((await register(anu, eventId)).body.data.waitlisted).toBe(false);
            expect((await register(bina, eventId)).body.data.waitlisted).toBe(false);

            const third = await register(chirag, eventId);
            expect(third.status).toBe(201);
            expect(third.body.message).toBe("This event is full. You're #1 on the waitlist.");
            expect(third.body.data).toMatchObject({ waitlisted: true, waitlistPosition: 1, registeredCount: 2, waitlistCount: 1 });

            expect((await register(dev, eventId)).body.data.waitlistPosition).toBe(2);

            const detail = await api(dev).get(`/api/events/${eventId}`);
            expect(detail.body.data.registrationState).toBe("FULL");
            expect(detail.body.data.waitlistCount).toBe(2);
            expect(detail.body.data.viewer.registration).toMatchObject({ status: "WAITLISTED", waitlistPosition: 2 });

            expect(await Notification.exists({ user: chirag._id, type: "WAITLISTED", title: "You're #1 on the waitlist for Hack Night" })).toBeTruthy();
        });

        test("joining twice is refused with the current place in the queue", async () => {
            const again = await register(chirag, eventId);
            expect(again.status).toBe(409);
            expect(again.body.message).toBe("You are already on the waitlist (#1)");
        });

        test("a cancellation promotes the first student waiting and emails them", async () => {
            outbox.length = 0;
            const res = await cancel(anu, eventId);
            expect(res.body.data).toMatchObject({ leftWaitlist: false, promoted: 1, registeredCount: 2, waitlistCount: 1 });

            const promoted = await EventRegistration.findOne({ event: eventId, user: chirag._id });
            expect(promoted.status).toBe("REGISTERED");
            expect(promoted.promotedAt).toBeInstanceOf(Date);
            expect(await Notification.exists({ user: chirag._id, type: "REGISTRATION_CONFIRMED", title: "You're in! A spot opened up for Hack Night" })).toBeTruthy();

            await flushEmails();
            const [mail] = mailsTo(chirag.email).filter((m) => /spot opened up/.test(m.subject));
            expect(mail.subject).toBe("You're in! A spot opened up for Hack Night");
            expect(mail.text).toMatch(/moved off the waitlist and are now registered/);

            // Dev moves up to the front of the queue.
            expect((await api(dev).get(`/api/events/${eventId}`)).body.data.viewer.registration.waitlistPosition).toBe(1);
        });

        test("leaving the waitlist frees the place without touching seats", async () => {
            const res = await cancel(dev, eventId);
            expect(res.body.message).toBe("You left the waitlist");
            const event = await Event.findById(eventId);
            expect(event).toMatchObject({ registeredCount: 2, waitlistCount: 0 });
            expect(await statusOf(dev, eventId)).toBe("CANCELLED");
        });

        test("a newcomer cannot jump ahead of the queue", async () => {
            await register(dev, eventId); // back on the waitlist (#1)
            // An organiser removes a participant; the seat goes to Dev, not to Esha who registers right after.
            const participants = await api(president).get(`/api/events/${eventId}/registrations`);
            const bRow = participants.body.data.find((row) => row.user.name === "Bina");
            await api(president).delete(`/api/events/${eventId}/registrations/${bRow._id}`, { reason: "Duplicate team entry" });

            expect(await statusOf(dev, eventId)).toBe("REGISTERED");
            expect((await register(esha, eventId)).body.data).toMatchObject({ waitlisted: true, waitlistPosition: 1 });
        });

        test("organisers see the waitlist in order", async () => {
            const res = await api(coordinator).get(`/api/events/${eventId}/registrations`);
            expect(res.body.data.map((row) => row.user.name).sort()).toEqual(["Chirag", "Dev"]);
            expect(res.body.meta.waitlist.map((row) => [row.position, row.user.name])).toEqual([[1, "Esha"]]);
            expect(res.body.meta.event.waitlistCount).toBe(1);
        });

        test("raising the capacity (once the mentor approves the change) promotes waiting students immediately", async () => {
            const extra = await makeStudent({ name: "Farah" });
            await register(extra, eventId);
            expect((await Event.findById(eventId)).waitlistCount).toBe(2);

            const res = await api(president).put(`/api/events/${eventId}`, { maxParticipants: 4 });
            expect(res.status).toBe(200);
            expect((await Event.findById(eventId)).maxParticipants).toBe(2);
            await api(mentor).post(`/api/events/${eventId}/changes/approve`);
            expect((await api(president).post(`/api/events/${eventId}/changes/publish`)).status).toBe(200);
            const event = (await Event.findById(eventId)).toObject();
            expect(event).toMatchObject({ registeredCount: 4, waitlistCount: 0 });
            expect(await statusOf(esha, eventId)).toBe("REGISTERED");
            expect(await statusOf(extra, eventId)).toBe("REGISTERED");
        });

        test("my registrations can include waitlisted events with their place", async () => {
            const waiting = await makeStudent({ name: "Gita" });
            await register(waiting, eventId);
            const mine = await api(waiting).get("/api/registrations/me?includeWaitlist=true");
            expect(mine.body.data).toHaveLength(1);
            expect(mine.body.data[0]).toMatchObject({ status: "WAITLISTED", waitlistPosition: 1 });
            expect((await api(waiting).get("/api/registrations/me")).body.data).toHaveLength(0);
        });

        test("waitlisted students hear when the event is cancelled", async () => {
            const res = await api(president).post(`/api/events/${eventId}/cancel`, { reason: "Venue unavailable" });
            expect(res.status).toBe(200);
            const gita = await EventRegistration.findOne({ event: eventId, status: "WAITLISTED" });
            expect(await Notification.exists({ user: gita.user, type: "EVENT_CANCELLED" })).toBeTruthy();
        });
    });

    test("parallel cancellations never overfill the event or promote anyone twice", async () => {
        const eventId = await publishEvent({ title: "Rush Hour", maxParticipants: 3, eventDate: futureDate(12), startTime: "15:00", endTime: "16:00" });
        const students = await Promise.all(Array.from({ length: 8 }, () => makeStudent()));
        for (const student of students) {
            await register(student, eventId);
        }
        expect(await Event.findById(eventId)).toMatchObject({ registeredCount: 3, waitlistCount: 5 });

        await Promise.all(students.slice(0, 3).map((student) => cancel(student, eventId)));

        const event = await Event.findById(eventId);
        expect(event.registeredCount).toBe(3);
        expect(event.waitlistCount).toBe(2);
        expect(await EventRegistration.countDocuments({ event: eventId, status: "REGISTERED" })).toBe(3);
        // Promotion follows the queue: students 4-6 got the seats, 7-8 still wait.
        for (const student of students.slice(3, 6)) {
            expect(await statusOf(student, eventId)).toBe("REGISTERED");
        }
        for (const student of students.slice(6)) {
            expect(await statusOf(student, eventId)).toBe("WAITLISTED");
        }
    });

    test("the president's dashboard shows club statistics; other officers don't get them", async () => {
        const res = await api(president).get("/api/dashboard");
        const workspace = res.body.data.student.clubWorkspaces.find((w) => w.club.name === "Coding Club");
        expect(workspace.insights).toMatchObject({
            // Hack Night was cancelled above, so only Rush Hour counts.
            totalMembers: 2,
            totalEvents: 1,
            eventsInPipeline: 0,
            upcomingEvents: 1,
            completedEvents: 0,
            totalRegistrations: 3,
            averageParticipation: 3,
            waitlisted: 2
        });
        expect(workspace.insights.seatFillRate).toBe(100);
        expect(workspace.insights.eventWise.map((e) => [e.title, e.registered, e.capacity, e.waitlist])).toEqual([["Rush Hour", 3, 3, 2]]);

        const other = await api(coordinator).get("/api/dashboard");
        expect(other.body.data.student.clubWorkspaces.find((w) => w.club.name === "Coding Club").insights).toBeNull();
    });
});
