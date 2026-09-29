const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api, outbox, flushEmails, mailsTo } = require("../helpers/factory");
const ClubMembership = require("../../models/ClubMembership");
const Notification = require("../../models/Notification");
const RecruitmentApplication = require("../../models/RecruitmentApplication");
const RecruitmentDrive = require("../../models/RecruitmentDrive");
const { sweepInterviewReminders, expireOffers } = require("../../services/RecruitmentReminderService");

beforeAll(db.connect);
afterAll(db.disconnect);

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

describe("role-wise recruitment", () => {
    let venues, club, mentor, president, vice, member, asha, bina, chirag, dev, itStudent, oldBatch;
    let driveId, design, tech, designKey;

    const drivePayload = (overrides = {}) => ({
        title: "Core team recruitment 2026",
        description: "We're looking for builders and designers to run the club next year.",
        positions: [
            {
                role: designKey,
                openings: 1,
                description: "Posters, reels and our Instagram.",
                form: {
                    pages: [
                        { title: "About you", questions: [{ type: "PARAGRAPH", label: "Why design for us?", required: true }] },
                        {
                            title: "Your work",
                            questions: [
                                { type: "LINK", label: "Portfolio", required: true },
                                { type: "FILE", label: "Resume (PDF)" }
                            ]
                        }
                    ]
                }
            },
            {
                role: "TECHNICAL_COORDINATOR",
                openings: 2,
                form: { pages: [{ title: "Skills", questions: [{ type: "MULTI_CHOICE", label: "Stack", options: ["Web", "Mobile", "ML"], required: true }] }] }
            }
        ],
        applicationEnd: inDays(7),
        ...overrides
    });

    const questionsOf = (position) => position.form.pages.flatMap((page) => page.questions);
    const designAnswers = (extra = {}) => {
        const [why, portfolio] = questionsOf(design);
        return [
            { question: why._id, text: extra.why ?? "I make posters for fun." },
            { question: portfolio._id, text: extra.portfolio ?? "https://behance.net/me" }
        ];
    };
    const techAnswers = () => [{ question: questionsOf(tech)[0]._id, choices: ["Web", "ML"] }];
    const applyTo = (student, position, answers) => api(student).post(`/api/recruitment/${driveId}/positions/${position._id}/application`, { answers });
    const appOf = (student, position) => RecruitmentApplication.findOne({ drive: driveId, applicant: student._id, position: position._id });

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, vice, member, asha, bina, chirag, dev, itStudent, oldBatch] = await Promise.all([
            makeFaculty({ name: "Dr Mentor" }),
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
        const role = await api(president).post(`/api/clubs/${club._id}/roles`, { name: "Design lead", permissions: ["POST_UPDATES"] });
        designKey = role.body.data.roles.find((item) => item.name === "Design lead").key;
    });

    describe("building the drive", () => {
        test("roles come from the club: no presidency, no taken vice-president seat, no duplicates, titled pages", async () => {
            const post = (body) => api(president).post(`/api/clubs/${club._id}/recruitment`, drivePayload(body));
            expect((await post({ positions: [{ role: "PRESIDENT", form: { pages: [] } }] })).body.message).toMatch(/presidency is handed over/);
            expect((await post({ positions: [{ role: "VICE_PRESIDENT", form: { pages: [] } }] })).body.message).toMatch(/already has a vice-president/);
            expect((await post({ positions: [{ role: "TREASURER" }, { role: "TREASURER" }] })).body.message).toMatch(/listed twice/);
            expect((await post({ positions: [{ role: "TREASURER", form: { pages: [{ title: "", questions: [] }] } }] })).body.message).toMatch(/Page 1 of the Treasurer form needs a title/);
            expect((await api(vice).post(`/api/clubs/${club._id}/recruitment`, drivePayload())).status).toBe(403);

            const res = await post();
            expect(res.status).toBe(201);
            expect(res.body.data.positions.map((position) => position.title)).toEqual(["Design lead", "Technical coordinator"]);
            [design, tech] = res.body.data.positions;
            expect(design.form.pages.map((page) => page.title)).toEqual(["About you", "Your work"]);
            expect(design.questionCount).toBe(3);
            driveId = res.body.data._id;
        });

        test("the mentor reviews the whole drive; publishing emails eligible students with every role", async () => {
            await api(president).post(`/api/recruitment/${driveId}/submit`);
            expect((await api(mentor).get("/api/recruitment/review")).body.data[0]).toMatchObject({ positions: ["Design lead", "Technical coordinator"], questions: 4 });
            await api(mentor).post(`/api/recruitment/${driveId}/approve`, { comment: "Good" });
            outbox.length = 0;
            expect((await api(president).post(`/api/recruitment/${driveId}/publish`)).body.data.phase).toBe("OPEN");
            await flushEmails();
            const launch = mailsTo(asha.email).find((mail) => /Coding Club is recruiting/.test(mail.subject));
            expect(launch.text).toMatch(/Design lead, Technical coordinator/);
            expect(mailsTo(member.email).some((mail) => /recruiting/.test(mail.subject))).toBe(false);
            expect(mailsTo(itStudent.email).some((mail) => /recruiting/.test(mail.subject))).toBe(false);
        });
    });

    describe("applying: one application per role", () => {
        test("a student applies to two roles with two separate applications, each checked against its own form", async () => {
            expect((await applyTo(asha, design, designAnswers({ why: "" }))).body.message).toMatch(/Please answer "Why design for us\?"/);
            expect((await applyTo(asha, design, designAnswers({ portfolio: "behance.net" }))).body.message).toMatch(/full link/);

            const tickets = await api(asha).post(`/api/recruitment/${driveId}/uploads`, { kinds: ["DOCUMENT"] });
            expect(tickets.status).toBe(201);
            const uploaded = await request(app).post(`/api/recruitment/${driveId}/media`).set("Authorization", `Bearer ${asha.token}`).attach("file", PDF, "resume.pdf");
            outbox.length = 0;
            const first = await applyTo(asha, design, [...designAnswers(), { question: questionsOf(design)[2]._id, media: { ...uploaded.body.data, name: "resume.pdf" } }]);
            expect(first.status).toBe(201);
            expect(first.body.data).toMatchObject({ positionTitle: "Design lead", status: "APPLIED" });
            expect(first.body.data.pages.map((page) => page.title)).toEqual(["About you", "Your work"]);
            expect(first.body.data.pages[1].answers[1].file.name).toBe("resume.pdf");

            expect((await applyTo(asha, design, designAnswers())).status).toBe(409);
            expect((await applyTo(asha, tech, techAnswers())).status).toBe(201);
            await flushEmails();
            expect(mailsTo(asha.email).map((mail) => mail.subject)).toEqual(expect.arrayContaining(["Application received: Design lead — Coding Club", "Application received: Technical coordinator — Coding Club"]));

            const mine = await api(asha).get(`/api/recruitment/${driveId}/applications/mine`);
            expect(mine.body.data.map((application) => application.positionTitle)).toEqual(["Design lead", "Technical coordinator"]);
            const drive = await api(asha).get(`/api/recruitment/${driveId}`);
            expect(drive.body.data.viewer.applications).toHaveLength(2);
        });

        test("others apply; withdrawing one application leaves the others alone", async () => {
            expect((await applyTo(bina, design, designAnswers())).status).toBe(201);
            expect((await applyTo(chirag, tech, techAnswers())).status).toBe(201);
            expect((await applyTo(dev, tech, techAnswers())).status).toBe(201);
            expect((await applyTo(member, tech, techAnswers())).body.message).toMatch(/already a member/);
            expect((await applyTo(oldBatch, tech, techAnswers())).status).toBe(201); // no batch filter on this drive

            expect((await api(oldBatch).delete(`/api/recruitment/${driveId}/positions/${tech._id}/application`)).status).toBe(200);
            const list = await api(president).get(`/api/recruitment/${driveId}/applications?position=${tech._id}`);
            expect(list.body.data.map((row) => row.applicant.name)).toEqual(["Asha Patel", "Chirag Rao", "Dev Nair"]);
            expect(list.body.data.find((row) => row.applicant.name === "Asha Patel").otherRoles).toBe(1);
            const detail = await api(mentor).get(`/api/recruitment/${driveId}/applications/${list.body.data[0]._id}`);
            expect(detail.body.data.otherApplications).toEqual([expect.objectContaining({ positionTitle: "Design lead" })]);
        });
    });

    describe("each role runs its own selection", () => {
        const rounds = (position) => api(president).get(`/api/recruitment/${driveId}/positions/${position._id}/rounds`);
        const decide = (position, roundId, decisions) => api(president).put(`/api/recruitment/${driveId}/positions/${position._id}/rounds/${roundId}/outcomes`, { decisions });
        const publish = (position, roundId) => api(president).post(`/api/recruitment/${driveId}/positions/${position._id}/rounds/${roundId}/publish`);

        test("rounds start after applications close, separately per role", async () => {
            expect((await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/rounds`, { name: "Screening", mode: "SCREENING" })).body.message).toMatch(/Close applications/);
            await api(president).post(`/api/recruitment/${driveId}/close`);

            const created = await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/rounds`, { name: "Portfolio review", mode: "SCREENING" });
            expect(created.status).toBe(201);
            expect(created.body.data.rounds[0].candidates.map((candidate) => candidate.applicant.name)).toEqual(["Asha Patel", "Bina Shah"]);
            expect((await rounds(tech)).body.data.rounds).toHaveLength(0);

            const [round] = created.body.data.rounds;
            const [a, b] = await Promise.all([appOf(asha, design), appOf(bina, design)]);
            await decide(design, round._id, [
                { applicationId: a._id, outcome: "QUALIFIED" },
                { applicationId: b._id, outcome: "QUALIFIED" }
            ]);
            outbox.length = 0;
            expect((await publish(design, round._id)).status).toBe(200);
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => /cleared Portfolio review \(Design lead\)/.test(mail.subject))).toBeTruthy();
        });

        test("interview slots of a student in two roles never clash", async () => {
            const day = futureDate(3);
            const techRound = (await api(president).post(`/api/recruitment/${driveId}/positions/${tech._id}/rounds`, { name: "Tech interview", mode: "OFFLINE" })).body.data.rounds[0];
            const scheduledTech = await api(president).put(`/api/recruitment/${driveId}/positions/${tech._id}/rounds/${techRound._id}/schedule`, {
                timing: "SLOTS",
                startAt: `${day}T15:00:00+05:30`,
                slotMinutes: 20,
                venue: String(venues.auditorium._id)
            });
            expect(scheduledTech.status).toBe(200);
            const ashaTech = scheduledTech.body.data.rounds[0].candidates.find((candidate) => candidate.applicant.name === "Asha Patel").slot;
            expect(new Date(ashaTech.startAt).toISOString()).toBe(new Date(`${day}T15:00:00+05:30`).toISOString());

            const designRound = (await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/rounds`, { name: "Design interview", mode: "ONLINE" })).body.data.rounds[1];
            outbox.length = 0;
            const scheduledDesign = await api(president).put(`/api/recruitment/${driveId}/positions/${design._id}/rounds/${designRound._id}/schedule`, {
                timing: "SLOTS",
                startAt: `${day}T15:00:00+05:30`,
                slotMinutes: 20,
                meetingLink: "https://meet.google.com/abc-defg-hij"
            });
            expect(scheduledDesign.body.data.warnings).toEqual([]);
            const slots = Object.fromEntries(scheduledDesign.body.data.rounds[1].candidates.map((candidate) => [candidate.applicant.name, candidate.slot]));
            // Asha is busy at 15:00 in the tech interview, so Bina takes the first design slot.
            expect(new Date(slots["Bina Shah"].startAt).toISOString()).toBe(new Date(`${day}T15:00:00+05:30`).toISOString());
            expect(new Date(slots["Asha Patel"].startAt).toISOString()).toBe(new Date(`${day}T15:20:00+05:30`).toISOString());
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => /You're invited: Design interview \(Design lead\)/.test(mail.subject)).text).toMatch(/Role: Design lead/);
        });

        test("reminders still go out 60 and 10 minutes before", async () => {
            const cApp = await appOf(chirag, tech);
            const start = new Date(Date.now() + 50 * 60000);
            await RecruitmentApplication.updateOne({ _id: cApp._id }, { $set: { "slots.0.startAt": start, "slots.0.endAt": new Date(start.getTime() + 20 * 60000) } });
            expect(await sweepInterviewReminders()).toBe(1);
            expect(await sweepInterviewReminders()).toBe(0);
            expect(await sweepInterviewReminders({ now: new Date(start.getTime() - 8 * 60000) })).toBe(1);
        });

        test("final selection per role: offers up to the openings, a reserve list and thanks", async () => {
            const designRounds = (await rounds(design)).body.data.rounds;
            const [a, b] = await Promise.all([appOf(asha, design), appOf(bina, design)]);
            await decide(design, designRounds[1]._id, [
                { applicationId: a._id, outcome: "QUALIFIED" },
                { applicationId: b._id, outcome: "QUALIFIED" }
            ]);
            await publish(design, designRounds[1]._id);

            const tooMany = await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/finalize`, {
                decisions: [
                    { applicationId: a._id, decision: "OFFER" },
                    { applicationId: b._id, decision: "OFFER" }
                ]
            });
            expect(tooMany.body.message).toMatch(/1 opening/);

            outbox.length = 0;
            const finalized = await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/finalize`, {
                offerDays: 2,
                decisions: [
                    { applicationId: a._id, decision: "OFFER" },
                    { applicationId: b._id, decision: "RESERVE" }
                ]
            });
            expect(finalized.status).toBe(200);
            expect(finalized.body.data.seats).toMatchObject({ openings: 1, pending: 1, open: 0 });
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => mail.subject === "Offer: Design lead at Coding Club 🎉").text).toMatch(/accepting this offer closes your other applications/);
            expect(mailsTo(bina.email).find((mail) => /reserve list: Design lead/.test(mail.subject))).toBeTruthy();

            // Tech: Asha and Chirag get offers, Dev is thanked.
            const techRounds = (await rounds(tech)).body.data.rounds;
            const [ta, tc, td] = await Promise.all([appOf(asha, tech), appOf(chirag, tech), appOf(dev, tech)]);
            await decide(tech, techRounds[0]._id, [
                { applicationId: ta._id, outcome: "QUALIFIED" },
                { applicationId: tc._id, outcome: "QUALIFIED" },
                { applicationId: td._id, outcome: "QUALIFIED" }
            ]);
            await publish(tech, techRounds[0]._id);
            await api(president).post(`/api/recruitment/${driveId}/positions/${tech._id}/finalize`, {
                decisions: [
                    { applicationId: ta._id, decision: "OFFER" },
                    { applicationId: tc._id, decision: "OFFER" },
                    { applicationId: td._id, decision: "NOT_SELECTED" }
                ]
            });
            expect((await appOf(dev, tech)).status).toBe("NOT_SELECTED");
        });

        test("accepting one offer: the student joins in that role and every other application closes", async () => {
            const ashaTech = await appOf(asha, tech);
            expect((await api(bina).post(`/api/recruitment/${driveId}/applications/${ashaTech._id}/accept`)).status).toBe(409);

            outbox.length = 0;
            const accepted = await api(asha).post(`/api/recruitment/${driveId}/applications/${ashaTech._id}/accept`);
            expect(accepted.status).toBe(200);
            expect(accepted.body.data.find((application) => application.positionTitle === "Technical coordinator").status).toBe("ACCEPTED");
            expect(await ClubMembership.findOne({ club: club._id, user: asha._id })).toMatchObject({ status: "APPROVED", role: "TECHNICAL_COORDINATOR" });

            const designApp = await appOf(asha, design);
            expect(designApp).toMatchObject({ status: "WITHDRAWN", closedReason: "Joined as Technical coordinator" });
            await flushEmails();
            expect(mailsTo(asha.email).find((mail) => mail.subject === "Welcome to Coding Club! 🎉").text).toMatch(/applications for Design lead have been closed/);
            expect(await Notification.exists({ user: president._id, title: "Asha Patel joined as Technical coordinator", message: /Design lead offer is free again/ })).toBeTruthy();

            expect((await api(asha).post(`/api/recruitment/${driveId}/applications/${designApp._id}/accept`)).status).toBe(409);
        });

        test("the freed seat goes to the reserve list; an unanswered offer expires", async () => {
            const state = (await rounds(design)).body.data;
            expect(state).toMatchObject({ canOfferReserve: true, seats: { open: 1 } });
            const binaApp = await appOf(bina, design);
            outbox.length = 0;
            const offered = await api(president).post(`/api/recruitment/${driveId}/positions/${design._id}/offers/${binaApp._id}`);
            expect(offered.status).toBe(200);
            await flushEmails();
            expect(mailsTo(bina.email).some((mail) => mail.subject === "Offer: Design lead at Coding Club 🎉")).toBe(true);

            expect(await expireOffers({ now: new Date(Date.now() + 3 * 86400000) })).toBeGreaterThanOrEqual(1);
            expect((await appOf(bina, design)).status).toBe("EXPIRED");
            expect(await Notification.exists({ user: president._id, title: "Offer expired: Design lead" })).toBeTruthy();
        });

        test("once every role is decided and no offer is waiting, the drive completes", async () => {
            // Chirag's tech offer also expired above; with nothing left, the drive is complete.
            const drive = await RecruitmentDrive.findById(driveId);
            expect(drive.status).toBe("COMPLETED");
            expect(await Notification.exists({ user: mentor._id, title: "Coding Club finished recruiting", message: "1 new member joined through Core team recruitment 2026." })).toBeTruthy();
            const mine = await api(asha).get("/api/recruitment/mine");
            // The Design lead application closed when Asha joined; she still sees it, with the reason.
            expect(mine.body.data.map((row) => [row.positionTitle, row.status, row.closedReason])).toEqual(
                expect.arrayContaining([
                    ["Technical coordinator", "ACCEPTED", null],
                    ["Design lead", "WITHDRAWN", "Joined as Technical coordinator"]
                ])
            );
            expect((await api(president).post(`/api/recruitment/${driveId}/complete`)).status).toBe(409);
        });
    });

    describe("vice-president and cancelling", () => {
        test("a free vice-president seat is recruited for exactly one person, and re-checked on accept", async () => {
            const chessPresident = await makeStudent({ name: "Chess President" });
            const chess = await makeActiveClub({ name: "Chess Club", mentor, president: chessPresident });
            const created = await api(chessPresident).post(`/api/clubs/${chess._id}/recruitment`, drivePayload({ title: "Vice-president election", positions: [{ role: "VICE_PRESIDENT", openings: 3, form: { pages: [] } }] }));
            expect(created.status).toBe(201);
            const [vp] = created.body.data.positions;
            expect(vp).toMatchObject({ title: "Vice-president", openings: 1 });

            await RecruitmentDrive.updateOne({ _id: created.body.data._id }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
            expect((await api(dev).post(`/api/recruitment/${created.body.data._id}/positions/${vp._id}/application`, { answers: [] })).status).toBe(201);
            const application = await RecruitmentApplication.findOneAndUpdate(
                { drive: created.body.data._id, applicant: dev._id },
                { $set: { status: "OFFERED", offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + 86400000) } },
                { returnDocument: "after" }
            );
            // Meanwhile the president appointed someone else.
            await addMembership(chess, itStudent, "VICE_PRESIDENT");
            const refused = await api(dev).post(`/api/recruitment/${created.body.data._id}/applications/${application._id}/accept`);
            expect(refused.status).toBe(409);
            expect(refused.body.message).toMatch(/vice-president seat has already been filled/);
            expect(await ClubMembership.exists({ club: chess._id, user: dev._id })).toBeNull();
        });

        test("declining an offer tells the president", async () => {
            const drive = await RecruitmentDrive.findOne({ title: "Vice-president election" });
            const application = await RecruitmentApplication.findOne({ drive: drive._id, applicant: dev._id });
            expect((await api(dev).post(`/api/recruitment/${drive._id}/applications/${application._id}/decline`)).status).toBe(200);
            expect((await RecruitmentApplication.findById(application._id)).status).toBe("DECLINED");
            expect(await Notification.exists({ title: "Offer declined: Vice-president" })).toBeTruthy();
        });

        test("cancelling a live drive closes every open application and tells the applicants", async () => {
            const created = await api(president).post(
                `/api/clubs/${club._id}/recruitment`,
                drivePayload({ title: "Spring intake", positions: [{ role: "TREASURER", form: { pages: [] } }] })
            );
            expect(created.status).toBe(201);
            const id = created.body.data._id;
            await RecruitmentDrive.updateOne({ _id: id }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
            expect((await api(chirag).post(`/api/recruitment/${id}/positions/${created.body.data.positions[0]._id}/application`, { answers: [] })).status).toBe(201);

            outbox.length = 0;
            const cancelled = await api(president).post(`/api/recruitment/${id}/cancel`, { reason: "Exams moved earlier" });
            expect(cancelled.body.data.status).toBe("CANCELLED");
            await flushEmails();
            expect(mailsTo(chirag.email).find((mail) => mail.subject === "Coding Club recruitment cancelled").text).toMatch(/Exams moved earlier/);
        });
    });
});
