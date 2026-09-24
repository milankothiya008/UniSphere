const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const FeedPost = require("../../models/FeedPost");
const Notification = require("../../models/Notification");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("editing events", () => {
    let venues, club, mentor, otherFaculty, president, coordinator, member, student;

    const createDraft = async (overrides = {}) => (await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides))).body.data._id;

    const approvedEvent = async (overrides = {}) => {
        const id = await createDraft(overrides);
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        return id;
    };

    const publishedEvent = async (overrides = {}) => {
        const id = await approvedEvent(overrides);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, otherFaculty, president, coordinator, member, student] = await Promise.all([
            makeFaculty({ name: "Dr. Mentor" }),
            makeFaculty({ name: "Dr. Other" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Coordinator" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Registered Student" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, member, "MEMBER");
    });

    test("drafts can change every detail, including venue and schedule", async () => {
        const id = await createDraft();
        const res = await api(president).put(`/api/events/${id}`, {
            title: "Hack Night 2.0",
            venue: String(venues.hall._id),
            eventDate: futureDate(12),
            startTime: "14:00",
            endTime: "18:00",
            category: "COMPETITION",
            maxParticipants: 40,
            eligibility: { departments: ["CE"], batches: ["24"] }
        });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Event updated");
        expect(res.body.data).toMatchObject({ title: "Hack Night 2.0", status: "DRAFT", startTime: "14:00", category: "COMPETITION", maxParticipants: 40 });
        expect(String(res.body.data.venue._id)).toBe(String(venues.hall._id));
    });

    test("editing an approved (not yet public) event sends it back to the mentor", async () => {
        const id = await approvedEvent({ title: "Approved Talk", eventDate: futureDate(14) });
        const res = await api(president).put(`/api/events/${id}`, { title: "Approved Talk (moved)", startTime: "11:00", endTime: "12:30" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Changes saved and sent to your faculty mentor for approval");
        expect(res.body.data).toMatchObject({ status: "PENDING_APPROVAL", title: "Approved Talk (moved)", startTime: "11:00" });
        expect(await Notification.exists({ user: mentor._id, type: "EVENT_CHANGES_REVIEW", title: '"Approved Talk (moved)" was changed after approval' })).toBeTruthy();

        // While it waits for review it cannot be edited again.
        const locked = await api(president).put(`/api/events/${id}`, { title: "Another title" });
        expect(locked.status).toBe(409);
        expect(locked.body.message).toMatch(/with your faculty mentor for review/);
    });

    describe("published events", () => {
        let id;

        beforeAll(async () => {
            id = await publishedEvent({ title: "Hack Night", eventDate: futureDate(20), maxParticipants: 50 });
            await api(student).post(`/api/events/${id}/register`);
        });

        test("changes wait for the mentor while the live event stays as it is", async () => {
            const res = await api(president).put(`/api/events/${id}`, {
                title: "Hack Night: Winter Edition",
                venue: String(venues.hall._id),
                eventDate: futureDate(21),
                startTime: "16:00",
                endTime: "20:00",
                registrationEnd: new Date(Date.now() + 19 * 86400000).toISOString(),
                updateNote: "We moved to a smaller hall with better Wi-Fi."
            });
            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/sent to your faculty mentor for approval/);
            expect(res.body.data).toMatchObject({ title: "Hack Night", status: "PUBLISHED", startTime: "10:00" });
            expect(res.body.data.revision).toMatchObject({ status: "PENDING_APPROVAL", note: "We moved to a smaller hall with better Wi-Fi." });
            expect(res.body.data.revision.fields.sort()).toEqual(["endTime", "eventDate", "registrationEnd", "startTime", "title", "venue"]);
            const venueDiff = res.body.data.revision.diff.find((change) => change.field === "venue");
            expect([venueDiff.from.name, venueDiff.to.name]).toEqual(["Auditorium", "Seminar Hall A"]);

            // Students see only the live event, never the pending changes.
            const publicView = await api(student).get(`/api/events/${id}`);
            expect(publicView.body.data.title).toBe("Hack Night");
            expect(publicView.body.data.revision).toBeUndefined();
            const feed = await api(student).get("/api/events?timeframe=upcoming");
            expect(feed.body.data.find((event) => event._id === id).revision).toBeUndefined();

            expect(await Notification.exists({ user: mentor._id, type: "EVENT_CHANGES_REVIEW", title: 'Changes to "Hack Night" need your approval' })).toBeTruthy();
        });

        test("the mentor finds the edit in their review queue", async () => {
            const queue = await api(mentor).get("/api/events/manage?status=PENDING_APPROVAL");
            const row = queue.body.data.find((event) => event._id === id);
            expect(row).toMatchObject({ status: "PUBLISHED", revisionStatus: "PENDING_APPROVAL" });

            const dashboard = await api(mentor).get("/api/dashboard");
            expect(dashboard.body.data.faculty.eventsToReview.map((event) => event.title)).toContain("Hack Night");

            const detail = await api(mentor).get(`/api/events/${id}`);
            expect(detail.body.data.viewer).toMatchObject({ canReviewChanges: true, canReview: false });
        });

        test("only the club's mentor reviews changes, and nothing can be published before approval", async () => {
            expect((await api(otherFaculty).post(`/api/events/${id}/changes/approve`)).status).toBe(403);
            expect((await api(president).post(`/api/events/${id}/changes/approve`)).status).toBe(403);
            const early = await api(president).post(`/api/events/${id}/changes/publish`);
            expect(early.status).toBe(409);
            expect(early.body.message).toBe("Only changes approved by the faculty mentor can be published");
        });

        test("the mentor can send an edit back; editing again resubmits it", async () => {
            const sentBack = await api(mentor).post(`/api/events/${id}/changes/request-changes`, { comment: "Keep the original date, just change the venue." });
            expect(sentBack.body.data.revision).toMatchObject({ status: "NEEDS_CHANGES", reviewComment: "Keep the original date, just change the venue." });
            expect(await Notification.exists({ user: president._id, type: "EVENT_CHANGES_REQUESTED" })).toBeTruthy();

            const again = await api(president).put(`/api/events/${id}`, {
                title: "Hack Night: Winter Edition",
                venue: String(venues.hall._id),
                eventDate: futureDate(20),
                startTime: "10:00",
                endTime: "13:00",
                updateNote: "We moved to a smaller hall with better Wi-Fi."
            });
            expect(again.body.data.revision.status).toBe("PENDING_APPROVAL");
            expect(again.body.data.revision.fields.sort()).toEqual(["title", "venue"]);
        });

        test("once approved, the club publishes the changes and registered students are told", async () => {
            const approved = await api(mentor).post(`/api/events/${id}/changes/approve`, { comment: "Looks good" });
            expect(approved.body.data.revision.status).toBe("APPROVED");
            expect(approved.body.data.title).toBe("Hack Night");
            expect(await Notification.exists({ user: president._id, type: "EVENT_APPROVED", title: 'Changes to "Hack Night" were approved' })).toBeTruthy();

            const presidentView = await api(president).get(`/api/events/${id}`);
            expect(presidentView.body.data.viewer.canPublishChanges).toBe(true);
            expect((await api(coordinator).post(`/api/events/${id}/changes/publish`)).status).toBe(403);

            const published = await api(president).post(`/api/events/${id}/changes/publish`);
            expect(published.status).toBe(200);
            expect(published.body.data).toMatchObject({ title: "Hack Night: Winter Edition", status: "PUBLISHED" });
            expect(String(published.body.data.venue._id)).toBe(String(venues.hall._id));
            expect(published.body.data.revision).toBeUndefined();
            expect((await Event.findById(id)).revision).toBeNull();

            const notice = await Notification.findOne({ user: student._id, type: "EVENT_UPDATED" });
            expect(notice.title).toBe("Hack Night: Winter Edition has been updated");
            expect(notice.message).toBe("Updated: title and venue. We moved to a smaller hall with better Wi-Fi.");
            expect(await FeedPost.exists({ event: id, type: "EVENT_UPDATE", title: "Event details updated" })).toBeTruthy();
        });

        test("a rejected edit leaves the event unchanged, and the club can discard it", async () => {
            await api(president).put(`/api/events/${id}`, { shortDescription: "A totally different description of the evening." });
            const rejected = await api(mentor).post(`/api/events/${id}/changes/reject`, { reason: "The current description is clearer." });
            expect(rejected.body.data.revision).toMatchObject({ status: "REJECTED", reviewComment: "The current description is clearer." });
            expect(rejected.body.data.shortDescription).toBe("An evening of building things together.");

            const discarded = await api(president).delete(`/api/events/${id}/changes`);
            expect(discarded.status).toBe(200);
            expect(discarded.body.data.revision).toBeUndefined();
        });

        test("reverting every change clears the pending edit", async () => {
            await api(president).put(`/api/events/${id}`, { rules: "New rules" });
            expect((await Event.findById(id)).revision.status).toBe("PENDING_APPROVAL");
            await api(president).put(`/api/events/${id}`, { rules: "Bring your own laptop." });
            expect((await Event.findById(id)).revision).toBeNull();
        });

        test("proposed changes are validated like a new event", async () => {
            const clash = await publishedEvent({ title: "Other Event", venue: String(venues.auditorium._id), eventDate: futureDate(30) });
            expect(clash).toBeTruthy();
            const conflict = await api(president).put(`/api/events/${id}`, {
                venue: String(venues.auditorium._id),
                eventDate: futureDate(30),
                startTime: "10:00",
                endTime: "13:00",
                registrationEnd: new Date(Date.now() + 25 * 86400000).toISOString()
            });
            expect(conflict.status).toBe(409);
            expect(conflict.body.errorCode).toBe("VENUE_CONFLICT");

            const tooSmall = await api(president).put(`/api/events/${id}`, { maxParticipants: 0 });
            expect(tooSmall.status).toBe(400);

            const past = await api(president).put(`/api/events/${id}`, { eventDate: "2020-01-01" });
            expect(past.status).toBe(400);

            const toTeams = await api(president).put(`/api/events/${id}`, { participationMode: "TEAM", minTeamSize: 2, maxTeamSize: 4 });
            expect(toTeams.status).toBe(409);
            expect(toTeams.body.message).toBe("Team settings can't change once students have registered");
        });

        test("nothing can be edited once the event has started", async () => {
            await Event.updateOne(
                { _id: id },
                { startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 3600000), registrationEnd: new Date(Date.now() - 7200000), registrationStart: new Date(Date.now() - 86400000) }
            );
            const res = await api(president).put(`/api/events/${id}`, { rules: "Late change" });
            expect(res.status).toBe(409);
            expect(res.body.message).toBe("This event has already started, so its details can no longer be changed");
            expect((await api(president).get(`/api/events/${id}`)).body.data.viewer.canEdit).toBe(false);
        });
    });
});

describe("saving an unchanged form", () => {
    test("times that differ only in seconds, and reordered lists, are not reported as changes", async () => {
        await db.clear();
        const venues = await seedReferenceData();
        const [mentor, president] = await Promise.all([makeFaculty(), makeStudent({ name: "President" })]);
        const club = await makeActiveClub({ name: "Coding Club", mentor, president });
        const draft = await api(president).post(
            "/api/events",
            eventPayload(club, venues.auditorium, { eligibility: { departments: ["IT", "CE"], batches: [] }, registrationEnd: new Date(Date.now() + 8 * 86400000 + 17123).toISOString() })
        );
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);

        const stored = await Event.findById(id);
        const minute = new Date(Math.floor(stored.registrationEnd.getTime() / 60000) * 60000).toISOString();
        const res = await api(president).put(`/api/events/${id}`, { registrationEnd: minute, eligibility: { departments: ["CE", "IT"], batches: [] }, title: stored.title });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Event updated");
        expect((await Event.findById(id)).revision).toBeNull();

        // Moving the start time re-checks the schedule; the untouched registration times still don't count as changes.
        const openedMinute = new Date(Math.floor(stored.registrationStart.getTime() / 60000) * 60000).toISOString();
        const moved = await api(president).put(`/api/events/${id}`, { startTime: "11:00", registrationStart: openedMinute, registrationEnd: minute });
        expect(moved.body.data.revision.fields).toEqual(["startTime"]);
    });
});
