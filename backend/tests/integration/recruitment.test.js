const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api, outbox, flushEmails, mailsTo } = require("../helpers/factory");
const ClubMembership = require("../../models/ClubMembership");
const Notification = require("../../models/Notification");
const RecruitmentApplication = require("../../models/RecruitmentApplication");
const RecruitmentDrive = require("../../models/RecruitmentDrive");
const User = require("../../models/User");
const AuditLog = require("../../models/AuditLog");
const { sweepInterviewReminders } = require("../../services/RecruitmentReminderService");

beforeAll(db.connect);
afterAll(db.disconnect);

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
const inMinutes = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

const drivePayload = (overrides = {}) => ({
    title: "Core team recruitment 2026",
    description: "We're looking for builders, designers and storytellers to run the club next year.",
    positions: [
        { role: "TECHNICAL_COORDINATOR", title: "Technical lead", openings: 2 },
        { role: "MARKETING_COORDINATOR", title: "Design & social media" },
        { role: "MEMBER", title: "Member" }
    ],
    questions: [
        { type: "PARAGRAPH", label: "Why do you want to join?", required: true },
        { type: "SINGLE_CHOICE", label: "Which year are you in?", options: ["First", "Second", "Third"], required: true },
        { type: "MULTI_CHOICE", label: "Skills", options: ["Web", "Design", "Writing", "ML"] },
        { type: "LINK", label: "Portfolio or GitHub" },
        { type: "FILE", label: "Resume (PDF)" }
    ],
    applicationEnd: inDays(7),
    ...overrides
});

describe("club recruitment drives", () => {
    let venues, club, mentor, otherFaculty, president, vice, member, asha, bina, chirag, dev, itStudent, oldBatch;
    let driveId, questions, positions;

    const answersFor = (overrides = {}) => [
        { question: questions[0]._id, text: overrides.why ?? "I love building things with friends." },
        { question: questions[1]._id, choices: overrides.year ?? ["Second"] },
        { question: questions[2]._id, choices: overrides.skills ?? ["Web", "Design"] },
        { question: questions[3]._id, text: overrides.link ?? "https://github.com/asha" }
    ];
    const apply = (student, body = {}) => api(student).post(`/api/recruitment/${driveId}/application`, { positions: [positions[0]._id], answers: answersFor(), ...body });

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, otherFaculty, president, vice, member, asha, bina, chirag, dev, itStudent, oldBatch] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
            makeFaculty({ name: "Other Faculty" }),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice President" }),
            makeStudent({ name: "Plain Member" }),
            makeStudent({ name: "Asha Patel" }),
            makeStudent({ name: "Bina Shah", batch: "25" }),
            makeStudent({ name: "Chirag Rao" }),
            makeStudent({ name: "Dev Nair" }),
            makeStudent({ name: "IT Student", department: "IT" }),
            makeStudent({ name: "Old Batch", batch: "22" })
        ]);
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, vice, "VICE_PRESIDENT");
        await addMembership(club, member, "MEMBER");
    });

    describe("building the drive and faculty approval", () => {
        test("only the president creates a drive; it starts as a draft with the custom form", async () => {
            expect((await api(vice).post(`/api/clubs/${club._id}/recruitment`, drivePayload())).status).toBe(403);
            expect((await api(asha).post(`/api/clubs/${club._id}/recruitment`, drivePayload())).status).toBe(403);

            const bad = await api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload({ positions: [{ role: "PRESIDENT", title: "President" }] }));
            expect(bad.status).toBe(400);
            const noOptions = await api(president).post(
                `/api/clubs/${club._id}/recruitment`,
                drivePayload({ questions: [{ type: "SINGLE_CHOICE", label: "Pick one", options: ["Only one"] }] })
            );
            expect(noOptions.body.message).toMatch(/between 2 and 12 different options/);

            const res = await api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload({ eligibility: { batches: ["24", "25"] } }));
            expect(res.status).toBe(201);
            expect(res.body.data).toMatchObject({ status: "DRAFT", phase: "DRAFT", viewer: { canManage: true, canEdit: true } });
            expect(res.body.data.questions).toHaveLength(5);
            driveId = res.body.data._id;
            questions = res.body.data.questions;
            positions = res.body.data.positions;

            expect((await api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload())).body.message).toMatch(/already has a recruitment drive in progress/);
        });

        test("drafts are hidden from students; the club tab lists them for the president only", async () => {
            expect((await api(asha).get(`/api/recruitment/${driveId}`)).status).toBe(404);
            expect((await request(app).get(`/api/clubs/${club._id}/recruitment`)).body.data.items).toHaveLength(0);
            const staff = await api(president).get(`/api/clubs/${club._id}/recruitment`);
            expect(staff.body.data.items).toHaveLength(1);
            expect(staff.body.data.canCreate).toBe(false);
        });

        test("submit → the mentor is asked; changes requested; resubmitted; approved", async () => {
            outbox.length = 0;
            expect((await api(president).post(`/api/recruitment/${driveId}/publish`)).status).toBe(409);
            expect((await api(president).post(`/api/recruitment/${driveId}/submit`)).status).toBe(200);
            await flushEmails();
            expect(mailsTo(mentor.email).some((mail) => /Recruitment to review: Core team recruitment 2026/.test(mail.subject))).toBe(true);
            expect((await api(president).put(`/api/recruitment/${driveId}`, { title: "Changed" })).status).toBe(409);

            expect((await api(otherFaculty).post(`/api/recruitment/${driveId}/approve`)).status).toBe(403);
            expect((await api(president).post(`/api/recruitment/${driveId}/approve`)).status).toBe(403);
            expect((await api(mentor).post(`/api/recruitment/${driveId}/request-changes`, { comment: "no" })).status).toBe(400);
            const changes = await api(mentor).post(`/api/recruitment/${driveId}/request-changes`, { comment: "Please add a question about availability." });
            expect(changes.body.data.status).toBe("NEEDS_CHANGES");
            expect(await Notification.exists({ user: president._id, type: "RECRUITMENT_UPDATE" })).toBeTruthy();

            const edited = await api(president).put(`/api/recruitment/${driveId}`, {
                questions: [...questions, { type: "SHORT", label: "How many hours a week can you give?", required: true }]
            });
            expect(edited.status).toBe(200);
            questions = edited.body.data.questions;
            expect(questions).toHaveLength(6);

            await api(president).post(`/api/recruitment/${driveId}/submit`);
            const review = await api(mentor).get(`/api/recruitment/review`);
            expect(review.body.data.map((drive) => drive.title)).toEqual(["Core team recruitment 2026"]);
            const approved = await api(mentor).post(`/api/recruitment/${driveId}/approve`, { comment: "Looks good" });
            expect(approved.body.data.status).toBe("APPROVED");
        });

        test("publishing notifies and emails every eligible student — not members, other departments or batches", async () => {
            outbox.length = 0;
            await User.updateOne({ _id: dev._id }, { $set: { "emailPreferences.recruitment": false } });
            const res = await api(president).post(`/api/recruitment/${driveId}/publish`);
            expect(res.body.data).toMatchObject({ status: "PUBLISHED", phase: "OPEN" });
            await flushEmails();

            const launch = (student) => mailsTo(student.email).find((mail) => /Coding Club is recruiting/.test(mail.subject));
            expect(launch(asha)).toBeTruthy();
            expect(launch(asha).text).toMatch(/Technical lead, Design & social media, Member/);
            expect(launch(bina)).toBeTruthy();
            expect(launch(dev)).toBeFalsy(); // muted the category, still told in-app
            expect(await Notification.exists({ user: dev._id, type: "RECRUITMENT_OPEN" })).toBeTruthy();
            expect(launch(member)).toBeFalsy();
            expect(launch(itStudent)).toBeFalsy();
            expect(launch(oldBatch)).toBeFalsy();
        });

        test("the club and campus lists show the drive as open", async () => {
            const clubPage = await api(asha).get(`/api/clubs/${club._id}`);
            expect(clubPage.body.data.recruiting).toMatchObject({ _id: driveId, open: true });
            const open = await api(asha).get("/api/recruitment");
            expect(open.body.data[0]).toMatchObject({ _id: driveId, eligible: true });
            const directory = await request(app).get("/api/clubs");
            expect((directory.body.data.items || directory.body.data).find((item) => item.name === "Coding Club").recruiting._id).toBe(driveId);
        });
    });

    describe("applying", () => {
        test("who can apply", async () => {
            expect((await apply(member)).body.message).toMatch(/already a member/);
            expect((await apply(itStudent)).body.message).toMatch(/recruits students from CE/);
            expect((await apply(oldBatch)).body.message).toMatch(/Open to batch 2024, 2025/);
            expect((await apply(mentor)).body.message).toMatch(/Only students can apply/);
            const detail = await api(itStudent).get(`/api/recruitment/${driveId}`);
            expect(detail.body.data.viewer).toMatchObject({ canApply: false, applyProblem: expect.stringMatching(/recruits students from CE/) });
        });

        test("answers are checked against the form", async () => {
            const hours = questions[5]._id;
            const withHours = (answers) => [...answers, { question: hours, text: "6 hours" }];
            expect((await apply(asha, { answers: answersFor({ why: "" }) })).body.message).toMatch(/Please answer "Why do you want to join\?"/);
            expect((await apply(asha, { answers: withHours(answersFor({ year: ["Fifth"] })) })).body.message).toMatch(/Choose from the options/);
            expect((await apply(asha, { answers: withHours(answersFor({ year: ["First", "Second"] })) })).body.message).toMatch(/Pick one option/);
            expect((await apply(asha, { answers: withHours(answersFor({ link: "github.com/asha" })) })).body.message).toMatch(/full link starting with https/);
            expect((await apply(asha, { answers: withHours(answersFor()), positions: [] })).status).toBe(400);
            expect((await apply(asha, { answers: answersFor() })).body.message).toMatch(/How many hours/);
        });

        test("a student applies with a PDF resume and gets a confirmation; the president is told", async () => {
            outbox.length = 0;
            const tickets = await api(asha).post(`/api/recruitment/${driveId}/uploads`, { kinds: ["DOCUMENT"] });
            expect(tickets.status).toBe(201);
            expect(tickets.body.data[0]).toMatchObject({ provider: "local", uploadUrl: `/recruitment/${driveId}/media` });
            const uploaded = await request(app).post(`/api/recruitment/${driveId}/media`).set("Authorization", `Bearer ${asha.token}`).attach("file", PDF, "resume.pdf");
            expect(uploaded.status).toBe(201);
            expect(uploaded.body.data.kind).toBe("DOCUMENT");
            const notPdf = await request(app).post(`/api/recruitment/${driveId}/media`).set("Authorization", `Bearer ${asha.token}`).attach("file", Buffer.from("plain text, no"), "x.pdf");
            expect(notPdf.body.message).toMatch(/Only PDF files and JPEG, PNG or WebP photos are allowed|Only JPEG, PNG or WebP photos and PDF files are allowed/);

            const answers = [...answersFor(), { question: questions[4]._id, media: { ...uploaded.body.data, name: "resume.pdf" } }, { question: questions[5]._id, text: "6 hours" }];
            const res = await apply(asha, { answers, positions: [positions[0]._id, positions[2]._id] });
            expect(res.status).toBe(201);
            expect(res.body.data).toMatchObject({ status: "APPLIED", positionTitles: ["Technical lead", "Member"], canEdit: true });
            const file = res.body.data.answers.find((answer) => answer.type === "FILE").file;
            expect(file).toMatchObject({ name: "resume.pdf", kind: "DOCUMENT" });
            expect(file.url).toMatch(/\/uploads\/recruitment\/.+\.pdf$/);

            expect((await apply(asha, { answers })).status).toBe(409);
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => mail.subject === "Application received — Coding Club").text).toMatch(/Technical lead, Member/);
            expect(await Notification.exists({ user: president._id, title: "New application: Core team recruitment 2026" })).toBeTruthy();
        });

        test("applicants can edit (keeping their file) and withdraw; others apply", async () => {
            const current = (await api(asha).get(`/api/recruitment/${driveId}/application`)).body.data;
            const answers = [...answersFor({ why: "Edited answer" }), { question: questions[4]._id, keepFile: true }, { question: questions[5]._id, text: "8 hours" }];
            const edited = await api(asha).put(`/api/recruitment/${driveId}/application`, { positions: current.positions, answers });
            expect(edited.body.data.answers[0].text).toBe("Edited answer");
            expect(edited.body.data.answers.find((answer) => answer.type === "FILE").file.name).toBe("resume.pdf");

            const withHours = [...answersFor(), { question: questions[5]._id, text: "4 hours" }];
            expect((await apply(bina, { answers: withHours, positions: [positions[1]._id] })).status).toBe(201);
            expect((await apply(chirag, { answers: withHours })).status).toBe(201);
            expect((await apply(dev, { answers: withHours, positions: [positions[2]._id] })).status).toBe(201);

            expect((await api(dev).delete(`/api/recruitment/${driveId}/application`)).status).toBe(200);
            expect((await api(dev).get(`/api/recruitment/${driveId}/application`)).status).toBe(404);
            expect((await apply(dev, { answers: withHours, positions: [positions[2]._id] })).status).toBe(201); // changed their mind
        });

        test("only the president and the mentor read applications", async () => {
            expect((await api(vice).get(`/api/recruitment/${driveId}/applications`)).status).toBe(403);
            expect((await api(asha).get(`/api/recruitment/${driveId}/applications`)).status).toBe(403);
            const list = await api(mentor).get(`/api/recruitment/${driveId}/applications`);
            expect(list.body.data.map((row) => row.applicant.name)).toEqual(["Asha Patel", "Bina Shah", "Chirag Rao", "Dev Nair"]);
            const search = await api(president).get(`/api/recruitment/${driveId}/applications?search=bina`);
            expect(search.body.data).toHaveLength(1);
            const detail = await api(president).get(`/api/recruitment/${driveId}/applications/${search.body.data[0]._id}`);
            expect(detail.body.data.answers.map((answer) => answer.label)).toContain("Skills");
        });
    });

    describe("rounds", () => {
        let rounds;
        const roundsOf = async () => (await api(president).get(`/api/recruitment/${driveId}/rounds`)).body.data;
        const decide = (roundId, decisions) => api(president).put(`/api/recruitment/${driveId}/rounds/${roundId}/outcomes`, { decisions });
        const appOf = (student) => RecruitmentApplication.findOne({ drive: driveId, applicant: student._id });

        test("rounds start only after applications close", async () => {
            expect((await api(president).post(`/api/recruitment/${driveId}/rounds`, { name: "Screening", mode: "SCREENING" })).body.message).toMatch(/Close applications/);
            expect((await api(asha).post(`/api/recruitment/${driveId}/close`)).status).toBe(403);
            const closed = await api(president).post(`/api/recruitment/${driveId}/close`);
            expect(closed.body.data.phase).toBe("CLOSED");
            expect((await apply(asha)).status).toBe(403);
        });

        test("round 1 screening: undecided candidates block publishing; results email everyone", async () => {
            const created = await api(president).post(`/api/recruitment/${driveId}/rounds`, { name: "Application screening", mode: "SCREENING" });
            expect(created.status).toBe(201);
            rounds = created.body.data.rounds;
            expect(rounds[0].candidates).toHaveLength(4);
            expect((await api(president).post(`/api/recruitment/${driveId}/rounds`, { name: "Another", mode: "ONLINE" })).body.message).toMatch(/Publish the results/);

            const [a, b, c, d] = await Promise.all([asha, bina, chirag, dev].map(appOf));
            await decide(rounds[0]._id, [
                { applicationId: a._id, outcome: "QUALIFIED" },
                { applicationId: b._id, outcome: "QUALIFIED" },
                { applicationId: c._id, outcome: "QUALIFIED" }
            ]);
            expect((await api(president).post(`/api/recruitment/${driveId}/rounds/${rounds[0]._id}/publish`)).body.message).toMatch(/1 still has no result/);

            // Nothing is visible to the student before publishing.
            expect((await api(chirag).get(`/api/recruitment/${driveId}/application`)).body.data.rounds[0].result).toBeNull();

            outbox.length = 0;
            await decide(rounds[0]._id, [{ applicationId: d._id, outcome: "ELIMINATED", note: "Maybe next time" }]);
            const published = await api(president).post(`/api/recruitment/${driveId}/rounds/${rounds[0]._id}/publish`);
            expect(published.status).toBe(200);
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => /Congratulations! You cleared Application screening/.test(mail.subject))).toBeTruthy();
            const eliminated = mailsTo(dev.email).find((mail) => /Application screening result/.test(mail.subject));
            expect(eliminated.text).toMatch(/effort you put in genuinely counts/);
            expect((await appOf(dev)).status).toBe("ELIMINATED");
            expect((await api(dev).get(`/api/recruitment/${driveId}/application`)).body.data.rounds[0].result).toBe("ELIMINATED");
            expect((await decide(rounds[0]._id, [{ applicationId: a._id, outcome: "ELIMINATED" }])).status).toBe(409);
        });

        test("round 2 offline interviews with individual slots: venue checks, invites and slot moves", async () => {
            const created = await api(president).post(`/api/recruitment/${driveId}/rounds`, { name: "Technical interview", mode: "OFFLINE" });
            rounds = created.body.data.rounds;
            const round = rounds[1];
            expect(round.candidates.map((candidate) => candidate.applicant.name)).toEqual(["Asha Patel", "Bina Shah", "Chirag Rao"]);

            // An event already holds the auditorium at that time.
            const eventDate = futureDate(3);
            const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { eventDate, startTime: "10:00", endTime: "13:00", registrationEnd: inDays(1) }));
            await api(president).post(`/api/events/${draft.body.data._id}/submit`);
            const clash = await api(president).put(`/api/recruitment/${driveId}/rounds/${round._id}/schedule`, {
                timing: "SLOTS",
                startAt: `${eventDate}T11:00:00+05:30`,
                slotMinutes: 20,
                venue: String(venues.auditorium._id)
            });
            expect(clash.status).toBe(409);
            expect(clash.body.message).toMatch(/Auditorium is already requested/);

            expect((await api(president).put(`/api/recruitment/${driveId}/rounds/${round._id}/schedule`, { timing: "SLOTS", startAt: inDays(3), slotMinutes: 20 })).body.message).toMatch(
                /Choose an available venue/
            );

            outbox.length = 0;
            const scheduled = await api(president).put(`/api/recruitment/${driveId}/rounds/${round._id}/schedule`, {
                timing: "SLOTS",
                startAt: `${eventDate}T15:00:00+05:30`,
                slotMinutes: 20,
                venue: String(venues.auditorium._id),
                instructions: "Bring your laptop."
            });
            expect(scheduled.status).toBe(200);
            const slots = scheduled.body.data.rounds[1].candidates.map((candidate) => candidate.slot.startAt);
            expect(new Date(slots[1]) - new Date(slots[0])).toBe(20 * 60000);
            await flushEmails();
            const invite = mailsTo(bina.email).find((mail) => /You're invited: Technical interview/.test(mail.subject));
            expect(invite.text).toMatch(/Auditorium, Main Campus/);
            expect(invite.text).toMatch(/Bring your laptop\./);
            expect(invite.text).toMatch(/15:20–15:40/);

            // Now an event can't take the auditorium during the interviews.
            const later = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Clashing event", eventDate, startTime: "15:30", endTime: "16:30", registrationEnd: inDays(1) }));
            expect(later.status).toBe(409);

            outbox.length = 0;
            const bApp = await appOf(bina);
            const moved = await api(president).patch(`/api/recruitment/${driveId}/rounds/${round._id}/slots/${bApp._id}`, { startAt: `${eventDate}T17:00:00+05:30` });
            expect(moved.status).toBe(200);
            await flushEmails();
            expect(mailsTo(bina.email).find((mail) => /Updated time: Technical interview/.test(mail.subject)).text).toMatch(/17:00–17:20/);
            expect(await AuditLog.exists({ action: "INTERVIEW_SLOT_CHANGED" })).toBeTruthy();

            const mine = await api(bina).get(`/api/recruitment/${driveId}/application`);
            expect(mine.body.data.rounds[1]).toMatchObject({ name: "Technical interview", venue: { name: "Auditorium" }, instructions: "Bring your laptop." });
        });

        test("reminders go out 1 hour and 10 minutes before, exactly once each", async () => {
            const round = rounds[1];
            const cApp = await appOf(chirag);
            const start = new Date(Date.now() + 50 * 60000);
            await RecruitmentApplication.updateOne({ _id: cApp._id, "slots.round": round._id }, { $set: { "slots.$.startAt": start, "slots.$.endAt": new Date(start.getTime() + 20 * 60000) } });
            outbox.length = 0;

            expect(await sweepInterviewReminders()).toBe(1);
            expect(await sweepInterviewReminders()).toBe(0);
            expect(await sweepInterviewReminders({ now: new Date(start.getTime() - 30 * 60000) })).toBe(0);
            expect(await sweepInterviewReminders({ now: new Date(start.getTime() - 8 * 60000) })).toBe(1);
            expect(await sweepInterviewReminders({ now: new Date(start.getTime() - 5 * 60000) })).toBe(0);
            await flushEmails();
            const subjects = mailsTo(chirag.email).map((mail) => mail.subject);
            expect(subjects).toEqual(expect.arrayContaining(["Starts in 60 minutes: Technical interview — Coding Club", "Starts in 10 minutes: Technical interview — Coding Club"]));
            expect(await Notification.countDocuments({ user: chirag._id, type: "INTERVIEW_REMINDER" })).toBe(2);
        });

        test("round 3 online interview at one common time needs an https meeting link", async () => {
            const [a, b, c] = await Promise.all([asha, bina, chirag].map(appOf));
            await decide(rounds[1]._id, [
                { applicationId: a._id, outcome: "QUALIFIED" },
                { applicationId: b._id, outcome: "QUALIFIED" },
                { applicationId: c._id, outcome: "ELIMINATED" }
            ]);
            await api(president).post(`/api/recruitment/${driveId}/rounds/${rounds[1]._id}/publish`);
            const created = await api(president).post(`/api/recruitment/${driveId}/rounds`, { name: "Final interview", mode: "ONLINE" });
            const round = created.body.data.rounds[2];

            const body = { timing: "COMMON", startAt: inDays(5), endAt: new Date(Date.now() + 5 * 86400000 + 3600000).toISOString() };
            expect((await api(president).put(`/api/recruitment/${driveId}/rounds/${round._id}/schedule`, { ...body, meetingLink: "meet.google.com/abc" })).body.message).toMatch(/https/);
            outbox.length = 0;
            const ok = await api(president).put(`/api/recruitment/${driveId}/rounds/${round._id}/schedule`, { ...body, meetingLink: "https://meet.google.com/abc-defg-hij" });
            expect(ok.status).toBe(200);
            await flushEmails();
            const invite = mailsTo(asha.email).find((mail) => /You're invited: Final interview/.test(mail.subject));
            expect(invite.text).toMatch(/Join the meeting: https:\/\/meet\.google\.com\/abc-defg-hij/);
            expect(mailsTo(chirag.email).some((mail) => /Final interview/.test(mail.subject))).toBe(false);

            await decide(round._id, [
                { applicationId: a._id, outcome: "QUALIFIED" },
                { applicationId: b._id, outcome: "QUALIFIED" }
            ]);
            await api(president).post(`/api/recruitment/${driveId}/rounds/${round._id}/publish`);
        });

        test("final selection: selected students join with their role; everyone hears back", async () => {
            const [a, b] = await Promise.all([asha, bina].map(appOf));
            const state = await roundsOf();
            expect(state).toMatchObject({ canFinalize: true, canAddRound: true });
            expect(state.finalists.map((finalist) => finalist.applicant.name)).toEqual(["Asha Patel", "Bina Shah"]);

            expect((await api(president).post(`/api/recruitment/${driveId}/finalize`, { decisions: [{ applicationId: a._id, selected: true, role: "TECHNICAL_COORDINATOR" }] })).body.message).toMatch(
                /Decide every finalist/
            );
            expect(
                (await api(president).post(`/api/recruitment/${driveId}/finalize`, { decisions: [{ applicationId: a._id, selected: true, role: "TREASURER" }, { applicationId: b._id, selected: false }] })).status
            ).toBe(400);

            outbox.length = 0;
            const done = await api(president).post(`/api/recruitment/${driveId}/finalize`, {
                decisions: [
                    { applicationId: a._id, selected: true, role: "TECHNICAL_COORDINATOR" },
                    { applicationId: b._id, selected: false }
                ]
            });
            expect(done.status).toBe(200);
            expect(done.body.data.status).toBe("COMPLETED");

            const membership = await ClubMembership.findOne({ club: club._id, user: asha._id });
            expect(membership).toMatchObject({ status: "APPROVED", role: "TECHNICAL_COORDINATOR" });
            expect(await ClubMembership.exists({ club: club._id, user: bina._id, status: "APPROVED" })).toBeNull();

            await flushEmails();
            const welcome = mailsTo(asha.email).find((mail) => mail.subject === "Welcome to Coding Club! 🎉");
            expect(welcome.text).toMatch(/welcome you as Technical lead/);
            expect(mailsTo(bina.email).find((mail) => /final result/.test(mail.subject)).text).toMatch(/apply again when the club recruits next/);
            expect(await Notification.exists({ user: mentor._id, title: "Coding Club finished recruiting" })).toBeTruthy();

            const mine = await api(asha).get("/api/recruitment/mine");
            expect(mine.body.data[0]).toMatchObject({ status: "SELECTED", finalRole: "TECHNICAL_COORDINATOR", roundsPassed: 3 });
            expect((await api(asha).get(`/api/clubs/${club._id}`)).body.data.viewer.isMember).toBe(true);
        });
    });

    describe("cancelling", () => {
        test("cancelling a live drive closes every application and tells the applicants", async () => {
            const created = await api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload({ title: "Spring intake", questions: [] }));
            const id = created.body.data._id;
            await RecruitmentDrive.updateOne({ _id: id }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
            const applied = await api(chirag).post(`/api/recruitment/${id}/application`, { positions: [created.body.data.positions[2]._id], answers: [] });
            expect(applied.status).toBe(201);

            outbox.length = 0;
            const cancelled = await api(president).post(`/api/recruitment/${id}/cancel`, { reason: "Exams moved earlier" });
            expect(cancelled.body.data.status).toBe("CANCELLED");
            await flushEmails();
            expect(mailsTo(chirag.email).find((mail) => mail.subject === "Coding Club recruitment cancelled").text).toMatch(/Exams moved earlier/);
            expect((await RecruitmentApplication.findOne({ drive: id, applicant: chirag._id })).status).toBe("NOT_SELECTED");
        });

        test("drafts can be deleted; deadlines extended while no rounds have started", async () => {
            const created = await api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload({ title: "Draft drive", applicationEnd: inMinutes(120) }));
            expect((await api(president).delete(`/api/recruitment/${created.body.data._id}`)).status).toBe(200);
            expect(await RecruitmentDrive.exists({ _id: created.body.data._id })).toBeNull();
        });
    });
});
