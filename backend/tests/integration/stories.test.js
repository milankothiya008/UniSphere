const fs = require("fs");
const path = require("path");
const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, api } = require("../helpers/factory");
const { env } = require("../../config/env");
const Story = require("../../models/Story");
const StoryView = require("../../models/StoryView");
const { sweepExpiredStories, invalidateTray } = require("../../services/StoryService");

beforeAll(db.connect);
afterAll(db.disconnect);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64, 2)]);

const upload = (user, clubId, buffer, name) =>
    request(app).post(`/api/stories/media?club=${clubId}`).set("Authorization", `Bearer ${user.token}`).attach("file", buffer, name);

const localPath = (url) => path.join(env.uploadDir, url.replace(/^.*\/uploads\//, ""));

describe("club stories", () => {
    let venues, club, otherClub, mentor, president, vicePresident, marketer, member, student, otherPresident;

    const post = async (user = president, overrides = {}) => {
        const uploaded = await upload(user, club._id, PNG, "poster.png");
        expect(uploaded.status).toBe(201);
        return api(user).post("/api/stories", { club: String(club._id), media: uploaded.body.data, caption: "Hack Night is tonight!", ...overrides });
    };

    const trayFor = async (user) => (await api(user).get("/api/stories")).body.data;
    const groupOf = (tray, clubId = club._id) => tray.find((group) => String(group.club._id) === String(clubId));

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, vicePresident, marketer, member, student, otherPresident] = await Promise.all([
            makeFaculty(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice President" }),
            makeStudent({ name: "Marketing" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Viewer Student", department: "IT" }),
            makeStudent({ name: "Other President" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        otherClub = await makeActiveClub({ name: "Music Society", mentor, president: otherPresident });
        await addMembership(club, vicePresident, "VICE_PRESIDENT");
        await addMembership(club, marketer, "MARKETING_COORDINATOR");
        await addMembership(club, member, "MEMBER");
    });

    beforeEach(async () => {
        await Promise.all([Story.deleteMany({}), StoryView.deleteMany({})]);
        invalidateTray();
    });

    describe("posting", () => {
        test("without cloud credentials the upload ticket points at development storage", async () => {
            const ticket = await api(president).post("/api/stories/uploads", { club: String(club._id), kind: "VIDEO" });
            expect(ticket.status).toBe(201);
            expect(ticket.body.data).toMatchObject({ provider: "local", kind: "VIDEO", uploadUrl: "/stories/media", maxVideoSeconds: 30 });
        });

        test("the president posts a photo story: the file goes to media storage, only its details to the database", async () => {
            const response = await post();
            expect(response.status).toBe(201);
            expect(response.body.data).toMatchObject({ kind: "IMAGE", caption: "Hack Night is tonight!", viewCount: 0, seen: false });
            expect(response.body.data.url).toMatch(/\/uploads\/stories\/[a-f0-9]{24}\/.+\.png$/);
            expect(fs.existsSync(localPath(response.body.data.url))).toBe(true);

            const stored = await Story.findById(response.body.data._id).lean();
            expect(stored.media).toMatchObject({ kind: "IMAGE", provider: "local", format: "png" });
            expect(JSON.stringify(stored)).not.toContain("base64");
            const hours = (stored.expiresAt - stored.createdAt) / 3600000;
            expect(hours).toBeCloseTo(24, 1);
        });

        test("videos are accepted and recognised from their bytes", async () => {
            const uploaded = await upload(president, club._id, MP4, "clip.mp4");
            expect(uploaded.status).toBe(201);
            expect(uploaded.body.data).toMatchObject({ kind: "VIDEO", format: "mp4" });

            const response = await api(president).post("/api/stories", { club: String(club._id), media: { ...uploaded.body.data, duration: 12.4 } });
            expect(response.status).toBe(201);
            expect(response.body.data).toMatchObject({ kind: "VIDEO", duration: 12.4 });
        });

        test("files that are not photos or videos are refused, whatever their name says", async () => {
            const response = await upload(president, club._id, Buffer.from("definitely not an image, just some text"), "fake.png");
            expect(response.status).toBe(400);
            expect(response.body.message).toMatch(/Only JPEG, PNG or WebP photos and MP4, MOV or WebM videos/);
        });

        test("officers who post updates can add stories; plain members, other clubs and faculty cannot", async () => {
            expect((await post(vicePresident)).status).toBe(201);
            expect((await post(marketer)).status).toBe(201);

            for (const outsider of [member, student, otherPresident, mentor]) {
                const ticket = await api(outsider).post("/api/stories/uploads", { club: String(club._id), kind: "IMAGE" });
                expect(ticket.status).toBe(403);
                expect((await upload(outsider, club._id, PNG, "x.png")).status).toBe(403);
            }
        });

        test("an upload can only be used by the person and club it was issued for, and cannot be tampered with", async () => {
            const uploaded = (await upload(president, club._id, PNG, "poster.png")).body.data;

            const otherPerson = await api(vicePresident).post("/api/stories", { club: String(club._id), media: uploaded });
            expect(otherPerson.status).toBe(400);
            expect(otherPerson.body.message).toBe("This upload was not issued for this club");

            const [payload, signature] = uploaded.token.split(".");
            const altered = JSON.parse(Buffer.from(payload, "base64url").toString());
            altered.k = "../../server.js";
            const forged = `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}`;
            expect((await api(president).post("/api/stories", { club: String(club._id), media: { ...uploaded, token: forged } })).status).toBe(400);

            expect((await api(president).post("/api/stories", { club: String(club._id), media: { provider: "cloudinary", publicId: "x", version: 1, signature: "y", kind: "IMAGE" } })).status).toBe(400);
        });

        test("an event's poster can be shared to the story without uploading anything", async () => {
            const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { poster: "https://cdn.example.com/hacknight.jpg" }));
            const eventId = draft.body.data._id;
            await api(president).post(`/api/events/${eventId}/submit`);
            await api(mentor).post(`/api/events/${eventId}/approve`);
            await api(president).post(`/api/events/${eventId}/publish`);

            const shared = await api(president).post("/api/stories", { club: String(club._id), event: eventId, media: { provider: "event" }, caption: "Registrations open" });
            expect(shared.status).toBe(201);
            expect(shared.body.data).toMatchObject({ kind: "IMAGE", url: "https://cdn.example.com/hacknight.jpg", event: { _id: eventId, title: "Hack Night" } });

            // Deleting the story never deletes the event's poster.
            expect((await api(president).delete(`/api/stories/${shared.body.data._id}`)).status).toBe(200);
            expect((await Story.countDocuments())).toBe(0);
        });

        test("a club can have a limited number of live stories", async () => {
            const previous = env.stories.maxActivePerClub;
            env.stories.maxActivePerClub = 2;
            try {
                await post();
                await post();
                const third = await api(president).post("/api/stories/uploads", { club: String(club._id), kind: "IMAGE" });
                expect(third.status).toBe(409);
                expect(third.body.message).toMatch(/up to 2 live stories/);
            } finally {
                env.stories.maxActivePerClub = previous;
            }
        });
    });

    describe("watching", () => {
        let storyId;

        beforeEach(async () => {
            storyId = (await post()).body.data._id;
        });

        test("everyone signed in sees the club's ring; counts are only shown to the club's managers", async () => {
            const studentGroup = groupOf(await trayFor(student));
            expect(studentGroup).toMatchObject({ canManage: false, allSeen: false, club: { name: "Coding Club" } });
            expect(studentGroup.stories[0]).toMatchObject({ _id: storyId, seen: false, liked: false });
            expect(studentGroup.stories[0].viewCount).toBeUndefined();
            expect(studentGroup.stories[0].author).toBeUndefined();

            const presidentGroup = groupOf(await trayFor(president));
            expect(presidentGroup).toMatchObject({ canManage: true });
            expect(presidentGroup.stories[0].viewCount).toBe(0);
        });

        test("watching marks the ring as seen and counts each person once; the author's own views don't count", async () => {
            expect((await api(student).post(`/api/stories/${storyId}/view`)).status).toBe(200);
            await api(student).post(`/api/stories/${storyId}/view`);
            await api(member).post(`/api/stories/${storyId}/view`);
            await api(president).post(`/api/stories/${storyId}/view`);

            expect(groupOf(await trayFor(student))).toMatchObject({ allSeen: true, stories: [{ seen: true }] });
            expect((await Story.findById(storyId)).viewCount).toBe(2);

            const presidentGroup = groupOf(await trayFor(president));
            expect(presidentGroup.stories[0]).toMatchObject({ seen: true, viewCount: 2 });
        });

        test("viewers can like a story once, and take the like back", async () => {
            expect((await api(student).post(`/api/stories/${storyId}/like`, { liked: true })).body.data).toEqual({ liked: true });
            await api(student).post(`/api/stories/${storyId}/like`, { liked: true });
            expect((await Story.findById(storyId)).likeCount).toBe(1);
            expect(groupOf(await trayFor(student)).stories[0]).toMatchObject({ seen: true, liked: true });

            await api(student).post(`/api/stories/${storyId}/like`, { liked: false });
            expect((await Story.findById(storyId)).likeCount).toBe(0);

            const own = await api(president).post(`/api/stories/${storyId}/like`, { liked: true });
            expect(own.status).toBe(400);
        });

        test("the president sees who watched, newest first, with likes; other people cannot", async () => {
            await api(member).post(`/api/stories/${storyId}/view`);
            await api(student).post(`/api/stories/${storyId}/like`, { liked: true });
            await api(president).post(`/api/stories/${storyId}/view`);

            const viewers = await api(president).get(`/api/stories/${storyId}/viewers`);
            expect(viewers.status).toBe(200);
            expect(viewers.body.data.map((view) => [view.user.name, view.liked])).toEqual([
                ["Viewer Student", true],
                ["Member", false]
            ]);
            expect(viewers.body.meta).toMatchObject({ total: 2, viewCount: 2, likeCount: 1 });

            expect((await api(marketer).get(`/api/stories/${storyId}/viewers`)).status).toBe(200);
            expect((await api(student).get(`/api/stories/${storyId}/viewers`)).status).toBe(403);
            expect((await api(member).get(`/api/stories/${storyId}/viewers`)).status).toBe(403);
        });

        test("clubs the viewer manages come first, then unwatched rings", async () => {
            const music = await upload(otherPresident, otherClub._id, PNG, "m.png");
            await api(otherPresident).post("/api/stories", { club: String(otherClub._id), media: music.body.data });

            await api(student).post(`/api/stories/${storyId}/view`);
            const studentTray = await trayFor(student);
            expect(studentTray.map((group) => group.club.name)).toEqual(["Music Society", "Coding Club"]);

            expect((await trayFor(president))[0].club.name).toBe("Coding Club");
        });
    });

    describe("disappearing after 24 hours", () => {
        test("expired stories leave the tray at once and the sweeper deletes the file, the story and its views", async () => {
            const created = (await post()).body.data;
            await api(student).post(`/api/stories/${created._id}/view`);
            expect(fs.existsSync(localPath(created.url))).toBe(true);

            await Story.updateOne({ _id: created._id }, { expiresAt: new Date(Date.now() - 1000) });
            invalidateTray();

            expect(groupOf(await trayFor(student))).toBeUndefined();
            expect((await api(student).post(`/api/stories/${created._id}/view`)).status).toBe(404);

            expect(await sweepExpiredStories()).toEqual({ removed: 1, pending: 0 });
            expect(await Story.exists({ _id: created._id })).toBeNull();
            expect(await StoryView.countDocuments({ story: created._id })).toBe(0);
            expect(fs.existsSync(localPath(created.url))).toBe(false);
        });

        test("managers can delete a story early, which removes its file straight away", async () => {
            const created = (await post()).body.data;
            expect((await api(student).delete(`/api/stories/${created._id}`)).status).toBe(403);

            expect((await api(vicePresident).delete(`/api/stories/${created._id}`)).status).toBe(200);
            expect(fs.existsSync(localPath(created.url))).toBe(false);
            expect(groupOf(await trayFor(student))).toBeUndefined();
        });
    });
});
