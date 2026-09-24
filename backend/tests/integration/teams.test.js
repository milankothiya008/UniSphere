const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const Team = require("../../models/Team");
const EventRegistration = require("../../models/EventRegistration");
const Notification = require("../../models/Notification");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("team registration", () => {
    let venues, club, mentor, president, coordinator;
    let asha, bina, chirag, dev, esha, farah, gita, hari, itStudent;
    let eventId;

    const publishTeamEvent = async (overrides = {}) => {
        const draft = await api(president).post(
            "/api/events",
            eventPayload(club, venues.hall, {
                title: "Hack Relay",
                participationMode: "TEAM",
                minTeamSize: 2,
                maxTeamSize: 3,
                maxParticipants: 2,
                eligibility: { departments: ["CE"], batches: [] },
                eventDate: futureDate(10),
                ...overrides
            })
        );
        expect(draft.status).toBe(201);
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    const register = (user, body) => api(user).post(`/api/events/${eventId}/register`, body);
    const statusOf = async (user) => (await EventRegistration.findOne({ event: eventId, user: user._id }))?.status;
    const teamOf = (name) => Team.findOne({ event: eventId, nameKey: name.toLowerCase(), status: "ACTIVE" });

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, coordinator] = await Promise.all([makeFaculty(), makeStudent({ name: "President" }), makeStudent({ name: "Coordinator" })]);
        [asha, bina, chirag, dev, esha, farah, gita, hari] = await Promise.all(
            ["Asha", "Bina", "Chirag", "Dev", "Esha", "Farah", "Gita", "Hari"].map((name) => makeStudent({ name: `${name} Student` }))
        );
        itStudent = await makeStudent({ name: "Ira Other", department: "IT" });
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        eventId = await publishTeamEvent();
    });

    test("team settings are validated and the limit counts full teams against the venue", async () => {
        const bad = await api(president).post("/api/events", eventPayload(club, venues.hall, { participationMode: "TEAM", minTeamSize: 4, maxTeamSize: 3, eventDate: futureDate(11) }));
        expect(bad.status).toBe(400);
        const tooBig = await api(president).post("/api/events", eventPayload(club, venues.hall, { participationMode: "TEAM", minTeamSize: 2, maxTeamSize: 4, maxParticipants: 20, eventDate: futureDate(11) }));
        expect(tooBig.status).toBe(400);
        expect(tooBig.body.message).toBe("20 teams of up to 4 would exceed Seminar Hall A's capacity of 60");

        const event = await Event.findById(eventId);
        expect(event).toMatchObject({ participationMode: "TEAM", minTeamSize: 2, maxTeamSize: 3, maxParticipants: 2 });
    });

    test("a team event needs a team name", async () => {
        const res = await register(asha, {});
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Team name must be 2-60 characters");
        expect(await statusOf(asha)).toBeUndefined();
    });

    test("invitees must be eligible students with room on the team", async () => {
        expect((await register(asha, { teamName: "Byte Busters", invitees: [String(itStudent._id)] })).status).toBe(403);
        expect((await register(asha, { teamName: "Byte Busters", invitees: [String(asha._id)] })).status).toBe(400);
        const crowd = await register(asha, { teamName: "Byte Busters", invitees: [bina, chirag, dev].map((user) => String(user._id)) });
        expect(crowd.status).toBe(400);
        expect(crowd.body.message).toBe("Your team has room for 2 more invites (teams have up to 3 members)");
        // Nothing was registered by the failed attempts.
        expect(await statusOf(asha)).toBeUndefined();
        expect(await Team.countDocuments({ event: eventId })).toBe(0);
    });

    test("the leader registers the team, which takes one place, and invites teammates", async () => {
        const res = await register(asha, { teamName: "Byte Busters", invitees: [String(bina._id), String(chirag._id)] });
        expect(res.status).toBe(201);
        expect(res.body.message).toBe('Team "Byte Busters" is registered. Invites sent to 2 teammates.');
        expect(res.body.data.team).toMatchObject({ name: "Byte Busters", size: 1, minSize: 2, maxSize: 3, complete: false, registrationStatus: "REGISTERED" });
        expect(res.body.data.team.invites.map((invite) => invite.user.name).sort()).toEqual(["Bina Student", "Chirag Student"]);
        expect((await Event.findById(eventId)).registeredCount).toBe(1);

        const invite = await Notification.findOne({ user: bina._id, type: "TEAM_INVITE" });
        expect(invite.title).toBe('Asha Student invited you to join "Byte Busters" for Hack Relay');

        const binaView = await api(bina).get(`/api/events/${eventId}`);
        expect(binaView.body.data.viewer.invites).toHaveLength(1);
        expect(binaView.body.data.viewer.invites[0].team).toMatchObject({ name: "Byte Busters", leader: { name: "Asha Student" } });

        const inbox = await api(bina).get("/api/registrations/invites");
        expect(inbox.body.data.map((row) => [row.team.name, row.event.title])).toEqual([["Byte Busters", "Hack Relay"]]);
    });

    test("team names are unique within the event, and a failed registration leaves nothing behind", async () => {
        const clash = await register(dev, { teamName: "byte  BUSTERS" });
        expect(clash.status).toBe(409);
        expect(clash.body.message).toMatch(/already registered for this event — pick another name/);
        expect(await statusOf(dev)).toBeUndefined();
        expect((await Event.findById(eventId)).registeredCount).toBe(1);
    });

    test("the leader can search eligible students to invite", async () => {
        const found = await api(asha).get(`/api/events/${eventId}/team/candidates?search=Student`);
        const names = found.body.data.map((user) => user.name);
        expect(names).toContain("Dev Student");
        expect(names).not.toContain("Asha Student");
        expect(names).not.toContain("Ira Other");
        expect(found.body.data.find((user) => user.name === "Dev Student").available).toBe(true);
    });

    test("invitees accept (registering with the team) or decline; the leader hears about both", async () => {
        const team = await teamOf("Byte Busters");
        const accepted = await api(bina).post(`/api/events/${eventId}/teams/${team._id}/accept`);
        expect(accepted.status).toBe(200);
        expect(accepted.body.message).toBe("You joined the team and are registered");
        expect(accepted.body.data.team).toMatchObject({ size: 2, complete: true });
        expect(await statusOf(bina)).toBe("REGISTERED");
        expect((await Event.findById(eventId)).registeredCount).toBe(1);
        expect(await Notification.exists({ user: asha._id, type: "TEAM_UPDATE", title: 'Bina Student joined "Byte Busters"' })).toBeTruthy();

        const declined = await api(chirag).post(`/api/events/${eventId}/teams/${team._id}/decline`);
        expect(declined.status).toBe(200);
        expect(await statusOf(chirag)).toBeUndefined();
        expect(await Notification.exists({ user: asha._id, title: 'Chirag Student declined your invite to "Byte Busters"' })).toBeTruthy();

        // Answered invites can't be used again, and a teammate can't also register separately.
        expect((await api(chirag).post(`/api/events/${eventId}/teams/${team._id}/accept`)).status).toBe(404);
        expect((await register(bina, { teamName: "Another" })).status).toBe(409);
    });

    test("only the leader manages the team; the team never goes over its size", async () => {
        const team = await teamOf("Byte Busters");
        expect((await api(bina).post(`/api/events/${eventId}/team/invites`, { users: [String(dev._id)] })).status).toBe(403);

        const invited = await api(asha).post(`/api/events/${eventId}/team/invites`, { users: [String(dev._id)] });
        expect(invited.status).toBe(200);
        expect(invited.body.data.invites.map((row) => row.user.name)).toEqual(["Dev Student"]);
        // 2 members + 1 pending invite = the maximum of 3.
        expect((await api(asha).post(`/api/events/${eventId}/team/invites`, { users: [String(esha._id)] })).status).toBe(400);

        expect((await api(dev).post(`/api/events/${eventId}/teams/${team._id}/accept`)).status).toBe(200);
        const view = await api(asha).get(`/api/events/${eventId}`);
        expect(view.body.data.viewer).toMatchObject({ teamRole: "LEADER", team: { size: 3, complete: true } });
        expect(view.body.data.viewer.team.members.map((member) => member.status)).toEqual(["LEADER", "ACCEPTED", "ACCEPTED"]);
    });

    test("organisers see the entries grouped by team", async () => {
        const res = await api(coordinator).get(`/api/events/${eventId}/registrations`);
        expect(res.body.meta.event).toMatchObject({ participationMode: "TEAM", minTeamSize: 2, maxTeamSize: 3, registeredCount: 1 });
        expect(res.body.meta.teams.map((team) => [team.name, team.size, team.complete])).toEqual([["Byte Busters", 3, true]]);
        expect(res.body.data.map((row) => [row.user.name, row.team.name, row.teamRole])).toEqual([
            ["Asha Student", "Byte Busters", "LEADER"],
            ["Bina Student", "Byte Busters", "MEMBER"],
            ["Dev Student", "Byte Busters", "MEMBER"]
        ]);

        const mine = await api(bina).get("/api/registrations/me");
        expect(mine.body.data[0]).toMatchObject({ teamRole: "MEMBER", team: { name: "Byte Busters" }, event: { participationMode: "TEAM" } });
    });

    test("a member can leave without affecting the team's place", async () => {
        const res = await api(dev).delete(`/api/events/${eventId}/register`);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("You left the team");
        expect(await statusOf(dev)).toBe("CANCELLED");
        expect((await teamOf("Byte Busters")).size).toBe(2);
        expect((await Event.findById(eventId)).registeredCount).toBe(1);
        expect(await Notification.exists({ user: asha._id, title: 'Dev Student left "Byte Busters"' })).toBeTruthy();
    });

    test("when the event is full, whole teams wait in line and move in together", async () => {
        const second = await register(esha, { teamName: "Null Pointers" });
        expect(second.body.data.waitlisted).toBe(false);
        expect((await Event.findById(eventId)).registeredCount).toBe(2);

        const third = await register(farah, { teamName: "Late Night", invitees: [String(gita._id)] });
        expect(third.status).toBe(201);
        expect(third.body.message).toBe("This event is full. Your team is #1 on the waitlist. Invites sent to 1 teammate.");
        const lateTeam = await teamOf("Late Night");
        const joined = await api(gita).post(`/api/events/${eventId}/teams/${lateTeam._id}/accept`);
        expect(joined.body.message).toBe("You joined the team. The team is on the waitlist.");
        expect(await statusOf(gita)).toBe("WAITLISTED");
        expect((await Event.findById(eventId)).waitlistCount).toBe(1);
        const gitaView = await api(gita).get(`/api/events/${eventId}`);
        expect(gitaView.body.data.viewer.registration.waitlistPosition).toBe(1);

        // The first team's leader cancels: the team is disbanded and the waiting team moves in together.
        const cancelled = await api(asha).delete(`/api/events/${eventId}/register`);
        expect(cancelled.body.message).toBe("Your team's registration was cancelled");
        expect(await statusOf(bina)).toBe("CANCELLED");
        expect(await Notification.exists({ user: bina._id, title: '"Byte Busters" is no longer registered for Hack Relay' })).toBeTruthy();
        expect(await statusOf(farah)).toBe("REGISTERED");
        expect(await statusOf(gita)).toBe("REGISTERED");
        expect(await Notification.exists({ user: gita._id, title: "You're in! A spot opened up for Hack Relay" })).toBeTruthy();
        expect(await Event.findById(eventId)).toMatchObject({ registeredCount: 2, waitlistCount: 0 });
    });

    test("organisers can remove a member (the team keeps its place) or a whole team", async () => {
        const lateTeam = await teamOf("Late Night");
        const gitaRegistration = await EventRegistration.findOne({ event: eventId, user: gita._id });
        expect((await api(coordinator).delete(`/api/events/${eventId}/registrations/${gitaRegistration._id}`, { reason: "Duplicate entry" })).status).toBe(200);
        expect(await statusOf(gita)).toBe("CANCELLED");
        expect((await Team.findById(lateTeam._id)).size).toBe(1);
        expect((await Event.findById(eventId)).registeredCount).toBe(2);

        await api(esha).post(`/api/events/${eventId}/team/invites`, { users: [String(hari._id)] });
        const nullPointers = await teamOf("Null Pointers");
        await api(hari).post(`/api/events/${eventId}/teams/${nullPointers._id}/accept`);
        const leaderRegistration = await EventRegistration.findOne({ event: eventId, user: esha._id });
        expect((await api(coordinator).delete(`/api/events/${eventId}/registrations/${leaderRegistration._id}`, { reason: "Rules broken" })).status).toBe(200);
        expect(await statusOf(hari)).toBe("CANCELLED");
        expect((await Team.findById(nullPointers._id)).status).toBe("DISBANDED");
        expect((await Event.findById(eventId)).registeredCount).toBe(1);
    });

    test("teams can't change after registration closes", async () => {
        await Event.updateOne({ _id: eventId }, { registrationEnd: new Date(Date.now() - 1000), registrationStart: new Date(Date.now() - 86400000) });
        const res = await api(farah).post(`/api/events/${eventId}/team/invites`, { users: [String(chirag._id)] });
        expect(res.status).toBe(409);
        expect(res.body.message).toBe("Registration has closed, so teams can no longer change");
    });
});
