// Populates a development database with a realistic CampusConnect story: clubs at every stage,
// events across the lifecycle, registrations, results, feed posts and notifications.
// Every step goes through the real services, so rules, notifications and audit entries apply.
const mongoose = require("mongoose");
const { env, validateEnv } = require("../config/env");
const connectDB = require("../config/Database");
const User = require("../models/User");
const Venue = require("../models/Venue");
const Event = require("../models/Event");
const { hashPassword } = require("../utils/Password");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const { seedReferenceData } = require("./seed");
const { combineDateAndTime, parseStudentEmail, parseFacultyEmail } = require("../utils/UniversityRules");
const clubRequests = require("../services/ClubRequestService");
const clubs = require("../services/ClubService");
const memberships = require("../services/MembershipService");
const events = require("../services/EventService");
const registrations = require("../services/RegistrationService");
const results = require("../services/ResultService");
const feed = require("../services/FeedService");
const logger = require("../utils/Logger");

const PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";
const DOMAIN = env.universityDomain;
const YEAR = Number(String(new Date().getFullYear()).slice(-2));
const batch = (yearsAgo) => String((YEAR - yearsAgo + 100) % 100).padStart(2, "0");

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
// Registration deadline: 23:59 university time, the given number of days from today.
const at = (offsetDays) => combineDateAndTime(day(offsetDays), "23:59").toISOString();

const makeUser = async ({ name, local, faculty = false, admin = false }) => {
    const email = `${local}@${DOMAIN}`.toLowerCase();
    const existing = await User.findOne({ email });
    if (existing) {
        return existing;
    }
    const student = !faculty && !admin;
    const parsed = student ? parseStudentEmail(email) : parseFacultyEmail(email);
    if (!parsed) {
        throw new Error(`Demo email ${email} does not follow the university format`);
    }
    return User.create({
        name,
        email,
        password: await hashPassword(PASSWORD),
        accountType: student ? ACCOUNT_TYPES.STUDENT : ACCOUNT_TYPES.FACULTY,
        globalRole: admin ? GLOBAL_ROLES.ADMIN : faculty ? GLOBAL_ROLES.FACULTY : GLOBAL_ROLES.STUDENT,
        departmentCode: parsed.departmentCode,
        batchCode: student ? parsed.batchCode : null,
        isEmailVerified: true
    });
};

const approvedClub = async ({ founder, cofounders = [], mentor, admin, president, request }) => {
    const created = await clubRequests.submitRequest(founder, {
        ...request,
        foundingMemberEmails: cofounders.map((u) => u.email),
        proposedMentor: String(mentor._id)
    });
    await clubRequests.verifyRequest(mentor, created._id, "Well planned — happy to mentor this club.");
    const { club } = await clubRequests.approveRequest(admin, created._id);
    await clubs.assignPresident(mentor, club._id, president._id);
    return clubs.getClub(admin, club._id);
};

const publishedEvent = async ({ club, actor, mentor, venue, ...fields }) => {
    const draft = await events.createDraft(actor, { club: club._id, venue: venue._id, ...fields });
    await events.submitEvent(actor, draft._id);
    await events.approveEvent(mentor, draft._id, "Approved. Have a great event!");
    return events.publishEvent(actor, draft._id);
};

// Moves a published event into the past so it can be completed and given results.
const moveToPast = (eventId, daysAgo, startTime = "10:00", endTime = "12:00") =>
    Event.updateOne(
        { _id: eventId },
        {
            registrationStart: combineDateAndTime(day(-daysAgo - 10), "09:00"),
            registrationEnd: combineDateAndTime(day(-daysAgo - 1), "23:59"),
            startAt: combineDateAndTime(day(-daysAgo), startTime),
            endAt: combineDateAndTime(day(-daysAgo), endTime),
            eventDate: new Date(`${day(-daysAgo)}T00:00:00Z`),
            startTime,
            endTime
        }
    );

const run = async () => {
    if (env.isProduction) {
        throw new Error("Refusing to load demo data in production");
    }

    validateEnv();
    await connectDB();
    await seedReferenceData();

    if (await User.exists({ email: `${batch(2)}ceuog001@${DOMAIN}` })) {
        logger.info("Demo data already present; nothing to do");
        return;
    }

    const [auditorium, hallA, hallB] = await Promise.all(["Auditorium", "Seminar Hall A", "Seminar Hall B"].map((name) => Venue.findOne({ name })));

    const admin = await makeUser({ name: "Registrar Office", local: "registrar.ce", admin: true });
    const mehta = await makeUser({ name: "Dr. Kavita Mehta", local: "kavita.ce", faculty: true });
    const shah = await makeUser({ name: "Prof. Nirav Shah", local: "nirav.it", faculty: true });
    const desai = await makeUser({ name: "Dr. Riya Desai", local: "riya.ec", faculty: true });

    const b2 = batch(2);
    const b1 = batch(1);
    const aarav = await makeUser({ name: "Aarav Patel", local: `${b2}ceuog001` });
    const diya = await makeUser({ name: "Diya Sharma", local: `${b2}ceuog002` });
    const kabir = await makeUser({ name: "Kabir Joshi", local: `${b2}ceuog003` });
    const meera = await makeUser({ name: "Meera Iyer", local: `${b1}ituog001` });
    const rohan = await makeUser({ name: "Rohan Verma", local: `${b1}ituog002` });
    const ananya = await makeUser({ name: "Ananya Rao", local: `${b2}ecuog001` });
    const vihaan = await makeUser({ name: "Vihaan Gupta", local: `${b1}ceuog004` });
    const sara = await makeUser({ name: "Sara Khan", local: `${b2}meuog001` });
    // Students with no club yet, for trying "request to join" and event registration from scratch.
    await makeUser({ name: "Priya Nair", local: `${b2}ceuog010` });
    await makeUser({ name: "Arjun Mehta", local: `${b1}ituog011` });

    const coding = await approvedClub({
        founder: aarav,
        cofounders: [diya, kabir],
        mentor: mehta,
        admin,
        president: aarav,
        request: {
            name: "Coding Club",
            category: "TECHNOLOGY",
            departmentCodes: ["CE"],
            description: "A community for students who love building software — from competitive programming to open source.",
            purpose: "Help students grow as engineers through practice, mentorship and collaboration.",
            proposedActivities: "Weekly coding sessions, hackathons, workshops on Git, web and AI, and open-source sprints.",
            reason: "Students currently organise coding events over WhatsApp with no shared space or support."
        }
    });

    const music = await approvedClub({
        founder: meera,
        cofounders: [rohan],
        mentor: shah,
        admin,
        president: meera,
        request: {
            name: "Music Society",
            category: "MUSIC",
            allDepartments: true,
            description: "Singers, instrumentalists and producers making music together on campus.",
            purpose: "Give musicians a stage and a community.",
            proposedActivities: "Open mic nights, jam sessions, inter-college band competitions.",
            reason: "Talented musicians on campus have no organised platform to perform."
        }
    });

    // Membership and club roles (new members normally join through recruitment drives).
    // Coding Club is for CE students only; Music Society is open to every department.
    await memberships.addMember(aarav, coding._id, vihaan._id);
    await memberships.changeMemberRole(aarav, coding._id, diya._id, "EVENT_COORDINATOR");
    await memberships.changeMemberRole(aarav, coding._id, kabir._id, "MARKETING_COORDINATOR");
    await memberships.addMember(meera, music._id, ananya._id);

    // Club requests still in the pipeline.
    await clubRequests.submitRequest(vihaan, {
        name: "Robotics Club",
        category: "TECHNOLOGY",
        departmentCodes: ["CE", "EC", "ME"],
        description: "Designing and building robots for campus and national competitions.",
        purpose: "Hands-on robotics, electronics and control systems experience.",
        proposedActivities: "Build sessions, a robo-race and workshops on sensors and microcontrollers.",
        reason: "There is no robotics community on campus yet.",
        foundingMemberEmails: [sara.email]
    });
    const quiz = await clubRequests.submitRequest(ananya, {
        name: "Quiz Club",
        category: "LITERARY",
        departmentCodes: ["EC"],
        description: "General, tech and pop-culture quizzing for curious minds.",
        purpose: "Build a quizzing culture and represent the university at inter-college quizzes.",
        proposedActivities: "Fortnightly quizzes, a flagship open quiz and quiz-writing workshops.",
        reason: "Many students quiz independently; a club would bring them together.",
        proposedMentor: String(desai._id)
    });
    await clubRequests.verifyRequest(desai, quiz._id, "Strong proposal with a clear plan.");

    // Events across the lifecycle.
    const hackNight = await publishedEvent({
        club: coding,
        actor: aarav,
        mentor: mehta,
        venue: auditorium,
        title: "HackNight 2026",
        shortDescription: "An overnight hackathon — build something amazing with your team in 12 hours.",
        description: "Form teams of 2–4 and build a project around this year's theme: campus life. Mentors from industry will be around all night, with food and prizes for the top three teams.",
        category: "COMPETITION",
        eventDate: day(12),
        startTime: "18:00",
        endTime: "23:30",
        registrationEnd: at(10),
        maxParticipants: 120,
        rules: "Teams of 2–4.\nAll code must be written during the event.\nBring your own laptop and charger.",
        contact: { name: "Aarav Patel", email: aarav.email, phone: "9876543210" }
    });

    const workshop = await events.createDraft(diya, {
        club: coding._id,
        venue: hallA._id,
        title: "Git & GitHub Workshop",
        shortDescription: "Learn version control from scratch with hands-on exercises.",
        description: "A beginner-friendly session covering commits, branches, pull requests and resolving merge conflicts.",
        category: "WORKSHOP",
        eventDate: day(18),
        startTime: "14:00",
        endTime: "16:00",
        registrationEnd: at(16),
        maxParticipants: 60,
        eligibility: { departments: ["CE", "IT"], batches: [], notes: "Beginners welcome" }
    });
    await events.submitEvent(diya, workshop._id);

    await events.createDraft(aarav, {
        club: coding._id,
        venue: hallB._id,
        title: "AI in Practice — Guest Talk",
        shortDescription: "An industry researcher on shipping machine learning to production.",
        description: "Talk followed by Q&A. Details to be finalised with the speaker.",
        category: "SEMINAR",
        eventDate: day(25),
        startTime: "11:00",
        endTime: "12:30",
        registrationEnd: at(23)
    });

    const openMic = await publishedEvent({
        club: music,
        actor: meera,
        mentor: shah,
        venue: hallA,
        title: "Open Mic Night",
        shortDescription: "Sing, play, or just enjoy — an evening of live music by students.",
        description: "Sign up to perform a 5-minute set or come along to cheer. Instruments and a sound system are provided.",
        category: "MUSIC",
        eventDate: day(6),
        startTime: "17:00",
        endTime: "20:00",
        registrationEnd: at(4),
        maxParticipants: 100
    });

    const sprint = await publishedEvent({
        club: coding,
        actor: aarav,
        mentor: mehta,
        venue: hallB,
        title: "CodeSprint Challenge",
        shortDescription: "A two-hour competitive programming contest.",
        description: "Solve algorithmic problems of increasing difficulty. Individual participation.",
        category: "COMPETITION",
        eventDate: day(30),
        startTime: "10:00",
        endTime: "12:00",
        registrationEnd: at(28),
        maxParticipants: 80
    });

    for (const student of [kabir, vihaan, ananya, sara, rohan]) {
        await registrations.registerForEvent(student, hackNight._id);
    }
    for (const student of [aarav, kabir, sara]) {
        await registrations.registerForEvent(student, openMic._id);
    }
    for (const student of [kabir, vihaan, ananya, sara]) {
        await registrations.registerForEvent(student, sprint._id);
    }

    // A round published during the event, before the final results.
    const qualifier = await results.createRound(diya, sprint._id, {
        name: "Round 1: Online qualifier",
        description: "Six problems in 90 minutes. The top three go through to the final.",
        entries: [
            { rank: 1, recipientUser: vihaan._id, score: "580", qualified: true },
            { rank: 2, recipientUser: ananya._id, score: "540", qualified: true },
            { rank: 3, recipientUser: sara._id, score: "495", qualified: true },
            { rank: 4, recipientUser: kabir._id, score: "410", qualified: false }
        ]
    });
    await results.publishRound(aarav, sprint._id, qualifier.rounds[0]._id);

    await moveToPast(sprint._id, 7);
    await events.completeEvent(aarav, sprint._id);
    await results.upsertResult(diya, sprint._id, {
        summary: "32 students competed across 6 problems. Congratulations to our winners!",
        awards: [
            { title: "Winner", position: 1, recipientUser: vihaan._id, prize: "₹5,000" },
            { title: "Runner-up", position: 2, recipientUser: ananya._id, prize: "₹3,000" },
            { title: "Second runner-up", position: 3, recipientUser: sara._id, prize: "₹1,500" }
        ]
    });
    await results.publishResult(aarav, sprint._id);

    await feed.createPost(kabir, {
        club: coding._id,
        type: "ANNOUNCEMENT",
        title: "HackNight team formation session this Friday",
        body: "Looking for teammates? Join us in Seminar Hall B at 5 PM — we'll help you find a team."
    });
    await feed.createPost(aarav, {
        club: coding._id,
        type: "CLUB_UPDATE",
        title: "Core team meeting on Monday",
        body: "All officers please attend — agenda: HackNight logistics.",
        visibility: "MEMBERS"
    });

    logger.info("Demo data loaded", {
        password: PASSWORD,
        accounts: [admin, mehta, shah, desai, aarav, diya, kabir, meera, vihaan].map((u) => `${u.email} (${u.globalRole})`)
    });
};

run()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
        logger.error("Demo seed failed", { message: error.message, stack: error.stack });
        await mongoose.disconnect();
        process.exit(1);
    });
