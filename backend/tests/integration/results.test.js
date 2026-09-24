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
const EventResult = require("../../models/EventResult");
const Notification = require("../../models/Notification");
const AuditLog = require("../../models/AuditLog");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("round-wise and final results", () => {
    let venues, club, mentor, president, vicePresident, coordinator, member, outsider, alice, bob, carol, eventId, roundId;

    const publishEvent = async (overrides = {}) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { maxParticipants: 100, ...overrides }));
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    // Moves the event's start into the past while keeping it PUBLISHED (the event is live).
    const startEvent = (id) =>
        Event.updateOne(
            { _id: id },
            {
                registrationStart: new Date(Date.now() - 5 * 3600000),
                registrationEnd: new Date(Date.now() - 4 * 3600000),
                startAt: new Date(Date.now() - 3600000),
                endAt: new Date(Date.now() + 5 * 3600000)
            }
        );

    const rounds = (id) => `/api/events/${id}/results/rounds`;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, vicePresident, coordinator, member, outsider, alice, bob, carol] = await Promise.all([
            makeFaculty({ name: "Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice President" }),
            makeStudent({ name: "Coordinator" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Outsider" }),
            makeStudent({ name: "Alice" }),
            makeStudent({ name: "Bob" }),
            makeStudent({ name: "Carol" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, vicePresident, "VICE_PRESIDENT");
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, member, "MEMBER");

        eventId = await publishEvent({ title: "HackDDU", eventDate: futureDate(10) });
        for (const student of [alice, bob, carol]) {
            await api(student).post(`/api/events/${eventId}/register`);
        }
        outbox.length = 0;
    });

    const screening = () => ({
        name: "Round 1: Idea screening",
        description: "Top teams go through to the build round.",
        entries: [
            { rank: 3, recipientUser: String(carol._id), score: "61", qualified: false },
            { rank: 1, recipientUser: String(alice._id), teamName: "Team Alpha", score: "92", qualified: true },
            { rank: 2, recipientUser: String(bob._id), score: "88", qualified: true, note: "Best pitch" },
            { teamName: "Walk-in Team", score: "40", qualified: false }
        ]
    });

    describe("rounds", () => {
        test("an event coordinator drafts a round before the event starts; it stays private", async () => {
            const res = await api(coordinator).post(rounds(eventId), screening());
            expect(res.status).toBe(201);
            const [round] = res.body.data.rounds;
            roundId = round._id;
            expect(round.status).toBe("DRAFT");
            // Standings come back best rank first, unranked rows last.
            expect(round.entries.map((e) => e.teamName || e.recipientName)).toEqual(["Team Alpha", "Bob", "Carol", "Walk-in Team"]);

            expect((await api(outsider).get(`/api/events/${eventId}/results`)).status).toBe(404);
            expect((await api(mentor).get(`/api/events/${eventId}/results`)).body.data.rounds).toHaveLength(1);
        });

        test("validates standings and permissions", async () => {
            const twice = { name: "Twice", entries: [{ recipientUser: String(alice._id) }, { recipientUser: String(alice._id) }] };
            expect((await api(coordinator).post(rounds(eventId), twice)).body.message).toBe("Row 2: Alice is listed twice");

            const stranger = { name: "Stranger", entries: [{ recipientUser: String(outsider._id) }] };
            expect((await api(coordinator).post(rounds(eventId), stranger)).body.message).toMatch(/not registered for this event/);

            const empty = { name: "Empty row", entries: [{ score: "10" }] };
            expect((await api(coordinator).post(rounds(eventId), empty)).body.message).toBe("Row 1: add a participant, name or team");

            expect((await api(coordinator).post(rounds(eventId), { name: "round 1: idea screening" })).status).toBe(409);
            expect((await api(coordinator).post(rounds(eventId), { name: "" })).status).toBe(400);
            expect((await api(member).post(rounds(eventId), { name: "Sneaky" })).status).toBe(403);
            expect((await api(mentor).post(rounds(eventId), { name: "Mentor round" })).status).toBe(403);
        });

        test("only the president can publish a round", async () => {
            expect((await api(coordinator).post(`${rounds(eventId)}/${roundId}/publish`)).status).toBe(403);
            expect((await api(vicePresident).post(`${rounds(eventId)}/${roundId}/publish`)).status).toBe(403);

            const res = await api(president).post(`${rounds(eventId)}/${roundId}/publish`);
            expect(res.status).toBe(200);
            expect(res.body.data.rounds[0]).toMatchObject({ status: "PUBLISHED" });
            expect((await api(president).post(`${rounds(eventId)}/${roundId}/publish`)).status).toBe(409);
        });

        test("a published round is public mid-event, while final results stay hidden", async () => {
            const res = await api(null).get(`/api/events/${eventId}/results`);
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("DRAFT");
            expect(res.body.data.summary).toBe("");
            expect(res.body.data.rounds[0].entries[0]).toMatchObject({ rank: 1, teamName: "Team Alpha", score: "92", qualified: true });
            expect(res.body.data.viewer).toEqual({ canSeeDrafts: false, canEdit: false, canPublish: false });
        });

        test("participants are notified, and qualifiers get a personal email", async () => {
            const notified = (await Notification.find({ type: "ROUND_RESULTS" }).distinct("user")).map(String);
            expect(notified.sort()).toEqual([alice, bob, carol].map((u) => String(u._id)).sort());
            expect(await Notification.exists({ type: "ROUND_RESULTS", link: `/results/${eventId}` })).toBeTruthy();

            await flushEmails();
            // (Registration confirmations and the launch email are in the outbox too; look at round emails only.)
            const roundMails = (user) => mailsTo(user.email).filter((mail) => /Round 1/.test(mail.subject));
            expect(roundMails(alice).map((m) => m.subject)).toEqual(["You're through! Round 1: Idea screening results for HackDDU"]);
            expect(roundMails(bob).map((m) => m.subject)).toEqual(["You're through! Round 1: Idea screening results for HackDDU"]);
            expect(roundMails(carol).map((m) => m.subject)).toEqual(["Round 1: Idea screening results are out: HackDDU"]);
            expect(roundMails(carol)[0].text).toMatch(/2 entries go through to the next round/);
            expect(roundMails(outsider)).toHaveLength(0);
        });

        test("corrections to a published round are president-only and marked", async () => {
            const fix = { entries: [...screening().entries.slice(0, 3), { teamName: "Walk-in Team", score: "45", qualified: false }] };
            expect((await api(coordinator).put(`${rounds(eventId)}/${roundId}`, fix)).status).toBe(403);

            const res = await api(president).put(`${rounds(eventId)}/${roundId}`, fix);
            expect(res.status).toBe(200);
            expect(res.body.data.rounds[0].correctedAt).toBeTruthy();
            expect(res.body.data.rounds[0].entries[3].score).toBe("45");
            expect(await AuditLog.exists({ action: "RESULT_CORRECTED" })).toBeTruthy();

            expect((await api(president).put(`${rounds(eventId)}/${roundId}`, { entries: [] })).status).toBe(400);
        });

        test("published rounds cannot be deleted; the president can withdraw them", async () => {
            expect((await api(coordinator).delete(`${rounds(eventId)}/${roundId}`)).status).toBe(409);
            expect((await api(coordinator).post(`${rounds(eventId)}/${roundId}/unpublish`)).status).toBe(403);

            const withdrawn = await api(president).post(`${rounds(eventId)}/${roundId}/unpublish`);
            expect(withdrawn.body.data.rounds[0].status).toBe("DRAFT");
            expect((await api(null).get(`/api/events/${eventId}/results`)).status).toBe(404);

            expect((await api(president).post(`${rounds(eventId)}/${roundId}/publish`)).status).toBe(200);
        });

        test("draft rounds can be deleted by results managers", async () => {
            const created = await api(coordinator).post(rounds(eventId), { name: "Practice round" });
            const practice = created.body.data.rounds.find((round) => round.name === "Practice round");
            const res = await api(coordinator).delete(`${rounds(eventId)}/${practice._id}`);
            expect(res.status).toBe(200);
            expect(res.body.data.rounds.map((round) => round.name)).toEqual(["Round 1: Idea screening"]);
        });
    });

    describe("final results", () => {
        const final = () => ({
            summary: "Twelve teams built for 24 hours. Congratulations to our winners!",
            awards: [
                { title: "Winner", position: 1, recipientUser: String(alice._id), teamName: "Team Alpha", prize: "₹10,000" },
                { title: "Runner-up", position: 2, recipientUser: String(bob._id), prize: "₹5,000" }
            ]
        });

        test("cannot be prepared before the event starts", async () => {
            const res = await api(coordinator).put(`/api/events/${eventId}/results`, final());
            expect(res.status).toBe(409);
            expect(res.body.message).toMatch(/once the event has started/);
        });

        test("can be published by the president while the event is still running", async () => {
            await startEvent(eventId);
            expect((await api(coordinator).put(`/api/events/${eventId}/results`, final())).status).toBe(200);

            expect((await api(coordinator).post(`/api/events/${eventId}/results/publish`)).status).toBe(403);
            expect((await api(vicePresident).post(`/api/events/${eventId}/results/publish`)).status).toBe(403);

            const res = await api(president).post(`/api/events/${eventId}/results/publish`);
            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe("PUBLISHED");
            expect((await Event.findById(eventId)).status).toBe("PUBLISHED");

            const publicView = await api(null).get(`/api/events/${eventId}/results`);
            expect(publicView.body.data.awards.map((a) => a.teamName || a.recipientName)).toEqual(["Team Alpha", "Bob"]);
            expect(publicView.body.data.rounds).toHaveLength(1);
        });

        test("corrections after publishing are president-only and marked", async () => {
            const corrected = { ...final(), summary: "Twelve teams built for 24 hours. Corrected prize amounts." };
            expect((await api(coordinator).put(`/api/events/${eventId}/results`, corrected)).status).toBe(403);

            const res = await api(president).put(`/api/events/${eventId}/results`, corrected);
            expect(res.status).toBe(200);
            expect(res.body.data.correctedAt).toBeTruthy();
            expect(res.body.data.status).toBe("PUBLISHED");
        });

        test("the event page tells the viewer what they may do", async () => {
            expect((await api(president).get(`/api/events/${eventId}`)).body.data.viewer).toMatchObject({ canManageResults: true, canPublishResults: true });
            expect((await api(coordinator).get(`/api/events/${eventId}`)).body.data.viewer).toMatchObject({ canManageResults: true, canPublishResults: false });
        });
    });

    describe("results board", () => {
        let liveId;

        beforeAll(async () => {
            liveId = await publishEvent({ title: "Code Relay", eventDate: futureDate(15), startTime: "15:00", endTime: "17:00" });
            await api(alice).post(`/api/events/${liveId}/register`);
            const created = await api(president).post(rounds(liveId), { name: "Heat 1", entries: [{ rank: 1, recipientUser: String(alice._id), qualified: true }] });
            await api(president).post(`${rounds(liveId)}/${created.body.data.rounds[0]._id}/publish`);
            // A third event with only a draft never shows up.
            const hidden = await publishEvent({ title: "Secret Sprint", eventDate: futureDate(18) });
            await api(president).post(rounds(hidden), { name: "Draft only" });
        });

        test("lists one card per event with anything published, with stage counts", async () => {
            const all = await api(null).get("/api/results");
            expect(all.body.data.map((card) => card.event.title).sort()).toEqual(["Code Relay", "HackDDU"]);
            expect(all.body.meta.counts).toEqual({ all: 2, final: 1, live: 1 });

            const hack = all.body.data.find((card) => card.event.title === "HackDDU");
            expect(hack).toMatchObject({ final: true, rounds: { published: 1, latest: { name: "Round 1: Idea screening" } } });
            expect(hack.winners[0].teamName).toBe("Team Alpha");

            const relay = all.body.data.find((card) => card.event.title === "Code Relay");
            expect(relay).toMatchObject({ final: false, winners: [], rounds: { published: 1, latest: { name: "Heat 1" } } });
        });

        test("filters by stage and search", async () => {
            expect((await api(null).get("/api/results?stage=live")).body.data.map((c) => c.event.title)).toEqual(["Code Relay"]);
            expect((await api(null).get("/api/results?stage=final")).body.data.map((c) => c.event.title)).toEqual(["HackDDU"]);
            expect((await api(null).get("/api/results?search=relay")).body.data.map((c) => c.event.title)).toEqual(["Code Relay"]);
        });

        test("feed cards show the result stage", async () => {
            const feed = await api(outsider).get("/api/events?limit=50");
            const relay = feed.body.data.find((event) => event._id === String(liveId));
            expect(relay).toMatchObject({ resultStage: "rounds", result: null, latestRound: { name: "Heat 1" } });
        });

        test("results can't be added to events that aren't published", async () => {
            const draft = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Not yet", eventDate: futureDate(30), maxParticipants: 10 }));
            expect((await api(president).post(rounds(draft.body.data._id), { name: "Too early" })).status).toBe(409);
            expect(await EventResult.exists({ event: draft.body.data._id })).toBeNull();
        });
    });
});
