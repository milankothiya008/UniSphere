const request = require("supertest");
const db = require("../helpers/testDb");
const {
    app,
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
const EmailJob = require("../../models/EmailJob");
const User = require("../../models/User");
const Club = require("../../models/Club");
const { processEmailQueue } = require("../../services/EmailQueueService");

beforeAll(db.connect);
afterAll(db.disconnect);

// Pulls the one-click unsubscribe URL out of an email's List-Unsubscribe header.
const oneClickToken = (mail) => new URL(mail.headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("token");

describe("club bell, campaign emails and unsubscribe", () => {
    let venues, club, mentor, president, member, mutedMember, itFollower, ceStudent, ecStudent, noRecommendations, faculty;

    const publishEvent = async (overrides = {}) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { maxParticipants: 100, ...overrides }));
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        const published = await api(president).post(`/api/events/${id}/publish`);
        expect(published.status).toBe(200);
        return id;
    };

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, member, mutedMember, itFollower, ceStudent, ecStudent, noRecommendations, faculty] = await Promise.all([
            makeFaculty({ name: "Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Member" }),
            makeStudent({ name: "Muted Member" }),
            makeStudent({ name: "IT Follower", department: "IT" }),
            makeStudent({ name: "CE Student" }),
            makeStudent({ name: "EC Student", department: "EC" }),
            makeStudent({ name: "No Recommendations" }),
            makeFaculty({ name: "Other Faculty", department: "IT" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, member, "MEMBER");
        await addMembership(club, mutedMember, "MEMBER");
        await User.updateOne({ _id: noRecommendations._id }, { "emailPreferences.eventRecommendations": false });
    });

    describe("the bell", () => {
        test("members start with notifications on; others start with them off", async () => {
            expect((await api(member).get(`/api/clubs/${club._id}/subscription`)).body.data).toMatchObject({ subscribed: true, emailsEnabled: true });
            expect((await api(itFollower).get(`/api/clubs/${club._id}/subscription`)).body.data.subscribed).toBe(false);
        });

        test("anyone can turn it on, members can turn it off, and the club shows its follower count", async () => {
            const on = await api(itFollower).put(`/api/clubs/${club._id}/subscription`, { enabled: true });
            expect(on.body.data.subscribed).toBe(true);
            expect(on.body.message).toBe("Notifications turned on");

            const off = await api(mutedMember).put(`/api/clubs/${club._id}/subscription`, { enabled: false });
            expect(off.body.data.subscribed).toBe(false);

            const detail = await api(itFollower).get(`/api/clubs/${club._id}`);
            expect(detail.body.data.viewer.subscribed).toBe(true);
            // President + member (muted member opted out) + IT follower.
            expect(detail.body.data.followerCount).toBe(3);

            const mine = await api(itFollower).get("/api/notifications/subscriptions");
            expect(mine.body.data.map((row) => row.club.name)).toEqual(["Coding Club"]);
        });

        test("the bell can only be turned on for active clubs, and needs a boolean", async () => {
            const suspended = await makeActiveClub({ name: "Paused Club", mentor, president: await makeStudent() });
            await Club.updateOne({ _id: suspended._id }, { status: "SUSPENDED" });
            expect((await api(ceStudent).put(`/api/clubs/${suspended._id}/subscription`, { enabled: true })).status).toBe(409);
            expect((await api(ceStudent).put(`/api/clubs/${suspended._id}/subscription`, { enabled: false })).status).toBe(200);
            expect((await api(ceStudent).put(`/api/clubs/${club._id}/subscription`, { enabled: "yes" })).status).toBe(400);
            expect((await api(null).put(`/api/clubs/${club._id}/subscription`, { enabled: true })).status).toBe(401);
        });
    });

    describe("publishing an event", () => {
        let eventId;

        beforeAll(async () => {
            outbox.length = 0;
            eventId = await publishEvent({ title: "Hack Night", eligibility: { departments: ["CE", "IT"] } });
        });

        test("publishing returns before any email is sent; the queue delivers them", async () => {
            expect(outbox).toHaveLength(0);
            expect(await EmailJob.countDocuments({ status: "PENDING" })).toBeGreaterThan(0);
            await flushEmails();
            expect(await EmailJob.countDocuments({ status: "PENDING" })).toBe(0);
        });

        test("followers hear it from the club, with a link to turn that club off", () => {
            for (const user of [member, itFollower]) {
                const mails = mailsTo(user.email);
                expect(mails).toHaveLength(1);
                expect(mails[0].subject).toBe("Coding Club just announced: Hack Night");
                expect(mails[0].text).toMatch(/notifications are on for Coding Club/);
                expect(mails[0].text).toMatch(/Turn off emails from Coding Club: http:\/\/localhost:3000\/unsubscribe\?token=/);
                expect(mails[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
                expect(mails[0].html).toContain(`/events/${eventId}`);
            }
        });

        test("other eligible students get it as a recommendation; everyone else gets nothing", () => {
            const [recommendation] = mailsTo(ceStudent.email);
            expect(recommendation.subject).toBe("New event you can join: Hack Night");
            expect(recommendation.text).toMatch(/Open to: CE, IT/);
            expect(recommendation.text).toMatch(/Unsubscribe from "New events for you"/);

            // Not eligible, recommendations switched off, muted the club, published it, or faculty: no email.
            // (The mentor and president still get their normal review/approval emails for the event.)
            const launchMails = (user) => mailsTo(user.email).filter((mail) => /just announced|you can join/.test(mail.subject));
            for (const user of [ecStudent, noRecommendations, mutedMember, president, faculty, mentor]) {
                expect(launchMails(user)).toHaveLength(0);
            }
        });

        test("nobody gets the same launch email twice", async () => {
            outbox.length = 0;
            const { sendEventLaunchEmails } = require("../../services/CampusMailer");
            const event = await Event.findById(eventId);
            await sendEventLaunchEmails(event, club, president);
            await flushEmails();
            expect(outbox).toHaveLength(0);
        });
    });

    describe("unsubscribe links", () => {
        let clubToken, categoryToken;

        beforeAll(async () => {
            outbox.length = 0;
            await publishEvent({ title: "Quiz Night", eventDate: futureDate(12), startTime: "15:00", endTime: "16:00" });
            await flushEmails();
            clubToken = oneClickToken(mailsTo(itFollower.email)[0]);
            categoryToken = oneClickToken(mailsTo(ceStudent.email)[0]);
        });

        test("show what they switch off without signing in", async () => {
            const res = await request(app).get("/api/notifications/unsubscribe").query({ token: clubToken });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ scope: "club", label: "Emails from Coding Club" });
            expect(res.body.data.email).toMatch(/^\d{2}\*\*\*@ddu\.ac\.in$/);
        });

        test("one-click unsubscribe from a mail app turns the club's bell off", async () => {
            const res = await request(app)
                .post(`/api/notifications/unsubscribe?token=${encodeURIComponent(clubToken)}`)
                .type("form")
                .send("List-Unsubscribe=One-Click");
            expect(res.status).toBe(200);
            expect((await api(itFollower).get(`/api/clubs/${club._id}/subscription`)).body.data.subscribed).toBe(false);
        });

        test("a category link switches off only that kind of email", async () => {
            const res = await request(app).post("/api/notifications/unsubscribe").send({ token: categoryToken });
            expect(res.body.data).toMatchObject({ scope: "pref", label: "New events for you", unsubscribed: true });
            const prefs = await api(ceStudent).get("/api/notifications/preferences");
            expect(prefs.body.data.preferences).toEqual({ clubUpdates: true, eventRecommendations: false, eventActivity: true });
        });

        test("tampered or missing tokens are rejected", async () => {
            const [payload] = clubToken.split(".");
            const forged = `${Buffer.from(JSON.stringify({ u: String(member._id), s: "club", k: String(club._id) })).toString("base64url")}.${clubToken.split(".")[1]}`;
            expect((await request(app).post("/api/notifications/unsubscribe").send({ token: `${payload}.wrongsignature` })).status).toBe(400);
            expect((await request(app).post("/api/notifications/unsubscribe").send({ token: forged })).status).toBe(400);
            expect((await request(app).post("/api/notifications/unsubscribe").send({})).status).toBe(400);
        });
    });

    describe("email settings", () => {
        test("list the optional categories and save changes", async () => {
            const res = await api(member).get("/api/notifications/preferences");
            expect(res.body.data.categories.map((c) => c.key)).toEqual(["clubUpdates", "eventRecommendations", "eventActivity"]);

            const saved = await api(member).put("/api/notifications/preferences", { clubUpdates: false });
            expect(saved.body.data.preferences.clubUpdates).toBe(false);
            expect((await api(member).get(`/api/clubs/${club._id}/subscription`)).body.data.emailsEnabled).toBe(false);

            expect((await api(member).put("/api/notifications/preferences", { clubUpdates: "nope" })).status).toBe(400);
            expect((await api(member).put("/api/notifications/preferences", {})).status).toBe(400);
            await api(member).put("/api/notifications/preferences", { clubUpdates: true });
        });
    });

    describe("announcements", () => {
        beforeAll(async () => {
            // IT follower unsubscribed above; turn the bell back on for these tests.
            await api(itFollower).put(`/api/clubs/${club._id}/subscription`, { enabled: true });
        });

        beforeEach(() => {
            outbox.length = 0;
        });

        test("a public announcement is emailed to everyone whose bell is on", async () => {
            const res = await api(president).post("/api/feed", {
                club: String(club._id),
                type: "ANNOUNCEMENT",
                title: "Hackathon teams open",
                body: "Form teams of up to four.\n\nRegistration closes Friday."
            });
            expect(res.status).toBe(201);
            await flushEmails();

            for (const user of [member, itFollower]) {
                const [mail] = mailsTo(user.email);
                expect(mail.subject).toBe("Coding Club: Hackathon teams open");
                expect(mail.text).toMatch(/Form teams of up to four\.\n\nRegistration closes Friday\./);
            }
            for (const user of [mutedMember, ceStudent, president]) {
                expect(mailsTo(user.email)).toHaveLength(0);
            }
        });

        test("a members-only announcement reaches only members with the bell on", async () => {
            await api(president).post("/api/feed", { club: String(club._id), type: "CLUB_UPDATE", title: "Core team meeting", body: "Monday 5 PM.", visibility: "MEMBERS" });
            await flushEmails();
            expect(mailsTo(member.email).map((mail) => mail.subject)).toEqual(["Coding Club: Core team meeting"]);
            expect(mailsTo(itFollower.email)).toHaveLength(0);
            expect(mailsTo(mutedMember.email)).toHaveLength(0);
        });

        test("switching off 'Clubs you follow' stops club emails even with the bell on", async () => {
            await api(itFollower).put("/api/notifications/preferences", { clubUpdates: false });
            await api(president).post("/api/feed", { club: String(club._id), type: "ANNOUNCEMENT", title: "Another update", body: "Details." });
            await flushEmails();
            expect(mailsTo(itFollower.email)).toHaveLength(0);
            expect(mailsTo(member.email)).toHaveLength(1);
            await api(itFollower).put("/api/notifications/preferences", { clubUpdates: true });
        });
    });

    describe("publishing results", () => {
        let eventId, winner, participant;

        beforeAll(async () => {
            eventId = await publishEvent({ title: "Code Sprint", eventDate: futureDate(20) });
            winner = await makeStudent({ name: "Winner Person" });
            participant = await makeStudent({ name: "Participant Person" });
            await api(winner).post(`/api/events/${eventId}/register`);
            await api(participant).post(`/api/events/${eventId}/register`);
            await api(member).post(`/api/events/${eventId}/register`);
            await Event.updateOne(
                { _id: eventId },
                {
                    status: "COMPLETED",
                    registrationStart: new Date(Date.now() - 5 * 3600000),
                    registrationEnd: new Date(Date.now() - 4 * 3600000),
                    startAt: new Date(Date.now() - 3 * 3600000),
                    endAt: new Date(Date.now() - 3600000)
                }
            );
            await EventResult.create({
                event: eventId,
                club: club._id,
                summary: "Twelve teams took part.",
                awards: [{ title: "Winner", position: 1, recipientUser: winner._id, recipientName: "Winner Person", prize: "₹5,000" }],
                createdBy: president._id
            });
            await flushEmails();
            outbox.length = 0;
        });

        test("winners, participants and members each get one fitting email", async () => {
            expect((await api(president).post(`/api/events/${eventId}/results/publish`)).status).toBe(200);
            await flushEmails();

            expect(mailsTo(winner.email).map((m) => m.subject)).toEqual(["Congratulations! Winner at Code Sprint"]);
            expect(mailsTo(winner.email)[0].text).toMatch(/Prize: ₹5,000/);
            expect(mailsTo(participant.email).map((m) => m.subject)).toEqual(["Results are out: Code Sprint"]);
            // A member who also took part is emailed as a participant, not twice.
            expect(mailsTo(member.email).map((m) => m.subject)).toEqual(["Results are out: Code Sprint"]);

            // Followers who are not members, the muted member and the publisher get no result email.
            for (const user of [itFollower, mutedMember, president]) {
                expect(mailsTo(user.email)).toHaveLength(0);
            }
        });
    });
});

describe("email queue delivery", () => {
    const queueOne = async () => {
        await EmailJob.deleteMany({});
        const { enqueueEmails } = require("../../services/EmailQueueService");
        await enqueueEmails([{ to: "24ceuog900@ddu.ac.in", category: "account", subject: "Hello", html: "<p>Hi</p>", text: "Hi" }]);
    };

    test("a failed send is retried later, then delivered", async () => {
        await queueOne();
        const push = jest.spyOn(outbox, "push").mockImplementationOnce(() => {
            throw new Error("SMTP down");
        });

        expect(await processEmailQueue()).toEqual({ sent: 0, failed: 1 });
        const job = await EmailJob.findOne();
        expect(job).toMatchObject({ status: "PENDING", attempts: 1, lastError: "SMTP down" });
        expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

        // Not due yet.
        expect(await processEmailQueue()).toEqual({ sent: 0, failed: 0 });

        await EmailJob.updateOne({}, { nextAttemptAt: new Date(Date.now() - 1000) });
        expect(await processEmailQueue()).toEqual({ sent: 1, failed: 0 });
        expect(await EmailJob.findOne()).toMatchObject({ status: "SENT", attempts: 2 });
        push.mockRestore();
    });

    test("gives up after five attempts", async () => {
        await queueOne();
        const push = jest.spyOn(outbox, "push").mockImplementation(() => {
            throw new Error("Mailbox unavailable");
        });

        for (let attempt = 0; attempt < 5; attempt += 1) {
            await EmailJob.updateOne({}, { nextAttemptAt: new Date(Date.now() - 1000) });
            await processEmailQueue();
        }
        const job = await EmailJob.findOne();
        expect(job).toMatchObject({ status: "FAILED", attempts: 5 });
        expect(job.finishedAt).toBeInstanceOf(Date);
        push.mockRestore();
    });

    test("a job left mid-send by a crashed worker is picked up again", async () => {
        await queueOne();
        await EmailJob.updateOne({}, { status: "SENDING", lockedAt: new Date(Date.now() - 10 * 60 * 1000), attempts: 1 });
        expect(await processEmailQueue()).toEqual({ sent: 1, failed: 0 });
    });
});
