const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api, outbox, flushEmails, mailsTo } = require("../helpers/factory");
const Event = require("../../models/Event");
const EventRegistration = require("../../models/EventRegistration");
const Notification = require("../../models/Notification");
const AuditLog = require("../../models/AuditLog");
const { createTicketToken } = require("../../utils/TicketToken");

beforeAll(db.connect);
afterAll(db.disconnect);

const CODE = /^CC-[A-HJ-NP-TV-Z2-9]{8}$/;

describe("tickets and check-in", () => {
    let venues, club, mentor, president, coordinator, marketer, treasurer, member;
    let asha, bina, chirag, dev;

    const publishEvent = async (overrides = {}) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides));
        expect(draft.status).toBe(201);
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    const register = (student, id, body) => api(student).post(`/api/events/${id}/register`, body);
    const registrationOf = (student, id) => EventRegistration.findOne({ event: id, user: student._id });
    const tokenOf = async (student, id) => {
        const registration = await registrationOf(student, id);
        return createTicketToken({ registrationId: registration._id, ticketCode: registration.ticketCode });
    };
    const scan = (actor, id, body) => api(actor).post(`/api/events/${id}/check-in/scan`, body);

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, coordinator, marketer, treasurer, member] = await Promise.all([
            makeFaculty(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Coordinator" }),
            makeStudent({ name: "Marketer" }),
            makeStudent({ name: "Treasurer" }),
            makeStudent({ name: "Plain Member" })
        ]);
        [asha, bina, chirag, dev] = await Promise.all(["Asha Patel", "Bina Shah", "Chirag Rao", "Dev Nair"].map((name) => makeStudent({ name })));
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, marketer, "MARKETING_COORDINATOR");
        await addMembership(club, treasurer, "TREASURER");
        await addMembership(club, member, "MEMBER");
    });

    describe("issuing tickets", () => {
        let eventId;

        beforeAll(async () => {
            eventId = await publishEvent({ title: "Hack Night", maxParticipants: 2, eventDate: futureDate(10) });
            outbox.length = 0;
        });

        test("registering issues a ticket and emails it with the QR image and code", async () => {
            expect((await register(asha, eventId)).status).toBe(201);
            const registration = await registrationOf(asha, eventId);
            expect(registration.ticketCode).toMatch(CODE);
            expect(registration.ticketIssuedAt).toBeInstanceOf(Date);
            expect(registration.checkedInAt).toBeNull();

            await flushEmails();
            const mail = mailsTo(asha.email).find((item) => item.subject === "Your ticket for Hack Night");
            expect(mail).toBeTruthy();
            expect(mail.text).toContain(`Ticket code: ${registration.ticketCode}`);
            const token = await tokenOf(asha, eventId);
            expect(mail.html).toContain(`/api/tickets/${token}/qr.png`);
            expect(mail.html).toContain(`Open your ticket`);
            expect(mail.text).toContain(`/events/${eventId}?ticket=1`);
            // The plain confirmation is no longer sent as a second email.
            expect(mailsTo(asha.email).filter((item) => /registered for Hack Night/.test(item.subject))).toHaveLength(0);
            expect(await Notification.exists({ user: asha._id, type: "REGISTRATION_CONFIRMED" })).toBeTruthy();
        });

        test("the student can open their ticket in the app; others and the waitlisted cannot", async () => {
            const ticket = await api(asha).get(`/api/events/${eventId}/ticket`);
            expect(ticket.status).toBe(200);
            const registration = await registrationOf(asha, eventId);
            expect(ticket.body.data).toMatchObject({
                ticketCode: registration.ticketCode,
                token: await tokenOf(asha, eventId),
                holder: { name: "Asha Patel" },
                event: { title: "Hack Night", venue: { name: "Auditorium" }, club: { name: "Coding Club" } },
                checkedInAt: null
            });
            expect(ticket.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);

            expect((await api(bina).get(`/api/events/${eventId}/ticket`)).status).toBe(404);
        });

        test("the QR image link works without signing in and rejects tampered tokens", async () => {
            const token = await tokenOf(asha, eventId);
            const image = await request(app).get(`/api/tickets/${token}/qr.png`);
            expect(image.status).toBe(200);
            expect(image.headers["content-type"]).toMatch(/image\/png/);
            expect(image.headers["cache-control"]).toMatch(/max-age/);
            expect(image.body.slice(1, 4).toString()).toBe("PNG");

            const [id, code, signature] = token.split(".");
            expect((await request(app).get(`/api/tickets/${id}.${code}.${signature.slice(0, 31)}Z/qr.png`)).status).toBe(404);
            expect((await request(app).get("/api/tickets/nonsense/qr.png")).status).toBe(400);
        });

        test("a waitlisted student has no ticket until a seat opens up", async () => {
            await register(bina, eventId);
            expect((await register(chirag, eventId)).body.data.waitlisted).toBe(true);
            expect((await registrationOf(chirag, eventId)).ticketCode).toBeUndefined();
            expect((await api(chirag).get(`/api/events/${eventId}/ticket`)).status).toBe(404);

            outbox.length = 0;
            await api(bina).delete(`/api/events/${eventId}/register`);
            const promoted = await registrationOf(chirag, eventId);
            expect(promoted.status).toBe("REGISTERED");
            expect(promoted.ticketCode).toMatch(CODE);

            await flushEmails();
            const mail = mailsTo(chirag.email).find((item) => item.subject === "You're in! A spot opened up for Hack Night");
            expect(mail).toBeTruthy();
            expect(mail.text).toMatch(/moved off the waitlist and are now registered/);
            expect(mail.text).toContain(`Ticket code: ${promoted.ticketCode}`);
        });

        test("cancelling invalidates the ticket; registering again issues a new one", async () => {
            const oldToken = await tokenOf(asha, eventId);
            const oldCode = (await registrationOf(asha, eventId)).ticketCode;
            await api(asha).delete(`/api/events/${eventId}/register`);
            expect((await api(asha).get(`/api/events/${eventId}/ticket`)).status).toBe(404);
            expect(await Notification.exists({ user: asha._id, title: "You cancelled your registration for Hack Night" })).toBeTruthy();

            expect((await register(asha, eventId)).body.data.waitlisted).toBe(false);
            const fresh = await registrationOf(asha, eventId);
            expect(fresh.ticketCode).toMatch(CODE);
            expect(fresh.ticketCode).not.toBe(oldCode);
            expect(await tokenOf(asha, eventId)).not.toBe(oldToken);
        });

        test("registrations from before tickets existed get a code when the ticket is first opened", async () => {
            await EventRegistration.updateOne({ event: eventId, user: asha._id }, { $unset: { ticketCode: 1, ticketIssuedAt: 1 } });
            const ticket = await api(asha).get(`/api/events/${eventId}/ticket`);
            expect(ticket.status).toBe(200);
            expect(ticket.body.data.ticketCode).toMatch(CODE);
            expect(await AuditLog.exists({ action: "TICKET_ISSUED", targetId: (await registrationOf(asha, eventId))._id })).toBeTruthy();
        });
    });

    describe("check-in at the door", () => {
        let eventId, otherEventId;

        beforeAll(async () => {
            eventId = await publishEvent({ title: "Web Dev Bootcamp", maxParticipants: 50, eventDate: futureDate(12), venue: String(venues.hall._id) });
            otherEventId = await publishEvent({ title: "Other Talk", maxParticipants: 50, eventDate: futureDate(14) });
            for (const student of [asha, bina, chirag]) {
                await register(student, eventId);
            }
            await register(dev, otherEventId);
        });

        test("only the president opens check-in, and nobody can scan before it opens", async () => {
            const early = await scan(coordinator, eventId, { token: await tokenOf(asha, eventId) });
            expect(early.status).toBe(409);
            expect(early.body.message).toMatch(/Check-in is not open/);

            expect((await api(coordinator).post(`/api/events/${eventId}/check-in/open`)).status).toBe(403);
            expect((await api(mentor).post(`/api/events/${eventId}/check-in/open`)).status).toBe(403);

            const opened = await api(president).post(`/api/events/${eventId}/check-in/open`);
            expect(opened.status).toBe(200);
            expect(opened.body.data.checkIn).toMatchObject({ status: "OPEN" });
            expect(opened.body.data.viewer).toMatchObject({ canManageCheckIn: true, canMarkAttendance: true });
            expect((await api(president).post(`/api/events/${eventId}/check-in/open`)).status).toBe(409);

            for (const officer of [coordinator, marketer, treasurer]) {
                expect(await Notification.exists({ user: officer._id, type: "CHECK_IN_OPEN", link: `/events/${eventId}/check-in` })).toBeTruthy();
            }
            expect(await Notification.exists({ user: member._id, type: "CHECK_IN_OPEN" })).toBeNull();
        });

        test("officers scan a QR to check a student in; plain members, mentors and outsiders cannot", async () => {
            const token = await tokenOf(asha, eventId);
            for (const outsider of [member, mentor, dev]) {
                expect((await scan(outsider, eventId, { token })).status).toBe(403);
            }

            const res = await scan(coordinator, eventId, { token });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ result: "CHECKED_IN", message: "Asha Patel checked in", counts: { attended: 1, registered: 3 } });
            expect(res.body.data.attendee).toMatchObject({ name: "Asha Patel", checkInMethod: "QR", checkedInBy: "Coordinator" });
            expect(await Notification.exists({ user: asha._id, type: "ATTENDANCE_MARKED", title: "You're checked in to Web Dev Bootcamp" })).toBeTruthy();
            expect(await AuditLog.exists({ action: "ATTENDANCE_MARKED", actor: coordinator._id })).toBeTruthy();

            const again = await scan(marketer, eventId, { token });
            expect(again.body.data.result).toBe("ALREADY_CHECKED_IN");
            expect(again.body.data.message).toMatch(/^Already checked in at \d\d:\d\d by Coordinator$/);
            expect(again.body.data.counts.attended).toBe(1);
        });

        test("the student's ticket and the participant list show the check-in", async () => {
            const ticket = await api(asha).get(`/api/events/${eventId}/ticket`);
            expect(ticket.body.data.checkedInAt).toBeTruthy();
            expect(ticket.body.data.checkInMethod).toBe("QR");
            const detail = await api(asha).get(`/api/events/${eventId}`);
            expect(detail.body.data.viewer.registration).toMatchObject({ checkedInAt: expect.any(String), ticketCode: expect.stringMatching(CODE) });

            const list = await api(coordinator).get(`/api/events/${eventId}/registrations`);
            const row = list.body.data.find((item) => item.user.name === "Asha Patel");
            expect(row.checkInMethod).toBe("QR");
            expect(row.checkedInBy.name).toBe("Coordinator");
            expect(list.body.meta.event).toMatchObject({ attendedCount: 1, checkIn: { status: "OPEN" } });

            const mine = await api(asha).get("/api/registrations/me");
            expect(mine.body.data[0]).toMatchObject({ ticketCode: expect.stringMatching(CODE), checkedInAt: expect.any(String) });
        });

        test("bad scans are reported, not thrown: other event, cancelled, replaced and forged tickets", async () => {
            const wrong = await scan(coordinator, eventId, { token: await tokenOf(dev, otherEventId) });
            expect(wrong.body.data).toMatchObject({ result: "WRONG_EVENT", message: 'This ticket is for "Other Talk"' });

            const staleToken = await tokenOf(bina, eventId);
            await api(bina).delete(`/api/events/${eventId}/register`);
            const cancelled = await scan(coordinator, eventId, { token: staleToken });
            expect(cancelled.body.data).toMatchObject({ result: "NOT_REGISTERED", message: "Registration was cancelled — ticket no longer valid" });

            await register(bina, eventId);
            const replaced = await scan(coordinator, eventId, { token: staleToken });
            expect(replaced.body.data.result).toBe("INVALID_TICKET");
            expect(replaced.body.data.message).toMatch(/replaced/);
            expect((await scan(coordinator, eventId, { token: await tokenOf(bina, eventId) })).body.data.result).toBe("CHECKED_IN");

            const [id, code, signature] = staleToken.split(".");
            const forged = await scan(coordinator, eventId, { token: `${id}.${code}.${signature.slice(0, 31)}Z` });
            expect(forged.body.data).toMatchObject({ result: "INVALID_TICKET", attendee: null });
        });

        test("officers can also find students by name or email and mark them present, or undo it", async () => {
            const found = await api(treasurer).get(`/api/events/${eventId}/check-in/participants?search=chir`);
            expect(found.status).toBe(200);
            expect(found.body.data.map((row) => [row.name, row.checkedInAt])).toEqual([["Chirag Rao", null]]);
            expect(found.body.data[0].ticketCode).toMatch(CODE);

            const marked = await api(marketer).post(`/api/events/${eventId}/check-in/attendance/${found.body.data[0].registrationId}`, { note: "ID checked" });
            expect(marked.body.data).toMatchObject({ result: "CHECKED_IN", attendee: { name: "Chirag Rao", checkInMethod: "MANUAL", checkedInBy: "Marketer" } });
            expect(marked.body.data.counts.attended).toBe(3);

            const undone = await api(marketer).delete(`/api/events/${eventId}/check-in/attendance/${found.body.data[0].registrationId}`);
            expect(undone.body.data).toMatchObject({ result: "UNMARKED", counts: { attended: 2 } });
            expect((await api(marketer).delete(`/api/events/${eventId}/check-in/attendance/${found.body.data[0].registrationId}`)).status).toBe(409);

            const all = await api(treasurer).get(`/api/events/${eventId}/check-in/participants`);
            expect(all.body.data.map((row) => row.name)).toEqual(["Asha Patel", "Bina Shah", "Chirag Rao"]);
        });

        test("a typed ticket code works too, however it is written", async () => {
            const { ticketCode } = await registrationOf(chirag, eventId);
            const typed = await scan(coordinator, eventId, { code: ` ${ticketCode.toLowerCase().replace("-", " ")} ` });
            expect(typed.body.data).toMatchObject({ result: "CHECKED_IN", attendee: { name: "Chirag Rao", checkInMethod: "MANUAL" } });
            expect((await scan(coordinator, eventId, { code: "CC-ZZZZZZZZ" })).body.data).toMatchObject({ result: "NOT_FOUND", message: "No ticket with code CC-ZZZZZZZZ" });
            expect((await scan(coordinator, eventId, { code: "nope" })).body.data.result).toBe("NOT_FOUND");
            expect((await scan(coordinator, eventId, {})).status).toBe(400);
        });

        test("the scanner page data lists counts and recent check-ins", async () => {
            const status = await api(marketer).get(`/api/events/${eventId}/check-in`);
            expect(status.status).toBe(200);
            expect(status.body.data).toMatchObject({ checkIn: { status: "OPEN" }, counts: { attended: 3, registered: 3 }, canManage: false });
            expect(status.body.data.recent.map((row) => row.name)).toEqual(["Chirag Rao", "Bina Shah", "Asha Patel"]);
            expect((await api(president).get(`/api/events/${eventId}/check-in`)).body.data.canManage).toBe(true);
            expect((await api(member).get(`/api/events/${eventId}/check-in`)).status).toBe(403);
        });

        test("closing stops scanning; the president can reopen; completing the event closes it for good", async () => {
            expect((await api(coordinator).post(`/api/events/${eventId}/check-in/close`)).status).toBe(403);
            const closed = await api(president).post(`/api/events/${eventId}/check-in/close`);
            expect(closed.body.data.checkIn).toMatchObject({ status: "CLOSED" });

            const late = await scan(coordinator, eventId, { token: await tokenOf(asha, eventId) });
            expect(late.status).toBe(409);
            expect((await api(marketer).delete(`/api/events/${eventId}/check-in/attendance/${(await registrationOf(asha, eventId))._id}`)).status).toBe(409);

            expect((await api(president).post(`/api/events/${eventId}/check-in/open`)).body.data.checkIn.status).toBe("OPEN");

            await Event.updateOne(
                { _id: eventId },
                { startAt: new Date(Date.now() - 3600000), endAt: new Date(Date.now() + 3600000), registrationEnd: new Date(Date.now() - 7200000), registrationStart: new Date(Date.now() - 86400000) }
            );
            const completed = await api(president).post(`/api/events/${eventId}/complete`);
            expect(completed.body.data.status).toBe("COMPLETED");
            expect(completed.body.data.checkIn.status).toBe("CLOSED");
            expect((await api(president).post(`/api/events/${eventId}/check-in/open`)).status).toBe(409);
        });

        test("the president's dashboard counts attendance per event", async () => {
            const dashboard = await api(president).get("/api/dashboard");
            const workspace = dashboard.body.data.student.clubWorkspaces.find((item) => String(item.club?._id || item.club) === String(club._id));
            expect(workspace).toBeTruthy();
            const row = workspace.insights.eventWise.find((item) => item.title === "Web Dev Bootcamp");
            expect(row).toMatchObject({ registered: 3, attended: 3 });
            expect(workspace.insights.attendanceRate).toBe(100);
        });
    });

    describe("team events", () => {
        test("every member of a registered team gets their own ticket and checks in individually", async () => {
            const eventId = await publishEvent({
                title: "Hack Relay",
                participationMode: "TEAM",
                minTeamSize: 2,
                maxTeamSize: 3,
                maxParticipants: 1,
                eventDate: futureDate(16),
                venue: String(venues.hall._id)
            });
            const [leader, mate, lateLeader, lateMate] = await Promise.all(["Lena Leader", "Manav Mate", "Late Leader", "Late Mate"].map((name) => makeStudent({ name })));

            outbox.length = 0;
            const created = await register(leader, eventId, { teamName: "Byte Busters", invitees: [String(mate._id)] });
            expect(created.status).toBe(201);
            await api(mate).post(`/api/events/${eventId}/teams/${created.body.data.team._id}/accept`);
            const leaderReg = await registrationOf(leader, eventId);
            const mateReg = await registrationOf(mate, eventId);
            expect(leaderReg.ticketCode).toMatch(CODE);
            expect(mateReg.ticketCode).toMatch(CODE);
            expect(mateReg.ticketCode).not.toBe(leaderReg.ticketCode);

            await flushEmails();
            expect(mailsTo(leader.email).some((mail) => mail.subject === 'Your ticket for Hack Relay · team "Byte Busters"')).toBe(true);
            expect(mailsTo(mate.email).some((mail) => mail.subject === 'Your ticket for Hack Relay · team "Byte Busters"')).toBe(true);

            // A waitlisted team has no tickets until it moves in; then everyone gets one.
            const late = await register(lateLeader, eventId, { teamName: "Null Pointers", invitees: [String(lateMate._id)] });
            expect(late.body.data.waitlisted).toBe(true);
            await api(lateMate).post(`/api/events/${eventId}/teams/${late.body.data.team._id}/accept`);
            expect((await registrationOf(lateMate, eventId)).ticketCode).toBeUndefined();
            await api(leader).delete(`/api/events/${eventId}/register`);
            expect((await registrationOf(lateLeader, eventId)).ticketCode).toMatch(CODE);
            expect((await registrationOf(lateMate, eventId)).ticketCode).toMatch(CODE);

            await api(president).post(`/api/events/${eventId}/check-in/open`);
            const first = await scan(coordinator, eventId, { token: await tokenOf(lateLeader, eventId) });
            expect(first.body.data).toMatchObject({ result: "CHECKED_IN", attendee: { team: "Null Pointers", teamRole: "LEADER" }, counts: { attended: 1, registered: 2 } });
            const second = await scan(coordinator, eventId, { token: await tokenOf(lateMate, eventId) });
            expect(second.body.data).toMatchObject({ result: "CHECKED_IN", attendee: { team: "Null Pointers", teamRole: "MEMBER" }, counts: { attended: 2 } });
        });
    });
});
