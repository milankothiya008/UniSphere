const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const EventMedia = require("../../models/EventMedia");
const Team = require("../../models/Team");
const Hackathon = require("../../models/Hackathon");
const EventRegistration = require("../../models/EventRegistration");

beforeAll(db.connect);
afterAll(db.disconnect);

const regEnd = () => new Date(Date.now() + 3 * 86400000).toISOString();
const ids = (questions) => Object.fromEntries(questions.map((question) => [question.label, question._id]));

describe("registration forms, budgets, likes and sign-up phone", () => {
    let venues, mentor, president, asha, bina, chirag, club;

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, asha, bina, chirag] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Asha" }),
            makeStudent({ name: "Bina" }),
            makeStudent({ name: "Chirag" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
    });

    const publish = (id) => Event.updateOne({ _id: id }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });

    test("sign-up needs a valid mobile number", async () => {
        const body = { name: "New Student", email: "24ceuog901@ddu.ac.in", password: "Secret123", accountType: "STUDENT" };
        expect((await request(app).post("/api/auth/register").send(body)).status).toBe(400);
        expect((await request(app).post("/api/auth/register").send({ ...body, phone: "12345" })).status).toBe(400);
        expect((await request(app).post("/api/auth/register").send({ ...body, phone: "98765 43210" })).status).toBe(201);
    });

    describe("an individual event with a registration form", () => {
        let eventId, questions;

        test("the club adds the questions it needs; students answer them to register", async () => {
            const created = await api(president).post(
                "/api/events",
                eventPayload(club, venues.auditorium, {
                    title: "Design Sprint",
                    eventDate: futureDate(6),
                    registrationEnd: regEnd(),
                    registrationForm: {
                        enabled: true,
                        questions: [
                            { type: "SINGLE_CHOICE", label: "T-shirt size", options: ["S", "M", "L"], required: true },
                            { type: "LINK", label: "Portfolio", required: false }
                        ]
                    }
                })
            );
            expect(created.status).toBe(201);
            eventId = created.body.data._id;
            questions = ids(created.body.data.registrationForm.questions);
            await publish(eventId);

            expect((await api(asha).post(`/api/events/${eventId}/register`)).status).toBe(400);
            expect((await api(asha).post(`/api/events/${eventId}/register`, { answers: [{ question: questions["T-shirt size"], choices: ["XL"] }] })).status).toBe(400);
            const ok = await api(asha).post(`/api/events/${eventId}/register`, { answers: [{ question: questions["T-shirt size"], choices: ["M"] }, { question: questions.Portfolio, text: "https://behance.net/asha" }] });
            expect(ok.status).toBe(201);
        });

        test("organisers see the answers; students can change theirs until the event", async () => {
            const listed = (await api(president).get(`/api/events/${eventId}/registrations`)).body;
            const list = { items: listed.data };
            expect(listed.meta.formColumns.map((column) => column.label)).toEqual(["T-shirt size", "Portfolio"]);
            expect(list.items[0].formAnswers[questions["T-shirt size"]]).toBe("M");

            const changed = await api(asha).put(`/api/events/${eventId}/register/answers`, { answers: [{ question: questions["T-shirt size"], choices: ["L"] }] });
            expect(changed.status).toBe(200);
            expect((await api(asha).get(`/api/events/${eventId}`)).body.data.myAnswers.answers[0].choices).toEqual(["L"]);
        });

        test("the club can switch the form off any time before the event", async () => {
            expect((await api(asha).put(`/api/events/${eventId}/registration-form`, { enabled: false })).status).toBe(403);
            expect((await api(president).put(`/api/events/${eventId}/registration-form`, { enabled: true, questions: [] })).status).toBe(400);
            expect((await api(president).put(`/api/events/${eventId}/registration-form`, { enabled: false, questions: [] })).status).toBe(200);
            expect((await api(bina).post(`/api/events/${eventId}/register`)).status).toBe(201);
        });
    });

    test("team events: the leader answers 'once per team' questions, every member answers the rest", async () => {
        const created = await api(president).post(
            "/api/events",
            eventPayload(club, venues.hall, {
                title: "Team Quiz",
                eventDate: futureDate(7),
                maxParticipants: 10,
                registrationEnd: regEnd(),
                participationMode: "TEAM",
                minTeamSize: 1,
                maxTeamSize: 3,
                registrationForm: {
                    enabled: true,
                    questions: [
                        { type: "SHORT", label: "Team idea", required: true, scope: "TEAM" },
                        { type: "SINGLE_CHOICE", label: "Food", options: ["Veg", "Non-veg"], required: true, scope: "MEMBER" }
                    ]
                }
            })
        );
        const eventId = created.body.data._id;
        const q = ids(created.body.data.registrationForm.questions);
        await publish(eventId);

        expect((await api(asha).post(`/api/events/${eventId}/register`, { teamName: "Owls", answers: [{ question: q.Food, choices: ["Veg"] }] })).status).toBe(400);
        const registered = await api(asha).post(`/api/events/${eventId}/register`, {
            teamName: "Owls",
            invitees: [String(chirag._id)],
            answers: [{ question: q.Food, choices: ["Veg"] }],
            teamAnswers: [{ question: q["Team idea"], text: "Campus quiz bot" }]
        });
        expect(registered.status).toBe(201);
        const team = await Team.findOne({ event: eventId, name: "Owls" });
        expect(team.answers[0].text).toBe("Campus quiz bot");

        expect((await api(chirag).post(`/api/events/${eventId}/teams/${team._id}/accept`)).status).toBe(400);
        expect((await api(chirag).post(`/api/events/${eventId}/teams/${team._id}/accept`, { answers: [{ question: q.Food, choices: ["Non-veg"] }] })).status).toBe(200);
        const member = await EventRegistration.findOne({ event: eventId, user: chirag._id });
        expect(member.answers[0].choices).toEqual(["Non-veg"]);

        const list = (await api(president).get(`/api/events/${eventId}/registrations`)).body.data;
        const row = list.find((item) => String(item.user._id) === String(chirag._id));
        expect(row.formAnswers).toEqual({ [q["Team idea"]]: "Campus quiz bot", [q.Food]: "Non-veg" });
    });

    describe("budget and equipment", () => {
        let eventId;

        test("the club asks for a budget and equipment; only the club, mentor and admin see it", async () => {
            const created = await api(president).post(
                "/api/events",
                eventPayload(club, venues.auditorium, {
                    title: "Tech Fest",
                    eventDate: futureDate(12),
                    registrationEnd: regEnd(),
                    budgetItems: [
                        { item: "Prizes", quantity: 3, unitCost: 2000 },
                        { item: "Snacks", quantity: 100, unitCost: 40 }
                    ],
                    equipment: [{ name: "Projector", quantity: 2 }],
                    budgetNote: "Sponsor covers T-shirts"
                })
            );
            expect(created.status).toBe(201);
            eventId = created.body.data._id;
            expect(created.body.data.budgetTotal).toBe(10000);
            expect((await api(mentor).get(`/api/events/${eventId}`)).body.data.equipment[0]).toMatchObject({ name: "Projector", quantity: 2 });

            await api(president).post(`/api/events/${eventId}/submit`);
            await api(mentor).post(`/api/events/${eventId}/approve`);
            await publish(eventId);
            const publicView = (await api(asha).get(`/api/events/${eventId}`)).body.data;
            expect(publicView.budgetItems).toBeUndefined();
            expect(publicView.budgetTotal).toBeUndefined();
            expect(publicView.equipment).toBeUndefined();
        });

        test("after it starts, the club records actual spending for the mentor", async () => {
            expect((await api(president).put(`/api/events/${eventId}/expenses`, { items: [{ item: "Prizes", amount: 6000 }] })).status).toBe(409);
            await Event.updateOne({ _id: eventId }, { $set: { startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 3600000) } });
            expect((await api(asha).put(`/api/events/${eventId}/expenses`, { items: [{ item: "Prizes", amount: 6000 }] })).status).toBe(403);
            const saved = await api(president).put(`/api/events/${eventId}/expenses`, { items: [{ item: "Prizes", amount: 6000 }, { item: "Snacks", amount: 3500 }], note: "Bills with the treasurer" });
            expect(saved.status).toBe(200);
            expect(saved.body.data.expensesTotal).toBe(9500);
        });
    });

    test("likes on event posts and gallery photos: once per person, organisers see who liked", async () => {
        const created = await api(president).post("/api/events", eventPayload(club, venues.hall, { title: "Photo Walk", eventDate: futureDate(9), registrationEnd: regEnd() }));
        const eventId = created.body.data._id;
        expect((await api(asha).put(`/api/likes/event/${eventId}`, { liked: true })).status).toBe(404); // not public yet
        await publish(eventId);

        await api(asha).put(`/api/likes/event/${eventId}`, { liked: true });
        const twice = await api(asha).put(`/api/likes/event/${eventId}`, { liked: true });
        expect(twice.body.data).toEqual({ liked: true, likeCount: 1 });
        expect((await api(bina).put(`/api/likes/event/${eventId}`, { liked: true })).body.data.likeCount).toBe(2);
        expect((await api(bina).put(`/api/likes/event/${eventId}`, { liked: false })).body.data.likeCount).toBe(1);

        const feed = (await api(asha).get("/api/events?timeframe=upcoming")).body.data.find((event) => event._id === eventId);
        expect(feed).toMatchObject({ likeCount: 1, likedByMe: true });
        expect((await api(president).get(`/api/likes/event/${eventId}`)).body.data.items.map((row) => row.user.name)).toEqual(["Asha"]);
        expect((await api(bina).get(`/api/likes/event/${eventId}`)).status).toBe(403);

        const photo = await EventMedia.create({ event: eventId, club: club._id, uploader: bina._id, uploaderRole: "PARTICIPANT", status: "APPROVED", media: { kind: "IMAGE", provider: "local", key: "x.jpg" } });
        expect((await api(asha).put(`/api/likes/media/${photo._id}`, { liked: true })).body.data.likeCount).toBe(1);
        expect((await api(bina).get(`/api/likes/media/${photo._id}`)).body.data.items[0].user.name).toBe("Asha");
        const gallery = (await api(asha).get(`/api/events/${eventId}/gallery`)).body.data;
        expect(gallery.items[0]).toMatchObject({ likeCount: 1, likedByMe: true });
    });

    test("hackathon submission forms follow the organisers' choices", async () => {
        const created = await api(president).post(
            "/api/events",
            eventPayload(club, venues.auditorium, { title: "Mini Hack", category: "HACKATHON", eventDate: futureDate(14), registrationEnd: regEnd(), participationMode: "TEAM", minTeamSize: 1, maxTeamSize: 2 })
        );
        const eventId = created.body.data._id;
        await publish(eventId);
        await api(bina).post(`/api/events/${eventId}/register`, { teamName: "Solo" });
        const url = (path = "") => `/api/events/${eventId}/hackathon${path}`;
        const minutes = (n) => new Date(Date.now() + n * 60000);
        await Event.updateOne({ _id: eventId }, { $set: { startAt: minutes(-120), endAt: minutes(600), registrationEnd: minutes(-180), registrationStart: minutes(-3000) } });
        await api(president).get(url());
        const saved = await api(president).put(url(), {
            submissionFields: { demoUrl: "OFF", videoUrl: "REQUIRED", deckUrl: "OPTIONAL", techStack: "OFF" },
            submissionQuestions: [{ type: "SHORT", label: "APIs used", required: true }]
        });
        expect(saved.body.data.submissionFields).toEqual({ demoUrl: "OFF", videoUrl: "REQUIRED", deckUrl: "OPTIONAL", techStack: "OFF" });
        const apis = saved.body.data.submissionQuestions[0]._id;
        await Hackathon.updateOne({ event: eventId }, { $set: { revealAt: minutes(-110), selectionDeadline: minutes(-90), repoDeadline: minutes(-5), submissionDeadline: minutes(300) } });
        const Entry = require("../../models/HackathonEntry");
        const team = await Team.findOne({ event: eventId });
        await Entry.create({ event: eventId, entryKey: `team:${team._id}`, team: team._id, owner: bina._id, name: "Solo", project: { repoUrl: "https://github.com/solo/x" }, repoSubmittedAt: minutes(-30) });

        const base = { title: "Thing", summary: "A thing that does helpful stuff for students." };
        expect((await api(bina).put(url("/entry/project"), { ...base, demoUrl: "https://demo.example.com" })).body.message).toMatch(/demo video/);
        expect((await api(bina).put(url("/entry/project"), { ...base, videoUrl: "https://youtu.be/x" })).body.message).toMatch(/APIs used/);
        const ok = await api(bina).put(url("/entry/project"), { ...base, videoUrl: "https://youtu.be/x", demoUrl: "https://ignored.example.com", answers: [{ question: apis, text: "Maps, UPI" }] });
        expect(ok.status).toBe(200);
        expect(ok.body.data.myEntry.project).toMatchObject({ videoUrl: "https://youtu.be/x", demoUrl: "" });
        expect(ok.body.data.myEntry.submissionAnswers[0].text).toBe("Maps, UPI");
    });
});
