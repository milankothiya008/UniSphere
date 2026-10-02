const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api, flushEmails, mailsTo } = require("../helpers/factory");
const Club = require("../../models/Club");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const Notification = require("../../models/Notification");
const { sweepEventReminders } = require("../../services/EventReminderService");
const { sweepFeedbackRequests } = require("../../services/FeedbackService");
const { DEFAULT_ROLES } = require("../../utils/ClubRoles");

beforeAll(db.connect);
afterAll(db.disconnect);

const HOUR = 3600000;
const fromNow = (ms) => new Date(Date.now() + ms);
const binary = (req) =>
    req.buffer(true).parse((res, done) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
    });

describe("multi-day events, reminders, feedback, records and people", () => {
    let venues, mentor, president, coordinator, plainMember, asha, bina, chirag, club, eventId;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, coordinator, plainMember, asha, bina, chirag] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Coordinator" }),
            makeStudent({ name: "Plain Member" }),
            makeStudent({ name: "Asha Patel" }),
            makeStudent({ name: "Bina Shah" }),
            makeStudent({ name: "Chirag Rao", department: "IT" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        // The president gives the event coordinator the reminder authority.
        const roles = DEFAULT_ROLES().map((role) => (role.key === "EVENT_COORDINATOR" ? { ...role, permissions: [...role.permissions, "SEND_REMINDERS"] } : role));
        await Club.updateOne({ _id: club._id }, { $set: { roles } });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, plainMember, "MEMBER");
    });

    describe("multi-day events", () => {
        test("an event can't end before it starts or run longer than a week", async () => {
            const backwards = await api(president).post("/api/events", eventPayload(club, venues.hall, { eventDate: futureDate(10), endDate: futureDate(9) }));
            expect(backwards.status).toBe(400);
            const tooLong = await api(president).post("/api/events", eventPayload(club, venues.hall, { eventDate: futureDate(10), endDate: futureDate(18) }));
            expect(tooLong.body.message).toMatch(/at most 7 days/);
        });

        test("a two-day event holds its venue across both days", async () => {
            const fest = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Tech Fest", eventDate: futureDate(20), endDate: futureDate(21), startTime: "09:00", endTime: "17:00" }));
            expect(fest.status).toBe(201);
            await api(president).post(`/api/events/${fest.body.data._id}/submit`);
            const clash = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Morning talk", eventDate: futureDate(21), startTime: "10:00", endTime: "11:00" }));
            expect(clash.status).toBe(409);
            const free = await api(president).get(`/api/venues/available?eventDate=${futureDate(20)}&endDate=${futureDate(21)}&startTime=09:00&endTime=17:00`);
            expect(free.body.data.find((venue) => venue.name === "Seminar Hall A").available).toBe(false);
            expect(free.body.data.find((venue) => venue.name === "Auditorium").available).toBe(true);
        });
    });

    describe("reminders", () => {
        beforeAll(async () => {
            const created = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Hack Night", eventDate: futureDate(5), registrationEnd: fromNow(72 * HOUR).toISOString(), eligibility: { departments: ["CE"] } }));
            eventId = created.body.data._id;
            await Event.updateOne({ _id: eventId }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
            expect((await api(asha).post(`/api/events/${eventId}/register`)).status).toBe(201);
        });

        test("the button is there only for roles with the reminder authority", async () => {
            const view = (await api(president).get(`/api/events/${eventId}`)).body.data.viewer;
            expect(view.canSendReminders).toBe(true);
            expect(view.reminders.REGISTRATION_CLOSING.available).toBe(true);
            expect((await api(plainMember).get(`/api/events/${eventId}`)).body.data.viewer.reminders).toBeUndefined();
            expect((await api(plainMember).post(`/api/events/${eventId}/reminders`, { kind: "EVENT_STARTING" })).status).toBe(403);
            expect((await api(asha).get(`/api/events/${eventId}`)).body.data.remindersSent).toBeUndefined();
        });

        test("'registration closing' reaches eligible students who haven't registered, once every few hours", async () => {
            const sent = await api(president).post(`/api/events/${eventId}/reminders`, { kind: "REGISTRATION_CLOSING", note: "Only 10 seats left!" });
            expect(sent.status).toBe(200);
            const notified = await Notification.find({ type: "EVENT_REMINDER", title: /Registration closes/ }).distinct("user");
            const ids = notified.map(String);
            expect(ids).toContain(String(bina._id));
            expect(ids).not.toContain(String(asha._id)); // already registered
            expect(ids).not.toContain(String(chirag._id)); // IT student, event is for CE
            await flushEmails();
            expect(mailsTo(bina.email).some((mail) => /Only 10 seats left!/.test(mail.text))).toBe(true);

            const again = await api(president).post(`/api/events/${eventId}/reminders`, { kind: "REGISTRATION_CLOSING" });
            expect(again.status).toBe(409);
            expect(again.body.message).toMatch(/you can send another after/);
        });

        test("a role given the authority sends 'starting soon' to everyone registered", async () => {
            const sent = await api(coordinator).post(`/api/events/${eventId}/reminders`, { kind: "EVENT_STARTING" });
            expect(sent.status).toBe(200);
            expect(sent.body.data.recipients).toBe(1);
            expect(await Notification.exists({ user: asha._id, type: "EVENT_REMINDER", title: /Starts in/ })).toBeTruthy();
        });

        test("registered students are reminded automatically a day before and an hour before, once each", async () => {
            await Event.updateOne({ _id: eventId }, { $set: { startAt: fromNow(23.5 * HOUR), endAt: fromNow(26 * HOUR), registrationEnd: fromNow(20 * HOUR) } });
            expect(await sweepEventReminders()).toBe(1);
            expect(await sweepEventReminders()).toBe(0);
            expect(await Notification.countDocuments({ user: asha._id, title: /^Tomorrow:/ })).toBe(1);

            await Event.updateOne({ _id: eventId }, { $set: { startAt: fromNow(HOUR), endAt: fromNow(3 * HOUR), registrationEnd: fromNow(0.5 * HOUR) } });
            expect(await sweepEventReminders()).toBe(1);
            expect(await Notification.countDocuments({ user: asha._id, title: /^Starting soon:/ })).toBe(1);
        });
    });

    describe("feedback", () => {
        test("attendees rate the event after it ends; the club sees the average and notes without names", async () => {
            expect((await api(asha).put(`/api/events/${eventId}/feedback`, { rating: 5 })).status).toBe(409);

            await Event.updateOne({ _id: eventId }, { $set: { startAt: fromNow(-3 * HOUR), endAt: fromNow(-HOUR), registrationEnd: fromNow(-5 * HOUR), registrationStart: fromNow(-48 * HOUR) } });
            expect(await sweepFeedbackRequests()).toBe(1);
            expect(await sweepFeedbackRequests()).toBe(0);
            expect(await Notification.exists({ user: asha._id, type: "FEEDBACK_REQUEST" })).toBeTruthy();

            const mine = await api(asha).put(`/api/events/${eventId}/feedback`, { rating: 4, note: "Great mentors, but the Wi-Fi was slow." });
            expect(mine.status).toBe(200);
            expect(mine.body.data).toMatchObject({ canGive: true, mine: { rating: 4 } });
            expect((await api(bina).put(`/api/events/${eventId}/feedback`, { rating: 1 })).status).toBe(403);
            expect((await api(asha).put(`/api/events/${eventId}/feedback`, { rating: 6 })).status).toBe(400);

            const summary = (await api(president).get(`/api/events/${eventId}/feedback`)).body.data.summary;
            expect(summary).toMatchObject({ count: 1, average: 4, distribution: [0, 0, 0, 1, 0], attendees: 1 });
            expect(summary.notes).toEqual([expect.objectContaining({ rating: 4, note: "Great mentors, but the Wi-Fi was slow." })]);
            expect(JSON.stringify(summary)).not.toContain(String(asha._id));
            expect((await api(mentor).get(`/api/events/${eventId}/feedback`)).body.data.summary.count).toBe(1);
            expect((await api(bina).get(`/api/events/${eventId}/feedback`)).body.data.summary).toBeNull();
        });

        test("once check-in is used, only students who were checked in can rate", async () => {
            await Event.updateOne({ _id: eventId }, { $set: { "checkIn.status": "CLOSED" } });
            expect((await api(asha).put(`/api/events/${eventId}/feedback`, { rating: 3 })).status).toBe(403);
            await EventRegistration.updateOne({ event: eventId, user: asha._id }, { $set: { checkedInAt: new Date() } });
            expect((await api(asha).put(`/api/events/${eventId}/feedback`, { rating: 3 })).status).toBe(200);
        });
    });

    describe("participation record, people and photos", () => {
        test("a student downloads their participation record as a PDF", async () => {
            const res = await binary(api(asha).get("/api/users/me/record.pdf"));
            expect(res.status).toBe(200);
            expect(res.headers["content-disposition"]).toMatch(/Asha_Patel_participation_record\.pdf/);
            expect(res.body.subarray(0, 4).toString()).toBe("%PDF");
        });

        test("people search finds students and faculty by name, without contact details", async () => {
            const res = await api(bina).get("/api/users/people?q=asha");
            expect(res.body.data).toEqual([expect.objectContaining({ name: "Asha Patel", departmentCode: "CE" })]);
            expect(res.body.data[0]).not.toHaveProperty("email");
            expect(res.body.data[0]).not.toHaveProperty("phone");
            expect((await api(bina).get("/api/users/people?q=a")).body.data).toEqual([]);
            expect((await api(bina).get("/api/users/people?q=mentor")).body.data.map((person) => person.name)).toEqual(["Dr Mentor"]);
        });

        test("students set a profile photo, which shows on their profile", async () => {
            const photo = "https://res.cloudinary.com/demo/image/upload/v1/campusconnect/avatars/asha.png";
            expect((await api(asha).put(`/api/users/${asha._id}`, { avatar: photo })).body.data.avatar).toBe(photo);
            expect((await api(asha).get("/api/auth/me")).body.data.avatar).toBe(photo);
            expect((await api(bina).get(`/api/users/${asha._id}/profile`)).body.data.avatar).toBe(photo);
            expect((await api(asha).put(`/api/users/${asha._id}`, { avatar: "javascript:alert(1)" })).status).toBe(400);
            expect((await api(asha).put(`/api/users/${asha._id}`, { avatar: null })).body.data.avatar).toBeNull();
        });

        test("push is off until the server has VAPID keys", async () => {
            expect((await api(null).get("/api/push/public-key")).body.data).toEqual({ publicKey: null });
            const subscribe = await api(asha).post("/api/push/subscribe", { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "key", auth: "auth" } });
            expect(subscribe.status).toBe(503);
        });
    });
});
