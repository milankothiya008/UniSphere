const db = require("../helpers/testDb");
const { makeStudent, makeFaculty, makeActiveClub, addMembership, api } = require("../helpers/factory");
const ClubElection = require("../../models/ClubElection");
const ElectionBallot = require("../../models/ElectionBallot");
const Message = require("../../models/Message");
const Notification = require("../../models/Notification");
const Conversation = require("../../models/Conversation");
const ClubMembership = require("../../models/ClubMembership");
const { sweepElections } = require("../../services/ElectionService");

beforeAll(db.connect);
afterAll(db.disconnect);

const inMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

// Anonymous club elections: the organiser picks candidates, members vote once in secret, the result is advisory.
describe("club elections", () => {
    let club, mentor, president, vp, asha, bina, chirag, outsider;

    beforeAll(async () => {
        await db.clear();
        [president, vp, asha, bina, chirag, outsider] = await Promise.all(
            ["Prez", "Vee", "Asha", "Bina", "Chirag", "Out"].map((name) => makeStudent({ name }))
        );
        mentor = await makeFaculty({ name: "Dr Mentor" });
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, vp, "VICE_PRESIDENT");
        await Promise.all([asha, bina, chirag].map((student) => addMembership(club, student)));
    });

    const create = (user, body) => api(user).post("/api/elections", { club: String(club._id), ...body });

    test("only roles with Run elections can hold one; it's for real roles and needs 2+ member candidates", async () => {
        const base = { role: "VICE_PRESIDENT", candidates: [{ user: asha._id }, { user: bina._id }], closesAt: inMinutes(60) };
        expect((await create(asha, base)).status).toBe(403);
        expect((await create(vp, base)).status).toBe(403);
        expect((await create(president, { ...base, role: "MEMBER" })).status).toBe(400);
        expect((await create(president, { ...base, candidates: [{ user: asha._id }] })).status).toBe(400);
        expect((await create(president, { ...base, candidates: [{ user: asha._id }, { user: outsider._id }] })).body.message).toMatch(/member/);
        expect((await create(president, { ...base, closesAt: inMinutes(3) })).status).toBe(400);

        // The president can let the vice-president run elections too.
        const roles = (await api(president).get(`/api/clubs/${club._id}/roles`)).body.data.roles;
        const vpRole = roles.find((role) => role.key === "VICE_PRESIDENT");
        const granted = await api(president).put(`/api/clubs/${club._id}/roles/VICE_PRESIDENT`, {
            name: vpRole.name,
            permissions: [...vpRole.permissions, "RUN_ELECTIONS"]
        });
        expect(granted.status).toBe(200);
    });

    test("members vote once, in secret; counts stay hidden until voting closes", async () => {
        const res = await create(vp, {
            role: "VICE_PRESIDENT",
            title: "Next vice-president",
            candidates: [{ user: asha._id, statement: "Ran the tech fest" }, { user: bina._id }],
            closesAt: inMinutes(60)
        });
        expect(res.status).toBe(201);
        const election = res.body.data;
        expect(election.status).toBe("OPEN");
        expect(election.eligibleCount).toBe(5);
        expect(election.candidates.map((candidate) => candidate.votes)).toEqual([null, null]);

        // A second election for the same role can't run at the same time.
        expect(
            (await create(president, { role: "VICE_PRESIDENT", candidates: [{ user: asha._id }, { user: chirag._id }], closesAt: inMinutes(60) })).status
        ).toBe(409);

        // The card is in the club group, and only the club's voters were notified.
        const conversation = await Conversation.findOne({ club: club._id });
        expect(await Message.exists({ conversation: conversation._id, type: "POLL", poll: election._id })).toBeTruthy();
        expect(await Notification.exists({ user: chirag._id, type: "ELECTION" })).toBeTruthy();
        expect(await Notification.exists({ user: outsider._id, type: "ELECTION" })).toBeNull();
        expect(await Notification.exists({ user: mentor._id, type: "ELECTION" })).toBeNull();

        // Outsiders can't see it; the mentor can follow along but not vote.
        expect((await api(outsider).get(`/api/elections/${election._id}`)).status).toBe(404);
        const mentorView = (await api(mentor).get(`/api/elections/${election._id}`)).body.data;
        expect(mentorView.viewer).toMatchObject({ eligible: false, canVote: false });
        expect((await api(mentor).post(`/api/elections/${election._id}/vote`, { candidate: asha._id })).status).toBe(403);

        // Someone who joined after voting opened isn't on the voter roll.
        const late = await makeStudent({ name: "Late" });
        await addMembership(club, late);
        expect((await api(late).post(`/api/elections/${election._id}/vote`, { candidate: asha._id })).status).toBe(403);

        expect((await api(chirag).post(`/api/elections/${election._id}/vote`, { candidate: outsider._id })).status).toBe(400);
        const voted = await api(chirag).post(`/api/elections/${election._id}/vote`, { candidate: asha._id });
        expect(voted.status).toBe(200);
        expect(voted.body.data.viewer).toMatchObject({ hasVoted: true, canVote: false });
        expect(voted.body.data.votesCast).toBe(1);
        expect(voted.body.data.candidates.every((candidate) => candidate.votes === null)).toBe(true);
        expect((await api(chirag).post(`/api/elections/${election._id}/vote`, { candidate: bina._id })).status).toBe(409);

        await api(asha).post(`/api/elections/${election._id}/vote`, { candidate: asha._id });
        await api(bina).post(`/api/elections/${election._id}/vote`, { candidate: asha._id });
        await api(president).post(`/api/elections/${election._id}/vote`, { candidate: bina._id });

        // Only *that* someone voted is stored — never their choice.
        const ballots = await ElectionBallot.find({ election: election._id }).lean();
        expect(ballots).toHaveLength(4);
        ballots.forEach((ballot) => expect(Object.keys(ballot).sort()).toEqual(["_id", "election", "voter"]));

        // Members can't end it; the organiser can close early, and then the counts are shown.
        expect((await api(asha).post(`/api/elections/${election._id}/close`)).status).toBe(403);
        const closed = await api(vp).post(`/api/elections/${election._id}/close`);
        expect(closed.status).toBe(200);
        expect(closed.body.data.status).toBe("CLOSED");
        expect(closed.body.data.candidates.map((candidate) => [candidate.user.name, candidate.votes, candidate.leading])).toEqual([
            ["Asha", 3, true],
            ["Bina", 1, false]
        ]);
        expect(closed.body.data.result).toMatchObject({ tie: false, winners: [String(asha._id)] });
        expect((await api(chirag).post(`/api/elections/${election._id}/vote`, { candidate: bina._id })).status).toBe(409);

        // The result is announced to the club and its mentor; the role itself is still the president's call.
        expect(await Notification.exists({ user: mentor._id, type: "ELECTION", title: /Results/ })).toBeTruthy();
        expect(await Message.exists({ conversation: conversation._id, type: "SYSTEM", "system.action": "ELECTION_CLOSED" })).toBeTruthy();
        expect((await ClubMembership.findOne({ club: club._id, user: asha._id })).role).toBe("MEMBER");
    });

    test("a scheduled election can be edited until it opens; the sweeper opens and closes it; a tie can go to a runoff", async () => {
        const res = await create(president, {
            role: "TREASURER",
            candidates: [{ user: asha._id }, { user: bina._id }],
            opensAt: inMinutes(30),
            closesAt: inMinutes(120)
        });
        expect(res.body.data.status).toBe("SCHEDULED");
        const id = res.body.data._id;
        expect((await api(asha).post(`/api/elections/${id}/vote`, { candidate: bina._id })).status).toBe(409);

        const edited = await api(president).patch(`/api/elections/${id}`, { candidates: [{ user: asha._id }, { user: chirag._id }] });
        expect(edited.body.data.candidates.map((candidate) => candidate.user.name)).toEqual(["Asha", "Chirag"]);

        await ClubElection.updateOne({ _id: id }, { $set: { opensAt: new Date() } });
        await sweepElections();
        expect((await ClubElection.findById(id)).status).toBe("OPEN");
        expect((await api(president).patch(`/api/elections/${id}`, { title: "Too late" })).status).toBe(409);

        expect((await api(asha).post(`/api/elections/${id}/vote`, { candidate: asha._id })).status).toBe(200);
        expect((await api(bina).post(`/api/elections/${id}/vote`, { candidate: chirag._id })).status).toBe(200);
        await ClubElection.updateOne({ _id: id }, { $set: { closesAt: new Date(Date.now() - 1000) } });
        await sweepElections();

        const tied = (await api(asha).get(`/api/elections/${id}`)).body.data;
        expect(tied.status).toBe("CLOSED");
        expect(tied.result.tie).toBe(true);
        expect(tied.viewer.canRunoff).toBe(false);
        expect((await api(president).get(`/api/elections/${id}`)).body.data.viewer.canRunoff).toBe(true);

        const runoff = await api(president).post(`/api/elections/${id}/runoff`, { closesAt: inMinutes(60) });
        expect(runoff.status).toBe(201);
        expect(runoff.body.data.runoffOf).toBe(id);
        expect(runoff.body.data.candidates.map((candidate) => candidate.user.name).sort()).toEqual(["Asha", "Chirag"]);

        // Cancelling tells the voters; the list shows everything the club has held.
        const cancelled = await api(president).post(`/api/elections/${runoff.body.data._id}/cancel`, { reason: "Decided at the meeting" });
        expect(cancelled.body.data.status).toBe("CANCELLED");
        expect(await Notification.exists({ user: chirag._id, title: /Cancelled/ })).toBeTruthy();
        const list = (await api(chirag).get(`/api/elections?club=${club._id}`)).body.data;
        expect(list.items.map((item) => item.status)).toEqual(["CANCELLED", "CLOSED", "CLOSED"]);
        expect(list.canManage).toBe(false);
        expect((await api(outsider).get(`/api/elections?club=${club._id}`)).status).toBe(404);
    });
});
