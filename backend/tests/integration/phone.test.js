const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, addMembership, api } = require("../helpers/factory");
const User = require("../../models/User");
const ClubMembership = require("../../models/ClubMembership");
const RecruitmentApplication = require("../../models/RecruitmentApplication");
const RecruitmentDrive = require("../../models/RecruitmentDrive");
const { normalizePhone } = require("../../utils/Phone");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("club members' mobile numbers", () => {
    let admin, mentor, otherMentor, idleFaculty, president, member, otherPresident, outsider, noPhone, codingClub;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [admin, mentor, otherMentor, idleFaculty, president, member, otherPresident, outsider, noPhone] = await Promise.all([
            makeAdmin(),
            makeFaculty({ name: "Coding Mentor" }),
            makeFaculty({ name: "Drama Mentor" }),
            makeFaculty({ name: "Idle Faculty" }),
            makeStudent({ name: "Coding President" }),
            makeStudent({ name: "Coding Member" }),
            makeStudent({ name: "Drama President" }),
            makeStudent({ name: "Outsider" }),
            makeStudent({ name: "No Phone", phone: null })
        ]);
        codingClub = await makeActiveClub({ name: "Coding Club", mentor, president });
        await makeActiveClub({ name: "Drama Club", mentor: otherMentor, president: otherPresident });
        await addMembership(codingClub, member, "MEMBER");
    });

    test("numbers are normalised to +91 and ten digits", () => {
        expect(normalizePhone("98765 43210")).toBe("+919876543210");
        expect(normalizePhone("+91-98765-43210")).toBe("+919876543210");
        expect(normalizePhone("098765 43210")).toBe("+919876543210");
        expect(normalizePhone("12345 67890")).toBeNull();
        expect(normalizePhone("98765")).toBeNull();
    });

    test("a student sets their own number, and sees it on their account", async () => {
        const saved = await api(noPhone).put(`/api/users/${noPhone._id}`, { phone: "+91 91234 56789" });
        expect(saved.status).toBe(200);
        expect(saved.body.data.phone).toBe("+919123456789");
        expect((await api(noPhone).get("/api/auth/me")).body.data.phone).toBe("+919123456789");

        expect((await api(noPhone).put(`/api/users/${noPhone._id}`, { phone: "555-0100" })).status).toBe(400);
        expect((await api(outsider).put(`/api/users/${noPhone._id}`, { phone: "9876543210" })).status).toBe(403);

        // Not in a club yet, so the number can be removed again.
        expect((await api(noPhone).put(`/api/users/${noPhone._id}`, { phone: "" })).body.data.phone).toBeNull();
    });

    test("club members can change their number but not remove it", async () => {
        const res = await api(member).put(`/api/users/${member._id}`, { phone: "" });
        expect(res.status).toBe(400);
        expect(res.body.errorCode).toBe("PHONE_REQUIRED");
        expect((await User.findById(member._id)).phone).toBeTruthy();
    });

    test("members of any club, every club mentor and the admin see any club's members with numbers", async () => {
        const url = `/api/clubs/${codingClub._id}/members`;
        for (const viewer of [admin, mentor, otherMentor, president, member, otherPresident]) {
            const res = await api(viewer).get(url);
            expect(res.status).toBe(200);
            const row = res.body.data.find((item) => String(item.user._id) === String(member._id));
            expect(row.user.phone).toMatch(/^\+91\d{10}$/);
        }
        expect((await api(outsider).get(url)).status).toBe(403);
        expect((await api(idleFaculty).get(url)).status).toBe(403);
    });

    test("the club view says whether the viewer can open the member list", async () => {
        const flag = async (viewer) => (await api(viewer).get(`/api/clubs/${codingClub._id}`)).body.data.viewer.canSeeMembers;
        expect(await flag(otherPresident)).toBe(true);
        expect(await flag(otherMentor)).toBe(true);
        expect(await flag(admin)).toBe(true);
        expect(await flag(outsider)).toBe(false);
    });

    test("accepting an offer needs a mobile number, which can be given with the acceptance", async () => {
        const joiner = await makeStudent({ name: "Joiner", phone: null });
        const created = await api(president).post(`/api/clubs/${codingClub._id}/recruitment`, {
            title: "Vice-president election",
            description: "Pick a vice-president to help run the club this year.",
            positions: [{ role: "VICE_PRESIDENT", openings: 1, form: { pages: [] } }],
            applicationEnd: new Date(Date.now() + 7 * 86400000).toISOString()
        });
        expect(created.status).toBe(201);
        const driveId = created.body.data._id;
        const [seat] = created.body.data.positions;
        await RecruitmentDrive.updateOne({ _id: driveId }, { $set: { status: "PUBLISHED", publishedAt: new Date() } });
        expect((await api(joiner).post(`/api/recruitment/${driveId}/positions/${seat._id}/application`, { answers: [] })).status).toBe(201);
        const application = await RecruitmentApplication.findOneAndUpdate(
            { drive: driveId, applicant: joiner._id },
            { $set: { status: "OFFERED", offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + 86400000) } },
            { returnDocument: "after" }
        );
        const acceptUrl = `/api/recruitment/${driveId}/applications/${application._id}/accept`;

        const refused = await api(joiner).post(acceptUrl);
        expect(refused.status).toBe(400);
        expect(refused.body.errorCode).toBe("PHONE_REQUIRED");
        expect(await ClubMembership.exists({ club: codingClub._id, user: joiner._id })).toBeNull();

        expect((await api(joiner).post(acceptUrl, { phone: "12345" })).status).toBe(400);

        const accepted = await api(joiner).post(acceptUrl, { phone: "98989 89898" });
        expect(accepted.status).toBe(200);
        expect((await User.findById(joiner._id)).phone).toBe("+919898989898");
        expect(await ClubMembership.exists({ club: codingClub._id, user: joiner._id, status: "APPROVED" })).toBeTruthy();
    });
});
