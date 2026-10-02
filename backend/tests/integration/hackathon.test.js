const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const Hackathon = require("../../models/Hackathon");
const Notification = require("../../models/Notification");
const Team = require("../../models/Team");
const EventResult = require("../../models/EventResult");

beforeAll(db.connect);
afterAll(db.disconnect);

const HOUR = 3600000;
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60000);

describe("hackathon mode", () => {
    let venues, mentor, facultyJudge, studentJudge, president, alpha, alpha2, beta, outsider, club, eventId, problems;
    const url = (path = "") => `/api/events/${eventId}/hackathon${path}`;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, facultyJudge, studentJudge, president, alpha, alpha2, beta, outsider] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeFaculty({ name: "Dr Judge" }),
            makeStudent({ name: "Student Judge" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Alpha Lead" }),
            makeStudent({ name: "Alpha Two" }),
            makeStudent({ name: "Beta Lead" }),
            makeStudent({ name: "Outsider" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
    });

    test("a hackathon can run overnight: it ends the next morning", async () => {
        const created = await api(president).post(
            "/api/events",
            eventPayload(club, venues.auditorium, {
                title: "HackNight",
                category: "HACKATHON",
                eventDate: futureDate(10),
                endDate: futureDate(11),
                startTime: "18:00",
                endTime: "06:00",
                participationMode: "TEAM",
                minTeamSize: 1,
                maxTeamSize: 3
            })
        );
        expect(created.status).toBe(201);
        eventId = created.body.data._id;
        expect(new Date(created.body.data.endAt) - new Date(created.body.data.startAt)).toBe(12 * HOUR);
        expect(created.body.data.endDate.slice(0, 10)).toBe(futureDate(11));
        await Event.updateOne({ _id: eventId }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
    });

    test("teams register without a problem statement; problems stay hidden until the event starts", async () => {
        expect((await api(alpha).post(`/api/events/${eventId}/register`, { teamName: "Alpha", invitees: [String(alpha2._id)] })).status).toBe(201);
        const team = await Team.findOne({ event: eventId, name: "Alpha" });
        expect((await api(alpha2).post(`/api/events/${eventId}/teams/${team._id}/accept`)).status).toBe(200);
        expect((await api(beta).post(`/api/events/${eventId}/register`, { teamName: "Beta" })).status).toBe(201);

        expect((await api(president).post(url("/problems"), { title: "Smart campus parking", description: "Help students find a free parking spot near their classroom.", track: "Campus" })).status).toBe(200);
        const added = await api(president).post(url("/problems"), { title: "Canteen queue", description: "Cut the lunch-hour queue at the canteen with pre-ordering.", maxTeams: 1 });
        problems = added.body.data.problemStatements;
        expect(problems).toHaveLength(2);
        expect((await api(alpha).post(url("/problems"), { title: "Mine", description: "Students can't add problems." })).status).toBe(403);

        const view = (await api(alpha).get(url())).body.data;
        expect(view).toMatchObject({ phase: "UPCOMING", problemCount: 2, problemStatements: [], viewer: { isParticipant: true, canChooseProblem: false } });
        expect((await api(outsider).get(url())).body.data.problemStatements).toEqual([]);
        expect((await api(mentor).get(url())).body.data.problemStatements).toHaveLength(2);
        expect((await api(alpha).put(url("/entry/problem"), { problemId: problems[0]._id })).status).toBe(409);
    });

    test("judges are faculty or students who aren't taking part, and are told about it", async () => {
        expect((await api(president).post(url("/judges"), { userId: String(facultyJudge._id) })).status).toBe(200);
        const blocked = await api(president).post(url("/judges"), { userId: String(alpha._id) });
        expect(blocked.status).toBe(409);
        expect(blocked.body.message).toMatch(/taking part/);
        const added = await api(president).post(url("/judges"), { userId: String(studentJudge._id) });
        expect(added.body.data.judges.map((judge) => judge.name).sort()).toEqual(["Dr Judge", "Student Judge"]);
        expect(await Notification.exists({ user: facultyJudge._id, type: "JUDGE_INVITE" })).toBeTruthy();
    });

    test("once the problems are out, each team picks one before the selection deadline", async () => {
        await Event.updateOne({ _id: eventId }, { $set: { startAt: minutesFromNow(-60), endAt: minutesFromNow(11 * 60), registrationEnd: minutesFromNow(-120), registrationStart: minutesFromNow(-24 * 60) } });
        const settings = await api(president).put(url(), { revealAt: minutesFromNow(-60).toISOString(), selectionDeadline: minutesFromNow(30).toISOString(), submissionDeadline: minutesFromNow(120).toISOString() });
        expect(settings.status).toBe(200);
        expect(settings.body.data.phase).toBe("SELECTION");
        expect((await api(president).put(url(), { selectionDeadline: minutesFromNow(200).toISOString() })).status).toBe(400);

        const view = (await api(alpha2).get(url())).body.data;
        expect(view.problemStatements.map((problem) => problem.title)).toEqual(["Smart campus parking", "Canteen queue"]);

        const chose = await api(alpha2).put(url("/entry/problem"), { problemId: problems[1]._id });
        expect(chose.status).toBe(200);
        expect(chose.body.data.myEntry.problemStatement.title).toBe("Canteen queue");
        // The teammate sees the same entry and was told.
        expect((await api(alpha).get(url())).body.data.myEntry.problemStatement.title).toBe("Canteen queue");
        expect(await Notification.exists({ user: alpha._id, type: "HACKATHON_UPDATE", title: /chose "Canteen queue"/ })).toBeTruthy();

        // "Canteen queue" takes one team only.
        expect((await api(beta).put(url("/entry/problem"), { problemId: problems[1]._id })).status).toBe(409);
        expect((await api(outsider).put(url("/entry/problem"), { problemId: problems[0]._id })).status).toBe(403);
    });

    test("teams submit their project (with a problem chosen) until the submission deadline", async () => {
        const early = await api(beta).put(url("/entry/project"), { title: "ParkIt", summary: "Live map of free parking spots using cameras." });
        expect(early.status).toBe(409);
        expect(early.body.message).toMatch(/Choose your problem/);
        await api(beta).put(url("/entry/problem"), { problemId: problems[0]._id });

        expect((await api(beta).put(url("/entry/project"), { title: "ParkIt", summary: "Live map of free parking spots using cameras.", repoUrl: "ftp://nope" })).status).toBe(400);
        expect((await api(beta).put(url("/entry/project"), { title: "ParkIt", summary: "Live map of free parking spots using cameras." })).status).toBe(400);
        const submitted = await api(beta).put(url("/entry/project"), { title: "ParkIt", summary: "Live map of free parking spots using cameras.", repoUrl: "https://github.com/beta/parkit" });
        expect(submitted.status).toBe(200);
        expect(submitted.body.data.myEntry).toMatchObject({ project: { title: "ParkIt", repoUrl: "https://github.com/beta/parkit" } });

        expect((await api(alpha).put(url("/entry/project"), { title: "QuickBite", summary: "Pre-order canteen food and pick it up without queuing.", demoUrl: "https://quickbite.example.com" })).status).toBe(200);
    });

    test("judging opens at the submission deadline; late submissions are refused", async () => {
        const closed = (await api(facultyJudge).get(url("/judging"))).body.data;
        expect(closed).toMatchObject({ open: false, entries: [] });
        await Hackathon.updateOne({ event: eventId }, { $set: { selectionDeadline: minutesFromNow(-30), submissionDeadline: minutesFromNow(-1) } });
        expect((await api(alpha).put(url("/entry/project"), { title: "Late", summary: "Trying to change after the deadline.", repoUrl: "https://github.com/a/b" })).status).toBe(409);

        const panel = (await api(facultyJudge).get(url("/judging"))).body.data;
        expect(panel.open).toBe(true);
        expect(panel.entries.map((entry) => entry.name)).toEqual(["Beta", "Alpha"]);
        expect((await api(outsider).get(url("/judging"))).status).toBe(403);
    });

    test("judges score each project on the criteria; the leaderboard averages them", async () => {
        const { criteria, entries } = (await api(facultyJudge).get(url("/judging"))).body.data;
        const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry._id]));
        const marks = (scores) => criteria.map((criterion, index) => ({ criterion: criterion._id, score: scores[index] }));

        expect((await api(facultyJudge).put(url(`/judging/${byName.Alpha}`), { marks: marks([11, 7, 9, 6]) })).status).toBe(400);
        expect((await api(facultyJudge).put(url(`/judging/${byName.Alpha}`), { marks: marks([8, 7, 9, 6]), comment: "Great demo" })).status).toBe(200);
        await api(facultyJudge).put(url(`/judging/${byName.Beta}`), { marks: marks([5, 5, 5, 5]) });
        await api(studentJudge).put(url(`/judging/${byName.Alpha}`), { marks: marks([9, 8, 8, 7]) });
        const mine = await api(studentJudge).put(url(`/judging/${byName.Beta}`), { marks: marks([6, 6, 6, 6]) });
        expect(mine.body.data.scored).toBe(2);
        expect((await api(alpha).put(url(`/judging/${byName.Beta}`), { marks: marks([0, 0, 0, 0]) })).status).toBe(403);

        const board = (await api(president).get(url("/leaderboard"))).body.data;
        expect(board.rows.map((row) => [row.name, row.rank, row.average, row.judges])).toEqual([
            ["Alpha", 1, 31, 2],
            ["Beta", 2, 22, 2]
        ]);
        expect(board.stats).toMatchObject({ entries: 2, submitted: 2, fullyScored: 2 });
        expect(board.rows[0].comments).toEqual([{ judge: "Dr Judge", comment: "Great demo" }]);
        expect((await api(mentor).get(url("/leaderboard"))).status).toBe(200);
        expect((await api(alpha).get(url("/leaderboard"))).status).toBe(403);
        expect((await api(president).put(url(), { criteria: [{ name: "Only one", maxScore: 10 }] })).status).toBe(409);
    });

    test("the leaderboard becomes the results draft; the president publishes it and winners get merit certificates", async () => {
        expect((await api(president).put(`/api/events/${eventId}`, { certificatesEnabled: true })).status).toBe(200);
        const drafted = await api(president).post(url("/results"), { winners: 2 });
        expect(drafted.status).toBe(200);
        const result = await EventResult.findOne({ event: eventId });
        expect(result.status).toBe("DRAFT");
        expect(result.awards.map((award) => [award.position, award.title, award.teamName])).toEqual([
            [1, "Winner", "Alpha"],
            [2, "1st runner-up", "Beta"]
        ]);
        expect(result.rounds[0]).toMatchObject({ name: "Judging" });
        expect(result.rounds[0].entries.map((entry) => [entry.rank, entry.teamName, entry.score])).toEqual([
            [1, "Alpha", "31/40"],
            [2, "Beta", "22/40"]
        ]);

        // Checked in: Alpha's members. Then the event ends and results are published.
        await EventRegistration.updateMany({ event: eventId, user: { $in: [alpha._id, alpha2._id] } }, { $set: { checkedInAt: new Date() } });
        await Event.updateOne({ _id: eventId }, { $set: { endAt: minutesFromNow(-5), status: "COMPLETED", completedAt: new Date() } });
        expect((await api(president).post(`/api/events/${eventId}/results/publish`)).status).toBe(200);
        expect(await Notification.exists({ user: alpha2._id, type: "CERTIFICATE_READY" })).toBeTruthy();

        const mine = (await api(alpha2).get(`/api/events/${eventId}/certificates`)).body.data.items;
        expect(mine.map((item) => [item.kind, item.awardTitle, item.teamName])).toEqual([
            ["PARTICIPATION", null, "Alpha"],
            ["MERIT", "Winner", "Alpha"]
        ]);
        // Beta wasn't checked in: merit only.
        expect((await api(beta).get(`/api/events/${eventId}/certificates`)).body.data.items.map((item) => item.kind)).toEqual(["MERIT"]);
        expect((await api(outsider).get(`/api/events/${eventId}/certificates`)).body.data.items).toEqual([]);

        const pdf = await api(alpha2).get(`/api/certificates/${mine[1].code}/pdf`).buffer(true).parse((res, done) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => done(null, Buffer.concat(chunks)));
        });
        expect(pdf.status).toBe(200);
        expect(pdf.headers["content-type"]).toMatch(/pdf/);
        expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
        expect((await api(beta).get(`/api/certificates/${mine[1].code}/pdf`)).status).toBe(404);

        const check = await api(null).get(`/api/certificates/verify/${mine[1].code}`);
        expect(check.body.data).toMatchObject({ valid: true, recipientName: "Alpha Two", kind: "MERIT", eventTitle: "HackNight", clubName: "Coding Club" });
        expect((await api(null).get("/api/certificates/verify/CERT-AAAAAAAAAA")).body.data).toEqual({ valid: false });
        expect((await api(alpha2).get("/api/certificates/mine")).body.data).toHaveLength(2);
    });
});
