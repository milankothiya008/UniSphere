const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, addMembership, eventPayload, api, outbox, flushEmails, mailsTo } = require("../helpers/factory");
const Club = require("../../models/Club");
const RecruitmentDrive = require("../../models/RecruitmentDrive");
const RecruitmentApplication = require("../../models/RecruitmentApplication");
const { expireOffers } = require("../../services/RecruitmentReminderService");

beforeAll(db.connect);
afterAll(db.disconnect);

const inDays = (days) => new Date(Date.now() + days * 86400000);

describe("suspending and reactivating a club", () => {
    let admin, mentor, president, attendee, applicant, offered, latecomer, club, eventId, driveId, position;

    const clubUrl = () => `/api/clubs/${club._id}/status`;

    beforeAll(async () => {
        await db.clear();
        const venues = await seedReferenceData();
        [admin, mentor, president, attendee, applicant, offered, latecomer] = await Promise.all([
            makeAdmin(),
            makeFaculty({ name: "Dr. Mentor" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Attendee" }),
            makeStudent({ name: "Applicant" }),
            makeStudent({ name: "Offered" }),
            makeStudent({ name: "Latecomer" })
        ]);
        club = await makeActiveClub({ name: "Robotics Club", mentor, president });
        await addMembership(club, await makeStudent(), "MEMBER");

        // An upcoming published event with a registered student.
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Robo Race" }));
        eventId = draft.body.data._id;
        await api(president).post(`/api/events/${eventId}/submit`);
        await api(mentor).post(`/api/events/${eventId}/approve`);
        await api(president).post(`/api/events/${eventId}/publish`);
        expect((await api(attendee).post(`/api/events/${eventId}/register`)).status).toBe(201);

        // A live recruitment drive: one open application, one offer waiting for an answer.
        const created = await api(president).post(`/api/clubs/${club._id}/recruitment`, {
            title: "Build team",
            description: "Builders wanted for the robo race season.",
            positions: [{ role: "MEMBER", form: { pages: [] } }],
            applicationEnd: inDays(6).toISOString()
        });
        driveId = created.body.data._id;
        position = created.body.data.positions[0]._id;
        await RecruitmentDrive.updateOne({ _id: driveId }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
        expect((await api(applicant).post(`/api/recruitment/${driveId}/positions/${position}/application`, { answers: [] })).status).toBe(201);
        expect((await api(offered).post(`/api/recruitment/${driveId}/positions/${position}/application`, { answers: [] })).status).toBe(201);
        await RecruitmentApplication.updateOne({ drive: driveId, applicant: offered._id }, { $set: { status: "OFFERED", offeredAt: new Date(), offerExpiresAt: inDays(1) } });
    });

    test("only the admin changes status; suspending needs a reason; impossible moves are refused", async () => {
        expect((await api(president).post(clubUrl(), { status: "SUSPENDED", reason: "Testing" })).status).toBe(403);
        const noReason = await api(admin).post(clubUrl(), { status: "SUSPENDED" });
        expect(noReason.status).toBe(400);
        expect(noReason.body.message).toMatch(/Give a reason/);
        expect((await api(admin).post(clubUrl(), { status: "ACTIVE" })).body.message).toMatch(/already active/);
        expect((await api(admin).post(clubUrl(), { status: "APPROVED" })).status).toBe(400);
    });

    test("suspending pauses events and recruitment and tells everyone involved", async () => {
        outbox.length = 0;
        const res = await api(admin).post(clubUrl(), { status: "SUSPENDED", reason: "Safety review of the workshop equipment" });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "SUSPENDED", statusNote: "Safety review of the workshop equipment" });
        await flushEmails();

        const leaderMail = mailsTo(president.email).find((mail) => mail.subject === "Robotics Club has been suspended");
        expect(leaderMail.text).toMatch(/Safety review of the workshop equipment/);
        expect(leaderMail.text).toMatch(/1 registered student has been told/);
        expect(mailsTo(mentor.email).some((mail) => mail.subject === "Robotics Club has been suspended")).toBe(true);
        expect(mailsTo(attendee.email).find((mail) => mail.subject === "On hold: Robo Race").text).toMatch(/Your registration is kept/);
        expect(mailsTo(applicant.email).some((mail) => mail.subject === "Robotics Club recruitment is on hold")).toBe(true);
        // Students aren't told the admin's internal reason.
        expect(mailsTo(attendee.email).find((mail) => mail.subject === "On hold: Robo Race").text).not.toMatch(/Safety review/);
    });

    test("while suspended: hidden from discovery, closed to registration, applications and offers; offers don't expire", async () => {
        const events = await api(latecomer).get("/api/events?timeframe=upcoming");
        expect(events.body.data.map((event) => event.title)).not.toContain("Robo Race");
        const detail = await api(attendee).get(`/api/events/${eventId}`);
        expect(detail.body.data.onHold).toBe(true);

        const register = await api(latecomer).post(`/api/events/${eventId}/register`);
        expect(register.status).toBe(409);
        expect(register.body.message).toMatch(/on hold/);

        expect((await api(latecomer).get("/api/recruitment")).body.data).toHaveLength(0);
        expect((await api(latecomer).post(`/api/recruitment/${driveId}/positions/${position}/application`, { answers: [] })).body.message).toMatch(/recruitment is on hold/);
        const offer = await RecruitmentApplication.findOne({ drive: driveId, applicant: offered._id });
        expect((await api(offered).post(`/api/recruitment/${driveId}/applications/${offer._id}/accept`)).body.message).toMatch(/offers are on hold/);

        expect(await expireOffers({ now: inDays(3) })).toBe(0);
        expect((await RecruitmentApplication.findById(offer._id)).status).toBe("OFFERED");
    });

    test("reactivating resumes everything, moves deadlines on by the paused time and emails the note", async () => {
        // Pretend the club has been paused for two days.
        await Club.updateOne({ _id: club._id }, { $set: { pausedAt: inDays(-2) } });
        const before = await RecruitmentDrive.findById(driveId);
        const offerBefore = await RecruitmentApplication.findOne({ drive: driveId, applicant: offered._id });

        outbox.length = 0;
        const res = await api(admin).post(clubUrl(), { status: "ACTIVE", reason: "Equipment checked — all clear" });
        expect(res.body.data.status).toBe("ACTIVE");
        await flushEmails();

        const after = await RecruitmentDrive.findById(driveId);
        const shift = after.applicationEnd - before.applicationEnd;
        expect(Math.abs(shift - 2 * 86400000)).toBeLessThan(60000);
        const offerAfter = await RecruitmentApplication.findById(offerBefore._id);
        expect(Math.abs(offerAfter.offerExpiresAt - offerBefore.offerExpiresAt - 2 * 86400000)).toBeLessThan(60000);

        expect(mailsTo(president.email).find((mail) => mail.subject === "Robotics Club has been reactivated").text).toMatch(/Equipment checked — all clear/);
        expect(mailsTo(attendee.email).some((mail) => mail.subject === "Back on: Robo Race")).toBe(true);
        expect(mailsTo(offered.email).find((mail) => mail.subject === "Robotics Club recruitment has resumed").text).toMatch(/moved on by about 2 days/);

        const events = await api(latecomer).get("/api/events?timeframe=upcoming");
        expect(events.body.data.map((event) => event.title)).toContain("Robo Race");
        expect((await api(latecomer).post(`/api/events/${eventId}/register`)).status).toBe(201);
    });

    test("archiving and reactivating an archived club", async () => {
        expect((await api(admin).post(clubUrl(), { status: "ARCHIVED", reason: "Club merged into the Tech Society" })).body.data.status).toBe("ARCHIVED");
        expect((await api(admin).post(clubUrl(), { status: "SUSPENDED", reason: "Not allowed" })).status).toBe(409);
        expect((await api(admin).post(clubUrl(), { status: "ACTIVE" })).body.data.status).toBe("ACTIVE");
    });
});
