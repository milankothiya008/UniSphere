const db = require("../helpers/testDb");
const { seedReferenceData, makeStudent, makeFaculty, makeAdmin, makeActiveClub, addMembership, api } = require("../helpers/factory");

beforeAll(db.connect);
afterAll(db.disconnect);

describe("club profile: website, social links, contact and meetings", () => {
    let club, president, mentor, admin, member;

    beforeAll(async () => {
        await db.clear();
        await seedReferenceData();
        [president, mentor, admin, member] = await Promise.all([makeStudent(), makeFaculty(), makeAdmin(), makeStudent()]);
        club = await makeActiveClub({ name: "Robotics Club", mentor, president });
        await addMembership(club, member, "MEMBER");
    });

    const update = (user, body) => api(user).put(`/api/clubs/${club._id}`, body);

    test("the president saves a full public profile, and anyone can read it", async () => {
        const res = await update(president, {
            tagline: "Build robots, break things, learn fast",
            website: "roboticsclub.ddu.ac.in",
            contactPhone: "+91 98765 43210",
            meetingSchedule: "Every Friday, 4:00–5:30 PM",
            meetingLocation: "Lab 204, CE Block",
            coverImage: "/uploads/club-covers/robotics.jpg",
            socialLinks: {
                instagram: "https://www.instagram.com/ddu.robotics",
                linkedin: "linkedin.com/company/ddu-robotics",
                github: "https://github.com/ddu-robotics",
                whatsapp: "https://chat.whatsapp.com/AbCdEf123"
            }
        });
        expect(res.status).toBe(200);

        const publicView = await api(null).get(`/api/clubs/${club._id}`);
        expect(publicView.body.data).toMatchObject({
            tagline: "Build robots, break things, learn fast",
            website: "https://roboticsclub.ddu.ac.in/",
            contactPhone: "+91 98765 43210",
            meetingSchedule: "Every Friday, 4:00–5:30 PM",
            meetingLocation: "Lab 204, CE Block",
            coverImage: "/uploads/club-covers/robotics.jpg",
            socialLinks: {
                instagram: "https://www.instagram.com/ddu.robotics",
                linkedin: "https://linkedin.com/company/ddu-robotics",
                github: "https://github.com/ddu-robotics",
                whatsapp: "https://chat.whatsapp.com/AbCdEf123",
                x: null,
                youtube: null,
                facebook: null,
                discord: null
            }
        });
    });

    test("clearing a field removes it", async () => {
        const res = await update(president, { website: "", socialLinks: { instagram: "https://instagram.com/ddu.robotics" } });
        expect(res.body.data.website).toBeNull();
        expect(res.body.data.socialLinks.github).toBeNull();
        expect(res.body.data.socialLinks.instagram).toBe("https://instagram.com/ddu.robotics");
    });

    test("rejects unsafe or mismatched links with a clear message", async () => {
        const cases = [
            [{ website: "javascript:alert(1)" }, "Website must be a valid web address"],
            [{ website: "not a url" }, "Website must be a valid web address"],
            [{ website: "https://user:secret@example.com" }, "Website must not contain a username or password"],
            [{ socialLinks: { instagram: "https://evil.example.com/instagram.com" } }, "Instagram link must be on instagram.com"],
            [{ socialLinks: { youtube: "https://notyoutube.com/watch" } }, "YouTube link must be on youtube.com"],
            [{ socialLinks: { myspace: "https://myspace.com/club" } }, "Unsupported social link: myspace"],
            [{ contactPhone: "call me" }, "Enter a valid phone number, e.g. +91 98765 43210"]
        ];

        for (const [body, message] of cases) {
            const res = await update(president, body);
            expect(res.status).toBe(400);
            expect(res.body.message).toBe(message);
        }
    });

    test("only the club's leadership can edit the profile", async () => {
        for (const user of [member, mentor, admin]) {
            expect((await update(user, { tagline: "Hijacked" })).status).toBe(403);
        }
        expect((await api(null).get(`/api/clubs/${club._id}`)).body.data.tagline).toBe("Build robots, break things, learn fast");
    });

    test("enforces length limits", async () => {
        expect((await update(president, { tagline: "x".repeat(141) })).status).toBe(400);
        expect((await update(president, { meetingSchedule: "x".repeat(121) })).status).toBe(400);
    });
});
