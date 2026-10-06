const db = require("../helpers/testDb");
const {
    seedReferenceData,
    makeStudent,
    makeFaculty,
    makeActiveClub,
    addMembership,
    eventPayload,
    futureDate,
    api
} = require("../helpers/factory");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const FeedPost = require("../../models/FeedPost");
const Notification = require("../../models/Notification");

beforeAll(db.connect);
afterAll(db.disconnect);

let venues, mentor, otherFaculty, president, coordinator, treasurer, marketing, member, club;

const publishEvent = async (overrides = {}) => {
    const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides));
    if (draft.status !== 201) {
        throw new Error(`draft failed: ${draft.body.message}`);
    }
    const id = draft.body.data._id;
    await api(president).post(`/api/events/${id}/submit`);
    await api(mentor).post(`/api/events/${id}/approve`);
    const published = await api(president).post(`/api/events/${id}/publish`);
    if (published.status !== 200) {
        throw new Error(`publish failed: ${published.body.message}`);
    }
    return id;
};

const moveToPast = (id) =>
    Event.updateOne(
        { _id: id },
        {
            registrationStart: new Date(Date.now() - 5 * 3600000),
            registrationEnd: new Date(Date.now() - 4 * 3600000),
            startAt: new Date(Date.now() - 3 * 3600000),
            endAt: new Date(Date.now() - 3600000)
        }
    );

beforeAll(async () => {
    await db.clear();
    venues = await seedReferenceData();
    [mentor, otherFaculty, president, coordinator, treasurer, marketing, member] = await Promise.all([
        makeFaculty({ name: "Mentor" }),
        makeFaculty({ name: "Other Faculty" }),
        makeStudent({ name: "President" }),
        makeStudent({ name: "Event Coordinator" }),
        makeStudent({ name: "Treasurer" }),
        makeStudent({ name: "Marketing" }),
        makeStudent({ name: "Member" })
    ]);
    club = await makeActiveClub({ name: "AI Club", mentor, president });
    await addMembership(club, coordinator, "EVENT_COORDINATOR");
    await addMembership(club, treasurer, "TREASURER");
    await addMembership(club, marketing, "MARKETING_COORDINATOR");
    await addMembership(club, member, "MEMBER");
});

describe("event registration", () => {
    let eventId;
    let first;

    beforeAll(async () => {
        eventId = await publishEvent({ maxParticipants: 2, eligibility: { departments: ["CE"], batches: ["24"] } });
        first = await makeStudent({ name: "First" });
    });

    test("a student registers and receives a confirmation notification", async () => {
        const res = await api(first).post(`/api/events/${eventId}/register`);
        expect(res.status).toBe(201);
        expect(res.body.data.registeredCount).toBe(1);
        expect(await Notification.exists({ user: first._id, type: "REGISTRATION_CONFIRMED" })).toBeTruthy();

        const detail = await api(first).get(`/api/events/${eventId}`);
        expect(detail.body.data.viewer.registration.status).toBe("REGISTERED");
    });

    test("duplicate registration is rejected", async () => {
        const res = await api(first).post(`/api/events/${eventId}/register`);
        expect(res.status).toBe(409);
        expect(res.body.errorCode).toBe("DUPLICATE_REGISTRATION");
    });

    test("eligibility is enforced by department and batch", async () => {
        const itStudent = await makeStudent({ department: "IT" });
        const oldBatch = await makeStudent({ batch: "23" });
        expect((await api(itStudent).post(`/api/events/${eventId}/register`)).body.errorCode).toBe("NOT_ELIGIBLE");
        expect((await api(oldBatch).post(`/api/events/${eventId}/register`)).body.errorCode).toBe("NOT_ELIGIBLE");
    });

    test("faculty cannot register", async () => {
        expect((await api(otherFaculty).post(`/api/events/${eventId}/register`)).status).toBe(403);
    });

    test("capacity holds under concurrent registrations; the rest join the waitlist in order", async () => {
        const students = await Promise.all([1, 2, 3, 4, 5].map(() => makeStudent()));
        const results = await Promise.all(students.map((s) => api(s).post(`/api/events/${eventId}/register`)));

        expect(results.every((r) => r.status === 201)).toBe(true);
        expect(results.filter((r) => !r.body.data.waitlisted)).toHaveLength(1);
        const queued = results.filter((r) => r.body.data.waitlisted);
        expect(queued).toHaveLength(4);
        expect(queued.map((r) => r.body.data.waitlistPosition).sort()).toEqual([1, 2, 3, 4]);
        expect((await Event.findById(eventId)).waitlistCount).toBe(4);

        const event = await Event.findById(eventId);
        expect(event.registeredCount).toBe(2);
        expect(await EventRegistration.countDocuments({ event: eventId, status: "REGISTERED" })).toBe(2);
    });

    test("cancelling hands the seat to the waitlist; re-registering joins the back of the queue", async () => {
        expect((await api(first).delete(`/api/events/${eventId}/register`)).status).toBe(200);
        const afterCancel = await Event.findById(eventId);
        expect(afterCancel.registeredCount).toBe(2);
        expect(afterCancel.waitlistCount).toBe(3);

        const again = await api(first).post(`/api/events/${eventId}/register`);
        expect(again.status).toBe(201);
        expect(again.body.data).toMatchObject({ waitlisted: true, waitlistPosition: 4 });
    });

    test("registration fails after the deadline and when manually closed", async () => {
        const late = await publishEvent({ title: "Late Event", eventDate: futureDate(15), maxParticipants: 20 });
        await Event.updateOne({ _id: late }, { registrationEnd: new Date(Date.now() - 1000), registrationStart: new Date(Date.now() - 86400000) });
        const student = await makeStudent();
        expect((await api(student).post(`/api/events/${late}/register`)).body.errorCode).toBe("REGISTRATION_CLOSED");

        const closed = await publishEvent({ title: "Closed Event", eventDate: futureDate(16), maxParticipants: 20 });
        await api(president).put(`/api/events/${closed}`, { registrationClosed: true });
        expect((await api(student).post(`/api/events/${closed}/register`)).body.errorCode).toBe("REGISTRATION_CLOSED");
    });

    test("unpublished events do not accept registrations", async () => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Draft Only", eventDate: futureDate(17), maxParticipants: 20 }));
        const student = await makeStudent();
        expect((await api(student).post(`/api/events/${draft.body.data._id}/register`)).status).toBe(400);
    });

    test("my registrations lists upcoming events (including ones the student is waitlisted for)", async () => {
        const res = await api(first).get("/api/registrations/me?timeframe=upcoming&includeWaitlist=true");
        expect(res.body.data.map((r) => String(r.event._id))).toContain(String(eventId));
    });
});

describe("participant access is permission-based", () => {
    let eventId, participant, outsider;

    beforeAll(async () => {
        eventId = await publishEvent({ title: "Participants Event", eventDate: futureDate(20), maxParticipants: 20 });
        participant = await makeStudent({ name: "Participant" });
        outsider = await makeStudent({ name: "Outsider" });
        await api(participant).post(`/api/events/${eventId}/register`);
    });

    test.each([
        ["president", () => president, 200],
        ["event coordinator", () => coordinator, 200],
        ["treasurer (view only)", () => treasurer, 200],
        ["faculty mentor", () => mentor, 200],
        ["marketing coordinator", () => marketing, 403],
        ["plain member", () => member, 403],
        ["other faculty", () => otherFaculty, 403],
        ["unrelated student", () => outsider, 403]
    ])("%s → %i", async (_label, who, status) => {
        expect((await api(who()).get(`/api/events/${eventId}/registrations`)).status).toBe(status);
    });

    test("only MANAGE_PARTICIPANTS roles can remove a participant", async () => {
        const list = await api(president).get(`/api/events/${eventId}/registrations`);
        const registrationId = list.body.data[0]._id;

        expect((await api(treasurer).delete(`/api/events/${eventId}/registrations/${registrationId}`)).status).toBe(403);
        expect((await api(mentor).delete(`/api/events/${eventId}/registrations/${registrationId}`)).status).toBe(403);

        const res = await api(coordinator).delete(`/api/events/${eventId}/registrations/${registrationId}`, { reason: "Duplicate team" });
        expect(res.status).toBe(200);
        expect(await Notification.exists({ user: participant._id, type: "REGISTRATION_REMOVED" })).toBeTruthy();
    });
});

describe("results", () => {
    let eventId, winner, runnerUp, notParticipant;

    beforeAll(async () => {
        eventId = await publishEvent({ title: "Code Sprint", eventDate: futureDate(25), maxParticipants: 20 });
        [winner, runnerUp, notParticipant] = await Promise.all([makeStudent({ name: "Winner" }), makeStudent({ name: "Runner Up" }), makeStudent()]);
        await api(winner).post(`/api/events/${eventId}/register`);
        await api(runnerUp).post(`/api/events/${eventId}/register`);
    });

    const resultBody = (awards) => ({ summary: "A great sprint with 12 teams competing.", awards });

    test("final results cannot be added before the event starts", async () => {
        const res = await api(president).put(`/api/events/${eventId}/results`, resultBody([{ title: "Winner", recipientName: "Team A" }]));
        expect(res.status).toBe(409);
    });

    test("recipients must have been registered participants", async () => {
        await moveToPast(eventId);
        await api(president).post(`/api/events/${eventId}/complete`);

        const res = await api(president).put(
            `/api/events/${eventId}/results`,
            resultBody([{ title: "Winner", position: 1, recipientUser: String(notParticipant._id) }])
        );
        expect(res.status).toBe(400);
    });

    test("unauthorised members cannot manage results", async () => {
        const body = resultBody([{ title: "Winner", position: 1, recipientUser: String(winner._id) }]);
        expect((await api(member).put(`/api/events/${eventId}/results`, body)).status).toBe(403);
        expect((await api(marketing).put(`/api/events/${eventId}/results`, body)).status).toBe(403);
    });

    test("the event coordinator saves a draft that is not publicly visible", async () => {
        const res = await api(coordinator).put(
            `/api/events/${eventId}/results`,
            resultBody([
                { title: "Winner", position: 1, recipientUser: String(winner._id), prize: "₹5,000" },
                { title: "Runner-up", position: 2, recipientUser: String(runnerUp._id), recognition: "Best UI" }
            ])
        );
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("DRAFT");
        expect(res.body.data.awards[0].recipientName).toBe("Winner");

        expect((await api(null).get(`/api/events/${eventId}/results`)).status).toBe(404);
        expect((await api(mentor).get(`/api/events/${eventId}/results`)).status).toBe(200);
    });

    test("publishing makes results public, shows them on the completed event and notifies the people involved", async () => {
        const res = await api(president).post(`/api/events/${eventId}/results/publish`);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("PUBLISHED");

        const publicView = await api(null).get(`/api/events/${eventId}/results`);
        expect(publicView.status).toBe(200);
        expect(publicView.body.data.awards).toHaveLength(2);

        // Results are not a feed post any more; they travel with the completed event.
        expect(await FeedPost.exists({ event: eventId, type: "RESULT" })).toBeNull();
        const past = await api(notParticipant).get("/api/events?timeframe=past");
        const card = past.body.data.find((e) => e._id === String(eventId));
        expect(card.result.awards.map((a) => a.recipientName)).toEqual(["Winner", "Runner Up"]);

        // Participants, the club's members and its mentor are notified; students with no link to the event or
        // the club aren't (the results are still public for them to see).
        const notified = await Notification.find({ type: "RESULT_PUBLISHED", link: `/results/${eventId}` }).distinct("user");
        expect(notified.map(String)).toEqual(expect.arrayContaining([String(winner._id), String(member._id), String(mentor._id)]));
        expect(notified.map(String)).not.toContain(String(notParticipant._id));
        expect(notified.map(String)).not.toContain(String(president._id));

        const list = await api(null).get("/api/results");
        expect(list.body.data[0].event.title).toBe("Code Sprint");
    });
});

describe("club announcements", () => {
    let outsider;

    beforeAll(async () => {
        outsider = await makeStudent({ name: "Feed Reader" });
    });

    test("marketing coordinators post announcements; plain members cannot", async () => {
        const body = { club: String(club._id), type: "ANNOUNCEMENT", title: "Recruitment drive", body: "We're hiring designers!" };
        expect((await api(member).post("/api/feed", body)).status).toBe(403);
        expect((await api(outsider).post("/api/feed", body)).status).toBe(403);
        expect((await api(marketing).post("/api/feed", body)).status).toBe(201);
    });

    test("public announcements notify everyone; they are not part of the event feed", async () => {
        const notified = await Notification.find({ type: "ANNOUNCEMENT", title: /Recruitment drive/ }).distinct("user");
        expect(notified.map(String)).toEqual(expect.arrayContaining([String(outsider._id), String(member._id), String(mentor._id)]));
        expect(notified.map(String)).not.toContain(String(marketing._id));

        const events = await api(outsider).get("/api/events?timeframe=upcoming&limit=50");
        expect(events.body.data.every((item) => item.title && item.startAt)).toBe(true);
    });

    test("members-only announcements notify members and the mentor only, and stay hidden from others", async () => {
        await api(president).post("/api/feed", {
            club: String(club._id),
            type: "CLUB_UPDATE",
            title: "Members meeting on Friday",
            visibility: "MEMBERS"
        });

        const memberFeed = await api(member).get(`/api/feed?club=${club._id}&limit=50`);
        const outsiderFeed = await api(outsider).get(`/api/feed?club=${club._id}&limit=50`);

        expect(memberFeed.body.data.map((p) => p.title)).toContain("Members meeting on Friday");
        expect(outsiderFeed.body.data.map((p) => p.title)).not.toContain("Members meeting on Friday");

        const notified = (await Notification.find({ type: "ANNOUNCEMENT", title: /Members meeting/ }).distinct("user")).map(String);
        expect(notified).toEqual(expect.arrayContaining([String(member._id), String(mentor._id)]));
        expect(notified).not.toContain(String(outsider._id));
    });

    test("a club's announcements can be listed by club and type; no event or result posts are created", async () => {
        const res = await api(outsider).get(`/api/feed?club=${club._id}&types=ANNOUNCEMENT,CLUB_UPDATE`);
        expect(res.body.data.map((p) => p.title)).toContain("Recruitment drive");
        expect(res.body.data.every((p) => ["ANNOUNCEMENT", "CLUB_UPDATE"].includes(p.type))).toBe(true);
        expect(await FeedPost.exists({ type: { $in: ["EVENT", "RESULT"] } })).toBeNull();
    });

    test("announcements can be deleted by their author or club managers only", async () => {
        const post = await FeedPost.findOne({ title: "Recruitment drive" });
        expect((await api(member).delete(`/api/feed/${post._id}`)).status).toBe(403);
        expect((await api(president).delete(`/api/feed/${post._id}`)).status).toBe(200);
    });

    test("the feed requires authentication", async () => {
        expect((await api(null).get("/api/feed")).status).toBe(401);
    });
});

describe("notifications", () => {
    test("users read only their own notifications and can mark them read", async () => {
        const list = await api(member).get("/api/notifications");
        expect(list.body.meta.unread).toBeGreaterThan(0);

        const id = list.body.data[0]._id;
        expect((await api(coordinator).patch(`/api/notifications/${id}/read`)).status).toBe(404);
        expect((await api(member).patch(`/api/notifications/${id}/read`)).status).toBe(200);

        await api(member).post("/api/notifications/read-all");
        const count = await api(member).get("/api/notifications/unread-count");
        expect(count.body.data.count).toBe(0);
    });
});

describe("dashboards", () => {
    test("each role receives its own dashboard section", async () => {
        const student = await api(president).get("/api/dashboard");
        expect(student.body.data.student.clubWorkspaces[0].club.name).toBe("AI Club");

        const faculty = await api(mentor).get("/api/dashboard");
        expect(faculty.body.data.faculty.mentoredClubs[0].name).toBe("AI Club");
    });

    test("the student dashboard shows each event once: schedule, club workspace or recommendations", async () => {
        const inDays = (days) => ({ eventDate: futureDate(days), registrationEnd: new Date(Date.now() + (days - 2) * 86400000).toISOString() });
        const attending = await publishEvent({ title: "Dashboard Attending", ...inDays(30) });
        const open = await publishEvent({ title: "Dashboard Open", ...inDays(31) });
        await publishEvent({ title: "Dashboard ME only", eligibility: { departments: ["ME"], batches: [] }, ...inDays(32) });

        const fan = await makeStudent({ name: "Fan" });
        await api(fan).post(`/api/events/${attending}/register`);

        const titles = (list) => list.map((item) => (item.event || item).title);
        const { student } = (await api(fan).get("/api/dashboard")).body.data;
        expect(titles(student.upcomingRegistrations)).toContain("Dashboard Attending");
        expect(titles(student.recommended)).toContain("Dashboard Open");
        expect(titles(student.recommended)).not.toContain("Dashboard Attending");
        expect(titles(student.recommended)).not.toContain("Dashboard ME only");
        expect(student.stats.upcoming).toBe(1);

        const everything = [...titles(student.upcomingRegistrations), ...titles(student.recommended)];
        expect(new Set(everything).size).toBe(everything.length);

        // A plain member sees their club's events recommended first; the president manages them in the workspace instead.
        const memberView = (await api(member).get("/api/dashboard")).body.data.student;
        expect(memberView.recommended.find((event) => String(event._id) === String(open)).fromMyClub).toBe(true);
        const presidentView = (await api(president).get("/api/dashboard")).body.data.student;
        expect(titles(presidentView.recommended)).not.toContain("Dashboard Open");
        expect(titles(presidentView.clubWorkspaces[0].upcoming)).toContain("Dashboard Open");
        expect(presidentView.campusEvents).toBeUndefined();
    });
});
