const request = require("supertest");
const app = require("../../server");
const User = require("../../models/User");
const Department = require("../../models/Department");
const AcademicBatch = require("../../models/AcademicBatch");
const Venue = require("../../models/Venue");
const Club = require("../../models/Club");
const ClubMembership = require("../../models/ClubMembership");
const { hashPassword } = require("../../utils/Password");
const { signAccessToken } = require("../../utils/Token");
const { GLOBAL_ROLES, ACCOUNT_TYPES, CLUB_ROLES } = require("../../constants/Roles");
const { CLUB_STATUS, MEMBERSHIP_STATUS } = require("../../constants/Statuses");
const { outbox } = require("../../services/MailService");

const PASSWORD = "Passw0rd!";
let sequence = 0;

// Faculty emails allow letters only before the dot, so encode the sequence as letters (1 -> a, 27 -> ba).
const letters = (n) => n.toString(26).split("").map((d) => String.fromCharCode(97 + parseInt(d, 26))).join("");

const seedReferenceData = async () => {
    await Department.insertMany([
        { code: "CE", name: "Computer Engineering" },
        { code: "IT", name: "Information Technology" },
        { code: "ME", name: "Mechanical Engineering" }
    ]);
    await AcademicBatch.insertMany([
        { code: "23", label: "Batch 2023" },
        { code: "24", label: "Batch 2024" }
    ]);
    const [auditorium, hall] = await Venue.insertMany([
        { name: "Auditorium", location: "Main Campus", capacity: 300 },
        { name: "Seminar Hall A", location: "Academic Block", capacity: 60 }
    ]);
    return { auditorium, hall };
};

const withToken = (user) => {
    user.token = signAccessToken({ sub: user._id.toString(), role: user.globalRole });
    return user;
};

const makeStudent = async ({ department = "CE", batch = "24", name } = {}) => {
    sequence += 1;
    const user = await User.create({
        name: name || `Student ${sequence}`,
        email: `${batch}${department.toLowerCase()}uog${String(sequence).padStart(3, "0")}@ddu.ac.in`,
        password: await hashPassword(PASSWORD),
        accountType: ACCOUNT_TYPES.STUDENT,
        globalRole: GLOBAL_ROLES.STUDENT,
        departmentCode: department,
        batchCode: batch,
        isEmailVerified: true
    });
    return withToken(user);
};

const makeFaculty = async ({ department = "CE", name } = {}) => {
    sequence += 1;
    const user = await User.create({
        name: name || `Faculty ${sequence}`,
        email: `faculty${letters(sequence)}.${department.toLowerCase()}@ddu.ac.in`,
        password: await hashPassword(PASSWORD),
        accountType: ACCOUNT_TYPES.FACULTY,
        globalRole: GLOBAL_ROLES.FACULTY,
        departmentCode: department,
        isEmailVerified: true
    });
    return withToken(user);
};

const makeAdmin = async () => {
    sequence += 1;
    const user = await User.create({
        name: "University Admin",
        email: `admin${letters(sequence)}.ce@ddu.ac.in`,
        password: await hashPassword(PASSWORD),
        accountType: ACCOUNT_TYPES.FACULTY,
        globalRole: GLOBAL_ROLES.ADMIN,
        departmentCode: "CE",
        isEmailVerified: true
    });
    return withToken(user);
};

const addMembership = (club, user, role = CLUB_ROLES.MEMBER) =>
    ClubMembership.create({ club: club._id, user: user._id, role, status: MEMBERSHIP_STATUS.APPROVED, joinedAt: new Date() });

// An active club created directly in the database, for tests that start after the club lifecycle.
const makeActiveClub = async ({ name = `Club ${++sequence}`, mentor, president } = {}) => {
    const club = await Club.create({
        name,
        description: "A club created for automated tests.",
        purpose: "Testing",
        category: "TECHNOLOGY",
        departmentCodes: ["CE"],
        mentor: mentor._id,
        president: president._id,
        status: CLUB_STATUS.ACTIVE
    });
    await addMembership(club, president, CLUB_ROLES.PRESIDENT);
    return club;
};

// Returns YYYY-MM-DD for a date `days` from now.
const futureDate = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const eventPayload = (club, venue, overrides = {}) => ({
    club: String(club._id),
    title: "Hack Night",
    shortDescription: "An evening of building things together.",
    description: "Teams build projects over one evening and demo them at the end.",
    category: "TECHNOLOGY",
    venue: String(venue._id),
    eventDate: futureDate(10),
    startTime: "10:00",
    endTime: "13:00",
    registrationEnd: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    maxParticipants: 50,
    rules: "Bring your own laptop.",
    contact: { name: "Organiser", email: "organiser@ddu.ac.in", phone: "9999999999" },
    ...overrides
});

const api = (user) => {
    const auth = (req) => (user ? req.set("Authorization", `Bearer ${user.token}`) : req);
    return {
        get: (url) => auth(request(app).get(url)),
        post: (url, body = {}) => auth(request(app).post(url)).send(body),
        put: (url, body = {}) => auth(request(app).put(url)).send(body),
        patch: (url, body = {}) => auth(request(app).patch(url)).send(body),
        delete: (url, body = {}) => auth(request(app).delete(url)).send(body)
    };
};

const lastMailTo = (email) => [...outbox].reverse().find((mail) => mail.to === email);

const codeFromMail = (mail) => mail?.code;

// Bulk emails wait in the queue; tests deliver them on demand.
const flushEmails = () => require("../../services/EmailQueueService").processEmailQueue({ limit: 10000 });
const mailsTo = (email) => outbox.filter((mail) => mail.to === email);

module.exports = {
    app,
    PASSWORD,
    seedReferenceData,
    makeStudent,
    makeFaculty,
    makeAdmin,
    makeActiveClub,
    addMembership,
    eventPayload,
    futureDate,
    api,
    outbox,
    lastMailTo,
    codeFromMail,
    flushEmails,
    mailsTo
};
