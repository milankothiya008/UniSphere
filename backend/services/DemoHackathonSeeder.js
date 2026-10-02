// Demo data for trying the hackathon flow and certificates on a database seeded with seedShowcase.js.
// Adds two hackathons hosted by "GDG on Campus DDU":
//   • CodeStorm 2026   — running now: problem statements are out, teams are choosing and building.
//   • HackNight Finale — finished: projects judged, results published, certificates ready to download.
// Replaces its own two events when run again. Sends no emails.
//
// Used by scripts/seedHackathonDemo.js, and once at server start on demo databases (ensureHackathonDemo).
const logger = require("../utils/Logger");

const Club = require("../models/Club");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const EventResult = require("../models/EventResult");
const EventFeedback = require("../models/EventFeedback");
const Hackathon = require("../models/Hackathon");
const HackathonEntry = require("../models/HackathonEntry");
const Certificate = require("../models/Certificate");
const Notification = require("../models/Notification");
const Team = require("../models/Team");
const User = require("../models/User");
const Venue = require("../models/Venue");
const { generateTicketCode } = require("../utils/TicketToken");

const DOMAIN = process.env.UNIVERSITY_DOMAIN || "ddu.ac.in";
const OFFSET_MS = 330 * 60000; // campus time, +05:30
const LIVE = "CodeStorm 2026";
const DONE = "HackNight Finale";
const MIN = 60000;
const HOUR = 60 * MIN;

const email = (local) => `${local}@${DOMAIN}`;
const campusKey = (date) => new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
const campusTime = (date) => new Date(date.getTime() + OFFSET_MS).toISOString().slice(11, 16);
const dayOf = (date) => new Date(`${campusKey(date)}T00:00:00Z`);
const roundTo = (date, minutes = 30) => new Date(Math.round(date.getTime() / (minutes * MIN)) * minutes * MIN);

const PROBLEMS = [
    {
        title: "Smart campus parking",
        description: "Students lose 15 minutes a day hunting for parking. Show free spots near their next class in real time — from gate counts, cameras or student check-ins.",
        track: "Campus"
    },
    {
        title: "Canteen queue buster",
        description: "Lunch queues at the main canteen are 20 minutes long. Let students pre-order, pay and pick up with a QR code without waiting in line.",
        track: "Campus",
        maxTeams: 2
    },
    {
        title: "Lost & found for DDU",
        description: "Build a simple way to report and claim lost items on campus, with photos, locations and a safe hand-over process.",
        track: "Social"
    }
];

const removeDemo = async () => {
    const events = await Event.find({ title: { $in: [LIVE, DONE] } }).select("_id");
    const ids = events.map((event) => event._id);
    if (!ids.length) return;
    await Promise.all([
        EventRegistration.deleteMany({ event: { $in: ids } }),
        Team.deleteMany({ event: { $in: ids } }),
        Hackathon.deleteMany({ event: { $in: ids } }),
        HackathonEntry.deleteMany({ event: { $in: ids } }),
        EventResult.deleteMany({ event: { $in: ids } }),
        Certificate.deleteMany({ event: { $in: ids } }),
        EventFeedback.deleteMany({ event: { $in: ids } }),
        Notification.deleteMany({ link: { $regex: ids.map(String).join("|") } })
    ]);
    await Event.deleteMany({ _id: { $in: ids } });
};

const makeEvent = async ({ title, club, venue, president, start, end, extra = {} }) =>
    Event.create({
        title,
        shortDescription: title === LIVE ? "24 hours to build something that makes campus life easier. Problems drop when we start!" : "Our overnight build night — 12 hours, 3 problem statements, real judges.",
        description:
            "Form a team of 1–4 and build a working prototype for one of the problem statements, which are released when the hackathon starts. Mentors are around all night; food and coffee are on us.\n\nProjects are judged on innovation, technical complexity, design and presentation.",
        category: "HACKATHON",
        club: club._id,
        venue: venue._id,
        eventDate: dayOf(start),
        endDate: campusKey(start) === campusKey(end) ? null : dayOf(end),
        startTime: campusTime(start),
        endTime: campusTime(end),
        startAt: start,
        endAt: end,
        registrationStart: new Date(start.getTime() - 10 * 24 * HOUR),
        registrationEnd: new Date(start.getTime() - 2 * HOUR),
        maxParticipants: 20,
        participationMode: "TEAM",
        minTeamSize: 1,
        maxTeamSize: 4,
        rules: "Teams of 1–4.\nAll code must be written during the hackathon.\nOne submission per team, before the deadline.",
        contact: { name: president.name, email: president.email, phone: "" },
        organizer: president._id,
        createdBy: president._id,
        updatedBy: president._id,
        status: "PUBLISHED",
        submittedAt: new Date(start.getTime() - 9 * 24 * HOUR),
        reviewedAt: new Date(start.getTime() - 8 * 24 * HOUR),
        publishedAt: new Date(start.getTime() - 8 * 24 * HOUR),
        ...extra
    });

// A team with registrations (and tickets) for every member.
const makeTeam = async (event, name, members, { checkedIn = false } = {}) => {
    const [leader] = members;
    const team = await Team.create({
        event: event._id,
        name,
        nameKey: name.toLowerCase(),
        leader: leader._id,
        members: members.map((user, index) => ({ user: user._id, status: index === 0 ? "LEADER" : "ACCEPTED", respondedAt: new Date() })),
        size: members.length
    });
    for (const [index, user] of members.entries()) {
        await EventRegistration.create({
            event: event._id,
            user: user._id,
            status: "REGISTERED",
            registeredAt: new Date(event.startAt.getTime() - 5 * 24 * HOUR),
            team: team._id,
            teamRole: index === 0 ? "LEADER" : "MEMBER",
            ticketCode: generateTicketCode(),
            ticketIssuedAt: new Date(event.startAt.getTime() - 5 * 24 * HOUR),
            ...(checkedIn ? { checkedInAt: new Date(event.startAt.getTime() + 10 * MIN), checkInMethod: "QR" } : {})
        });
    }
    return team;
};

const DEMO_LOCALS = ["24cedmo001", "24itdmo002", "25cedmo003", "25itdmo004", "24ecdmo005", "26cedmo006", "demo.ce", "demo.it"];

/** Creates (or re-creates) the two demo hackathons. Returns false when this isn't a showcase demo database. */
const seedHackathonDemo = async ({ log = (message) => logger.info(message) } = {}) => {
    const hackathons = require("./HackathonService");
    const certificates = require("./CertificateService");

    const users = Object.fromEntries(
        await Promise.all(
            DEMO_LOCALS.map(async (local) => [local, await User.findOne({ email: email(local) })])
        )
    );
    const missing = Object.entries(users).filter(([, user]) => !user).map(([local]) => email(local));
    const club = await Club.findOne({ name: /GDG on Campus/i, status: "ACTIVE" });
    const venue = (await Venue.findOne({ name: /Auditorium/i, status: "ACTIVE" })) || (await Venue.findOne({ status: "ACTIVE", type: { $ne: "LAB" } }));
    if (missing.length || !club || !venue) {
        log(`Not a showcase demo database (run scripts/seedShowcase.js first). Missing: ${JSON.stringify({ users: missing, club: Boolean(club), venue: Boolean(venue) })}`);
        return false;
    }
    const aarav = users["24cedmo001"];
    const diya = users["24itdmo002"]; // GDG president
    const kabir = users["25cedmo003"];
    const meera = users["25itdmo004"];
    const rohan = users["24ecdmo005"];
    const sneha = users["26cedmo006"];
    const drMehta = users["demo.ce"];

    await removeDemo();
    const now = new Date();

    // ---------------------------------------------------------------- 1. CodeStorm 2026 — running now
    {
        const start = roundTo(new Date(now.getTime() - 2 * HOUR));
        const end = new Date(start.getTime() + 24 * HOUR);
        const event = await makeEvent({ title: LIVE, club, venue, president: diya, start, end, extra: { registeredCount: 2, certificatesEnabled: true, checkIn: { status: "OPEN", openedAt: start, openedBy: diya._id } } });
        await makeTeam(event, "Byte Busters", [kabir, sneha], { checkedIn: true });
        await makeTeam(event, "Null Pointers", [rohan, meera], { checkedIn: true });

        await hackathons.ensureHackathon(event);
        await hackathons.updateSettings(diya, event._id, {
            revealAt: new Date(start.getTime() + 15 * MIN).toISOString(),
            selectionDeadline: new Date(now.getTime() + 3 * HOUR).toISOString(),
            repoDeadline: new Date(now.getTime() + 6 * HOUR).toISOString(),
            submissionDeadline: new Date(end.getTime() - 2 * HOUR).toISOString(),
            agenda: [
                ["Opening ceremony", 0, "Auditorium stage"],
                ["Problem statements released", 15, ""],
                ["Mentoring round 1", 180, "Mentors visit every team"],
                ["Repository deadline", Math.round((now.getTime() + 6 * HOUR - start.getTime()) / MIN), "Share your GitHub repository link"],
                ["Dinner", 420, "Cafeteria"],
                ["Mentoring round 2", 720, ""],
                ["Final submissions close", 22 * 60, "Demo link, video and slides — late projects can't be judged"],
                ["Demos and judging", 22 * 60 + 15, "3 minutes per team"],
                ["Results and prizes", 23 * 60 + 30, ""]
            ].map(([title, minutes, note]) => ({ title, startsAt: new Date(start.getTime() + minutes * MIN).toISOString(), note }))
        });
        for (const problem of PROBLEMS) await hackathons.addProblem(diya, event._id, problem);
        await Hackathon.updateOne({ event: event._id }, { $set: { judges: [drMehta, aarav].map((user) => ({ user: user._id, addedBy: diya._id })), notified: ["REVEAL"] } });

        const view = await hackathons.getHackathon(rohan, event._id);
        await hackathons.chooseProblem(rohan, event._id, view.problemStatements[1]._id);
        await hackathons.submitRepo(meera, event._id, { repoUrl: "https://github.com/null-pointers/queueless" });
        // Byte Busters haven't chosen a problem yet — sign in as Kabir to try it.
        const at = (ms) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
        log(`✓ ${LIVE}: running now — choose a problem by ${at(now.getTime() + 3 * HOUR)}, repository by ${at(now.getTime() + 6 * HOUR)}, final submission after that`);
    }

    // ---------------------------------------------------------------- 2. HackNight Finale — finished, certificates ready
    {
        const start = roundTo(new Date(now.getTime() - 4 * 24 * HOUR));
        start.setUTCHours(12, 30, 0, 0); // 6:00 pm campus time
        const end = new Date(start.getTime() + 12 * HOUR); // 6:00 am next day
        const event = await makeEvent({
            title: DONE,
            club,
            venue,
            president: diya,
            start,
            end,
            extra: {
                registeredCount: 2,
                certificatesEnabled: true,
                status: "COMPLETED",
                completedAt: new Date(end.getTime() + HOUR),
                checkIn: { status: "CLOSED", openedAt: start, openedBy: diya._id, closedAt: end, closedBy: diya._id },
                remindersSent: [
                    { kind: "START_24H", at: new Date(start.getTime() - 24 * HOUR), recipients: 4 },
                    { kind: "START_1H", at: new Date(start.getTime() - HOUR), recipients: 4 },
                    { kind: "FEEDBACK", at: end, recipients: 4 }
                ]
            }
        });
        const busters = await makeTeam(event, "Byte Busters", [kabir, sneha], { checkedIn: true });
        const pointers = await makeTeam(event, "Null Pointers", [rohan, meera], { checkedIn: true });

        const hack = await hackathons.ensureHackathon(event);
        hack.revealAt = start;
        hack.selectionDeadline = new Date(start.getTime() + 2 * HOUR);
        hack.repoDeadline = new Date(start.getTime() + 5 * HOUR);
        hack.submissionDeadline = new Date(end.getTime() - HOUR);
        hack.problemStatements = PROBLEMS;
        hack.judges = [drMehta, aarav].map((user) => ({ user: user._id, addedBy: diya._id }));
        hack.notified = ["REVEAL", "SELECTION_1H", "REPO_1H", "FINAL_OPEN", "SUBMISSION_1H", "JUDGING_OPEN"];
        hack.agenda = [
            { title: "Opening ceremony", startsAt: start, note: "" },
            { title: "Problem statements released", startsAt: start, note: "" },
            { title: "Midnight snacks", startsAt: new Date(start.getTime() + 6 * HOUR), note: "" },
            { title: "Submissions close", startsAt: hack.submissionDeadline, note: "" },
            { title: "Demos and judging", startsAt: new Date(end.getTime() - 50 * MIN), note: "" }
        ];
        await hack.save();
        const [parking, canteen] = hack.problemStatements;

        const entry = (team, problem, project, submittedMinutes) =>
            HackathonEntry.create({
                event: event._id,
                entryKey: `team:${team._id}`,
                team: team._id,
                owner: team.leader,
                name: team.name,
                problemStatement: problem._id,
                problemChosenAt: new Date(start.getTime() + 40 * MIN),
                problemChosenBy: team.leader,
                repoSubmittedAt: new Date(start.getTime() + 3 * HOUR),
                repoSubmittedBy: team.leader,
                project,
                submittedAt: new Date(start.getTime() + submittedMinutes * MIN),
                submittedBy: team.leader
            });
        await entry(
            busters,
            parking,
            {
                title: "ParkIt",
                summary: "A live map of free parking spots built from gate counters and one-tap student check-ins, with a 'park near my next class' suggestion.",
                repoUrl: "https://github.com/byte-busters/parkit",
                demoUrl: "https://parkit-demo.vercel.app",
                videoUrl: "https://youtu.be/dQw4w9WgXcQ",
                techStack: "Flutter, Firebase, Google Maps"
            },
            600
        );
        await entry(
            pointers,
            canteen,
            {
                title: "QueueLess",
                summary: "Pre-order canteen food, pay with UPI and collect it with a QR code. The counter screen shows orders in pickup order.",
                repoUrl: "https://github.com/null-pointers/queueless",
                demoUrl: "https://queueless-demo.vercel.app",
                techStack: "React, Node.js, MongoDB"
            },
            630
        );

        // Both judges score both projects.
        const panel = await hackathons.listForJudging(drMehta, event._id);
        const scores = {
            [String(drMehta._id)]: { "Byte Busters": [9, 8, 8, 9], "Null Pointers": [7, 8, 7, 6] },
            [String(aarav._id)]: { "Byte Busters": [8, 9, 9, 8], "Null Pointers": [8, 7, 7, 7] }
        };
        const comments = { "Byte Busters": "Polished demo and a real campus problem.", "Null Pointers": "Solid backend; the UI needs work." };
        for (const judge of [drMehta, aarav]) {
            for (const item of panel.entries) {
                await hackathons.scoreEntry(judge, event._id, item._id, {
                    marks: panel.criteria.map((criterion, index) => ({ criterion: criterion._id, score: scores[String(judge._id)][item.name][index] })),
                    comment: judge === drMehta ? comments[item.name] : ""
                });
            }
        }

        // Leaderboard → results draft (as the president), then published (directly, so no emails go out).
        await hackathons.draftResults(diya, event._id, { winners: 2 });
        await EventResult.updateOne(
            { event: event._id },
            { $set: { status: "PUBLISHED", publishedAt: end, publishedBy: diya._id, lastPublishedAt: end, "rounds.$[].status": "PUBLISHED", "rounds.$[].publishedAt": end, "rounds.$[].publishedBy": diya._id } }
        );

        // Certificates: issued for everyone who qualifies (participation for all four, merit for both teams).
        const issued = [];
        for (const user of [kabir, sneha, rohan, meera]) {
            const result = await certificates.myCertificatesForEvent(user, event._id);
            issued.push(...result.items.map((item) => ({ user: user.name, ...item })));
        }
        await Notification.insertMany(
            [kabir, sneha, rohan, meera].map((user) => ({
                user: user._id,
                type: "CERTIFICATE_READY",
                title: `Your certificates for ${DONE} are ready`,
                message: "Download them from the event page or Profile → Achievements.",
                link: `/events/${event._id}#certificates`,
                createdAt: new Date(end.getTime() + 2 * HOUR)
            }))
        );

        // Feedback from three of the four participants.
        await EventFeedback.insertMany([
            { event: event._id, club: club._id, user: kabir._id, rating: 5, note: "Best night of the semester — mentors were super helpful." },
            { event: event._id, club: club._id, user: rohan._id, rating: 4, note: "Great problems. The Wi-Fi dropped a few times around 2 am." },
            { event: event._id, club: club._id, user: sneha._id, rating: 4, note: "" }
        ]);

        log(`✓ ${DONE}: finished — judged, results published, ${issued.length} certificates issued:`);
        issued.forEach((item) => log(`    ${item.user.padEnd(12)} ${item.kind.padEnd(13)} ${item.awardTitle || ""}  ${item.code}`));
    }

    log(`Try it (password Demo@1234):
  • ${email("25cedmo003")} (Kabir, Byte Busters) — CodeStorm: choose a problem, submit a project; HackNight: download certificates
  • ${email("24ecdmo005")} (Rohan, Null Pointers) — CodeStorm: project already submitted
  • ${email("24itdmo002")} (Diya, GDG president) — Manage hackathon: setup, judges, leaderboard, feedback, reminders
  • ${email("demo.ce")} (Dr. Mehta, judge) — HackNight judging panel and scores
  • Verify any certificate ID at /verify/<ID>`);
    return true;
};

/**
 * At server start: on a showcase demo database that doesn't have the demo hackathons yet, add them once.
 * Real university databases (no demo accounts) are left alone. DEMO_HACKATHONS=off switches it off.
 */
const ensureHackathonDemo = async () => {
    if (process.env.DEMO_HACKATHONS === "off") return;
    try {
        const demoAccounts = await User.countDocuments({ email: { $in: DEMO_LOCALS.map(email) } });
        if (demoAccounts < DEMO_LOCALS.length) return;
        const existing = await Event.find({ title: { $in: [LIVE, DONE] } }).select("_id").lean();
        // Already there — unless it was made before the repository stage existed, then it's refreshed once.
        if (existing.length && !(await Hackathon.exists({ event: { $in: existing.map((event) => event._id) }, repoDeadline: null }))) return;
        logger.info("Adding the demo hackathons to this demo database");
        await seedHackathonDemo();
    } catch (error) {
        logger.error("Demo hackathon seeding failed", { message: error.message });
    }
};

module.exports = { seedHackathonDemo, ensureHackathonDemo };
