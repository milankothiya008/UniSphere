const db = require("../helpers/testDb");
const {
    seedReferenceData,
    makeStudent,
    makeFaculty,
    makeAdmin,
    makeActiveClub,
    addMembership,
    eventPayload,
    futureDate,
    api
} = require("../helpers/factory");
const FeedPost = require("../../models/FeedPost");
const Notification = require("../../models/Notification");
const AuditLog = require("../../models/AuditLog");
const Event = require("../../models/Event");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("event lifecycle", () => {
    let venues, mentor, otherFaculty, admin, president, coordinator, member, outsider, club, otherClub, otherPresident;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, otherFaculty, admin, president, coordinator, member, outsider, otherPresident] = await Promise.all([
            makeFaculty({ name: "Mentor" }),
            makeFaculty({ name: "Other Faculty" }),
            makeAdmin(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Event Coordinator" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Outsider" }),
            makeStudent({ name: "Other President" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        otherClub = await makeActiveClub({ name: "Drama Club", mentor: otherFaculty, president: otherPresident });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, member, "MEMBER");
    });

    let eventId;

    test("plain members, outsiders and other clubs cannot create events for the club", async () => {
        const body = eventPayload(club, venues.auditorium);
        expect((await api(member).post("/api/events", body)).status).toBe(403);
        expect((await api(outsider).post("/api/events", body)).status).toBe(403);
        expect((await api(otherPresident).post("/api/events", body)).status).toBe(403);
    });

    test("validates schedule, deadline and capacity", async () => {
        const badDeadline = eventPayload(club, venues.auditorium, {
            registrationEnd: new Date(Date.now() + 30 * 86400000).toISOString()
        });
        expect((await api(president).post("/api/events", badDeadline)).status).toBe(400);

        const tooBig = eventPayload(club, venues.hall, { maxParticipants: 500 });
        const res = await api(president).post("/api/events", tooBig);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/capacity/);

        const backwards = eventPayload(club, venues.auditorium, { startTime: "14:00", endTime: "12:00" });
        expect((await api(president).post("/api/events", backwards)).status).toBe(400);
    });

    test("an event coordinator creates a draft with rules, contact and eligibility", async () => {
        const res = await api(coordinator).post(
            "/api/events",
            eventPayload(club, venues.auditorium, { eligibility: { departments: ["ce", "IT"], batches: ["24"] } })
        );
        expect(res.status).toBe(201);
        expect(res.body.data.status).toBe("DRAFT");
        expect(res.body.data.eligibility.departments).toEqual(["CE", "IT"]);
        expect(res.body.data.startAt).toMatch(/T04:30:00/);
        eventId = res.body.data._id;
    });

    test("drafts are not publicly visible", async () => {
        expect((await api(null).get(`/api/events/${eventId}`)).status).toBe(404);
        expect((await api(member).get(`/api/events/${eventId}`)).status).toBe(404);
        const list = await api(null).get("/api/events");
        expect(list.body.data.find((e) => e._id === eventId)).toBeUndefined();
    });

    test("submits to the mentor; only the club's mentor or an admin can review", async () => {
        const res = await api(president).post(`/api/events/${eventId}/submit`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("PENDING_APPROVAL");
        expect(await Notification.exists({ user: mentor._id, type: "EVENT_REVIEW" })).toBeTruthy();

        expect((await api(otherFaculty).post(`/api/events/${eventId}/approve`)).status).toBe(403);
        expect((await api(president).post(`/api/events/${eventId}/approve`)).status).toBe(403);
        expect((await api(president).put(`/api/events/${eventId}`, { title: "Changed while pending" })).status).toBe(409);
    });

    test("mentor requests changes; the club edits and resubmits", async () => {
        const changes = await api(mentor).post(`/api/events/${eventId}/request-changes`, {
            comment: "Please move this to Seminar Hall A and cap it at 40."
        });
        expect(changes.body.data.status).toBe("NEEDS_CHANGES");
        expect(changes.body.data.reviewComment).toMatch(/Seminar Hall A/);

        const edit = await api(coordinator).put(`/api/events/${eventId}`, { venue: String(venues.hall._id), maxParticipants: 40 });
        expect(edit.status).toBe(200);
        expect(edit.body.data.venue.name).toBe("Seminar Hall A");

        const resubmit = await api(president).post(`/api/events/${eventId}/submit`);
        expect(resubmit.body.data.status).toBe("PENDING_APPROVAL");
    });

    test("mentor approves; the event is still not public until published", async () => {
        const res = await api(mentor).post(`/api/events/${eventId}/approve`, { comment: "Good to go" });
        expect(res.body.data.status).toBe("APPROVED");
        expect((await api(outsider).get(`/api/events/${eventId}`)).status).toBe(404);
    });

    test("venue conflicts are detected against approved/published events with a clear message", async () => {
        const overlapping = eventPayload(otherClub, venues.hall, { title: "Drama Rehearsal", startTime: "11:00", endTime: "14:00", maxParticipants: 30 });
        const res = await api(otherPresident).post("/api/events", overlapping);
        expect(res.status).toBe(409);
        expect(res.body.errorCode).toBe("VENUE_CONFLICT");
        expect(res.body.message).toMatch(/Seminar Hall A is already booked 10:00–13:00 for "Hack Night"/);
        expect(res.body.details.conflicts[0].title).toBe("Hack Night");

        const backToBack = eventPayload(otherClub, venues.hall, { title: "Drama Evening", startTime: "13:00", endTime: "15:00", maxParticipants: 30 });
        expect((await api(otherPresident).post("/api/events", backToBack)).status).toBe(201);
    });

    test("a submitted event reserves its venue until the mentor sends it back", async () => {
        const drama = await api(otherPresident).post(
            "/api/events",
            eventPayload(otherClub, venues.auditorium, { title: "Drama Showcase", startTime: "09:00", endTime: "11:00", maxParticipants: 100 })
        );

        // A draft alone does not hold the venue...
        const rival = await api(president).post(
            "/api/events",
            eventPayload(club, venues.auditorium, { title: "Morning Talk", startTime: "10:30", endTime: "12:00", maxParticipants: 100 })
        );
        expect(rival.status).toBe(201);

        // ...but submitting does, so the first club to submit gets the slot.
        expect((await api(otherPresident).post(`/api/events/${drama.body.data._id}/submit`)).status).toBe(200);
        const blocked = await api(president).post(`/api/events/${rival.body.data._id}/submit`);
        expect(blocked.status).toBe(409);
        expect(blocked.body.errorCode).toBe("VENUE_CONFLICT");
        expect(blocked.body.message).toBe(
            'Auditorium is already requested 09:00–11:00 for "Drama Showcase" (Drama Club), which is awaiting faculty approval. Choose another venue or time.'
        );

        // New drafts for that slot are warned straight away, and the picker says who holds the venue.
        const again = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Another Talk", startTime: "10:00", endTime: "10:30", maxParticipants: 100 }));
        expect(again.body.errorCode).toBe("VENUE_CONFLICT");

        const slot = await api(president).get(`/api/venues/available?eventDate=${eventPayload(club, venues.auditorium).eventDate}&startTime=10:30&endTime=12:00`);
        const auditorium = slot.body.data.find((venue) => venue._id === String(venues.auditorium._id));
        expect(auditorium.available).toBe(false);
        expect(auditorium.bookedBy).toEqual([{ title: "Drama Showcase", club: "Drama Club", startTime: "09:00", endTime: "11:00", pendingApproval: true }]);

        // Sending the request back for changes frees the venue for others.
        await api(otherFaculty).post(`/api/events/${drama.body.data._id}/request-changes`, { comment: "Please pick another slot." });
        expect((await api(president).post(`/api/events/${rival.body.data._id}/submit`)).status).toBe(200);
        expect((await api(mentor).post(`/api/events/${rival.body.data._id}/approve`)).status).toBe(200);

        const resubmit = await api(otherPresident).post(`/api/events/${drama.body.data._id}/submit`);
        expect(resubmit.status).toBe(409);
        expect(resubmit.body.errorCode).toBe("VENUE_CONFLICT");
    });

    test("two clubs submitting the same slot at the same moment: only one gets the venue", async () => {
        const eventDate = futureDate(30);
        const [first, second] = await Promise.all([
            api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Race A", eventDate, maxParticipants: 100 })),
            api(otherPresident).post("/api/events", eventPayload(otherClub, venues.auditorium, { title: "Race B", eventDate, startTime: "11:00", endTime: "12:00", maxParticipants: 100 }))
        ]);

        const results = await Promise.all([
            api(president).post(`/api/events/${first.body.data._id}/submit`),
            api(otherPresident).post(`/api/events/${second.body.data._id}/submit`)
        ]);
        expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
        expect(await Event.countDocuments({ title: /^Race /, status: "PENDING_APPROVAL" })).toBe(1);

        await Event.deleteMany({ title: /^Race / });
    });

    test("rejects past dates and registration deadlines that have already passed", async () => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const past = await api(president).post(
            "/api/events",
            eventPayload(club, venues.hall, { eventDate: yesterday, registrationEnd: new Date(Date.now() - 2 * 86400000).toISOString() })
        );
        expect(past.status).toBe(400);
        expect(past.body.message).toBe("Event must be scheduled in the future");

        const closedDeadline = await api(president).post(
            "/api/events",
            eventPayload(club, venues.hall, {
                eventDate: futureDate(12),
                registrationStart: new Date(Date.now() - 3 * 86400000).toISOString(),
                registrationEnd: new Date(Date.now() - 3600000).toISOString()
            })
        );
        expect(closedDeadline.status).toBe(400);
        expect(closedDeadline.body.message).toBe("Registration deadline must be in the future");

        // A draft whose deadline slipped by while it sat unsubmitted must be fixed before submission.
        const draft = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Stale Draft", eventDate: futureDate(12) }));
        await Event.updateOne({ _id: draft.body.data._id }, { registrationStart: new Date(Date.now() - 7200000), registrationEnd: new Date(Date.now() - 3600000) });
        const submit = await api(president).post(`/api/events/${draft.body.data._id}/submit`);
        expect(submit.status).toBe(409);
        expect(submit.body.message).toMatch(/registration deadline has passed/);

        await Event.deleteOne({ _id: draft.body.data._id });
    });

    test("only roles with PUBLISH_EVENTS can publish; publishing shows it in the event feed and notifies everyone", async () => {
        expect((await api(coordinator).post(`/api/events/${eventId}/publish`)).status).toBe(403);

        const res = await api(president).post(`/api/events/${eventId}/publish`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("PUBLISHED");

        expect(await FeedPost.exists({ event: eventId, type: "EVENT" })).toBeNull();
        // Everyone on campus hears about it, not just club members.
        for (const user of [member, outsider, otherFaculty, admin]) {
            expect(await Notification.exists({ user: user._id, type: "EVENT_PUBLISHED" })).toBeTruthy();
        }
        expect(await Notification.exists({ user: president._id, type: "EVENT_PUBLISHED" })).toBeNull();

        const feed = await api(outsider).get("/api/events?timeframe=upcoming&withCounts=true");
        expect(feed.body.data.map((e) => e.title)).toContain("Hack Night");
        expect(feed.body.meta.counts).toEqual(expect.objectContaining({ upcoming: 1, ongoing: 0, past: 0 }));
        expect((await api(outsider).get(`/api/events/${eventId}`)).status).toBe(200);
    });

    test("an update note on a published event is posted straight to the event page", async () => {
        const res = await api(president).put(`/api/events/${eventId}`, { updateNote: "Please bring your charger!" });
        expect(res.status).toBe(200);
        expect(await FeedPost.exists({ event: eventId, type: "EVENT_UPDATE" })).toBeTruthy();
    });

    test("discovery lists upcoming events with filters and search", async () => {
        const upcoming = await api(outsider).get("/api/events?timeframe=upcoming&category=TECHNOLOGY&search=hack");
        expect(upcoming.body.data.map((e) => e.title)).toEqual(["Hack Night"]);
        expect(upcoming.body.data[0].registrationState).toBe("OPEN");
        expect(upcoming.body.meta.total).toBe(1);

        const past = await api(outsider).get("/api/events?timeframe=past");
        expect(past.body.data).toHaveLength(0);
    });

    test("mentor sees pending work in the managed list; the admin and outsiders see nothing", async () => {
        const mine = await api(mentor).get("/api/events/manage?status=APPROVED,PUBLISHED");
        expect(mine.body.data.map((e) => e.title).sort()).toEqual(["Hack Night", "Morning Talk"]);
        // The university admin has no club authority, so there is nothing for them to manage.
        expect((await api(admin).get("/api/events/manage")).body.data).toHaveLength(0);
        expect((await api(outsider).get("/api/events/manage")).body.data).toHaveLength(0);
    });

    test("rejection is final; cancelling a published event requires a reason", async () => {
        const draft = await api(president).post(
            "/api/events",
            eventPayload(club, venues.auditorium, { title: "Rejected Idea", eventDate: require("../helpers/factory").futureDate(20), maxParticipants: 10 })
        );
        await api(president).post(`/api/events/${draft.body.data._id}/submit`);
        const rejected = await api(mentor).post(`/api/events/${draft.body.data._id}/reject`, { reason: "Not suitable for campus." });
        expect(rejected.body.data.status).toBe("REJECTED");
        expect((await api(president).post(`/api/events/${draft.body.data._id}/submit`)).status).toBe(409);

        expect((await api(president).post(`/api/events/${eventId}/cancel`)).status).toBe(400);
    });

    test("an event can only be completed after it starts", async () => {
        expect((await api(president).post(`/api/events/${eventId}/complete`)).status).toBe(409);

        await Event.updateOne(
            { _id: eventId },
            { startAt: new Date(Date.now() - 3 * 3600000), endAt: new Date(Date.now() - 3600000), registrationEnd: new Date(Date.now() - 4 * 3600000), registrationStart: new Date(Date.now() - 5 * 3600000) }
        );

        const res = await api(coordinator).post(`/api/events/${eventId}/complete`);
        expect(res.body.data.status).toBe("COMPLETED");
        expect(await AuditLog.countDocuments({ targetId: eventId })).toBeGreaterThanOrEqual(8);
    });
});

describe("requests without a body", () => {
    test("approving with no comment and no JSON body works", async () => {
        const request = require("supertest");
        const { app, makeFaculty, makeStudent, makeActiveClub } = require("../helpers/factory");
        const venues = await seedReferenceData().catch(async () => ({ auditorium: await require("../../models/Venue").findOne({ name: "Auditorium" }) }));
        const [mentor, president] = await Promise.all([makeFaculty(), makeStudent()]);
        const club = await makeActiveClub({ name: "No Body Club", mentor, president });
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { eventDate: futureDate(40), maxParticipants: 20 }));
        await api(president).post(`/api/events/${draft.body.data._id}/submit`);

        const res = await request(app).post(`/api/events/${draft.body.data._id}/approve`).set("Authorization", `Bearer ${mentor.token}`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("APPROVED");
    });
});
