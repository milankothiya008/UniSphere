// Loads a complete, good-looking demo of CampusConnect into a database (including a deployed one):
// four clubs at different stages, faculty mentors, students with club roles, club and membership requests,
// events at every step of their lifecycle (live, upcoming, full with a waitlist, team event, pending edits,
// completed with round-wise and final results), feed posts, stories (photo, video, event poster),
// subscriptions and in-app notifications. Posters, logos and banners are generated and stored in Cloudinary.
//
//   npm run seed:showcase -- --confirm            load the showcase (skipped if it is already there)
//   npm run seed:showcase -- --confirm --reset    remove the showcase data first, then load it again
//   npm run seed:showcase -- --confirm --stories  only refresh the stories (they disappear after 24 hours)
//
// Uses MONGO_URI and CLOUDINARY_* from the environment. Nothing is emailed: demo accounts get in-app
// notifications only. Demo accounts use "dmo" student emails and "demo.<dept>" faculty emails, so they
// can't collide with real university accounts.
const mongoose = require("mongoose");
const { env, validateEnv } = require("../config/env");

// Must run before any service loads: demo data never sends email.
const emailQueue = require("../services/EmailQueueService");
emailQueue.enqueueEmails = async () => 0;

const connectDB = require("../config/Database");
const User = require("../models/User");
const Venue = require("../models/Venue");
const Club = require("../models/Club");
const Event = require("../models/Event");
const Team = require("../models/Team");
const Story = require("../models/Story");
const StoryView = require("../models/StoryView");
const FeedPost = require("../models/FeedPost");
const EventResult = require("../models/EventResult");
const Notification = require("../models/Notification");
const ClubMembership = require("../models/ClubMembership");
const ClubSubscription = require("../models/ClubSubscription");
const ClubCreationRequest = require("../models/ClubCreationRequest");
const EventRegistration = require("../models/EventRegistration");
const RefreshToken = require("../models/RefreshToken");
const { hashPassword } = require("../utils/Password");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const { combineDateAndTime, parseStudentEmail, parseFacultyEmail } = require("../utils/UniversityRules");
const { seedReferenceData } = require("./seed");
const clubRequests = require("../services/ClubRequestService");
const clubs = require("../services/ClubService");
const memberships = require("../services/MembershipService");
const subscriptions = require("../services/SubscriptionService");
const events = require("../services/EventService");
const registrations = require("../services/RegistrationService");
const teams = require("../services/TeamService");
const results = require("../services/ResultService");
const feed = require("../services/FeedService");
const stories = require("../services/StoryService");
const checkIn = require("../services/CheckInService");
const EventRegistrationModel = require("../models/EventRegistration");
const { signParams } = require("../services/StoryMediaService");
const logger = require("../utils/Logger");

const PASSWORD = process.env.DEMO_PASSWORD || "Demo@1234";
const DOMAIN = env.universityDomain;
const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------- Cast

const FACULTY = {
    mehta: { name: "Dr. Kavita Mehta", local: "demo.ce" },
    shah: { name: "Prof. Nirav Shah", local: "demo.it" },
    desai: { name: "Dr. Riya Desai", local: "demo.ec" },
    rao: { name: "Prof. Arjun Rao", local: "demo.me" }
};

const STUDENTS = {
    aarav: { name: "Aarav Patel", local: "24cedmo001" },
    diya: { name: "Diya Sharma", local: "24itdmo002" },
    kabir: { name: "Kabir Joshi", local: "25cedmo003" },
    meera: { name: "Meera Iyer", local: "25itdmo004" },
    rohan: { name: "Rohan Verma", local: "24ecdmo005" },
    sneha: { name: "Sneha Nair", local: "26cedmo006" }
};

const DEMO_EMAILS = [...Object.values(FACULTY), ...Object.values(STUDENTS)].map((person) => `${person.local}@${DOMAIN}`.toLowerCase());

const CLUB_NAMES = ["CSI DDU Student Chapter", "GDG on Campus DDU", "ShutterBug", "Spectrum", "Robotics Club", "E-Cell DDU", "Quiz Club"];

// Colours for generated artwork.
const THEME = {
    csi: { from: "#0b1a4a", to: "#1d5fd0", accent: "#38bdf8", initials: "CSI" },
    gdg: { from: "#0f172a", to: "#1e3a8a", accent: "#fbbc05", initials: "GDG" },
    shutter: { from: "#1c1917", to: "#9a3412", accent: "#f59e0b", initials: "SB" },
    spectrum: { from: "#3b0764", to: "#db2777", accent: "#fde047", initials: "SP" }
};

// ---------------------------------------------------------------- Dates

const day = (offset) => new Date(Date.now() + offset * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
const deadline = (offsetDays, time = "23:59") => combineDateAndTime(day(offsetDays), time).toISOString();
const nice = (offset) => new Date(`${day(offset)}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const istClock = (date) => new Date(date.getTime() + 5.5 * 3600000).toISOString().slice(11, 16);

// Moves a published event into the past so it can be completed and given final results.
const moveToPast = (eventId, daysAgo, startTime = "10:00", endTime = "13:00") =>
    Event.updateOne(
        { _id: eventId },
        {
            registrationStart: combineDateAndTime(day(-daysAgo - 12), "09:00"),
            registrationEnd: combineDateAndTime(day(-daysAgo - 1), "23:59"),
            startAt: combineDateAndTime(day(-daysAgo), startTime),
            endAt: combineDateAndTime(day(-daysAgo), endTime),
            eventDate: new Date(`${day(-daysAgo)}T00:00:00Z`),
            startTime,
            endTime
        }
    );

// Makes a published event happen right now (started an hour ago), so it shows as "Live now".
const makeLive = async (eventId) => {
    const start = new Date(Math.floor((Date.now() - 60 * 60000) / 300000) * 300000);
    let end = new Date(start.getTime() + 3.5 * 3600000);
    const endOfDay = combineDateAndTime(day(0), "23:59");
    if (end > endOfDay) {
        end = endOfDay;
    }
    await Event.updateOne(
        { _id: eventId },
        {
            registrationStart: new Date(start.getTime() - 7 * 86400000),
            registrationEnd: new Date(start.getTime() - 2 * 3600000),
            startAt: start,
            endAt: end,
            eventDate: new Date(`${new Date(start.getTime() + 5.5 * 3600000).toISOString().slice(0, 10)}T00:00:00Z`),
            startTime: istClock(start),
            endTime: istClock(end)
        }
    );
};

// ---------------------------------------------------------------- Artwork (SVG rendered to PNG by Cloudinary)

const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const wrap = (text, maxChars) => {
    const lines = [];
    let line = "";
    String(text)
        .split(/\s+/)
        .forEach((word) => {
            if (line && `${line} ${word}`.length > maxChars) {
                lines.push(line);
                line = word;
            } else {
                line = line ? `${line} ${word}` : word;
            }
        });
    if (line) {
        lines.push(line);
    }
    return lines;
};

const FONT = "Arial, Helvetica, sans-serif";

const decor = (width, height, theme) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.from}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient>
    <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="#ffffff" opacity="0.12"/></pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height * 0.45}" fill="url(#dots)"/>
  <circle cx="${width * 0.86}" cy="${height * 0.12}" r="${width * 0.28}" fill="${theme.accent}" opacity="0.22"/>
  <circle cx="${width * 0.08}" cy="${height * 0.92}" r="${width * 0.2}" fill="#ffffff" opacity="0.06"/>`;

const posterSvg = ({ theme, kicker, title, lines = [], footer }) => {
    const titleLines = wrap(title, 13).slice(0, 4);
    const top = 470;
    const titleSvg = titleLines
        .map((text, i) => `<text x="90" y="${top + i * 125}" font-family="${FONT}" font-weight="700" font-size="112" fill="${i === 0 ? theme.accent : "#ffffff"}">${xml(text)}</text>`)
        .join("");
    const after = top + titleLines.length * 125 + 30;
    const detail = lines.map((text, i) => `<text x="90" y="${after + i * 64}" font-family="${FONT}" font-size="44" fill="#dbe4ff">${xml(text)}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">${decor(1080, 1350, theme)}
  <rect x="90" y="300" rx="28" width="${Math.max(220, kicker.length * 24 + 60)}" height="56" fill="#ffffff" opacity="0.14"/>
  <text x="120" y="338" font-family="${FONT}" font-weight="700" font-size="28" letter-spacing="3" fill="${theme.accent}">${xml(kicker.toUpperCase())}</text>
  ${titleSvg}${detail}
  <rect x="0" y="1220" width="1080" height="130" fill="#000000" opacity="0.28"/>
  <text x="90" y="1298" font-family="${FONT}" font-weight="700" font-size="40" fill="#ffffff">${xml(footer)}</text>
</svg>`;
};

const logoSvg = (theme) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.from}"/><stop offset="1" stop-color="${theme.to}"/></linearGradient></defs>
  <rect width="512" height="512" rx="120" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="178" fill="none" stroke="${theme.accent}" stroke-width="14" opacity="0.9"/>
  <text x="256" y="${theme.initials.length > 2 ? 290 : 300}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${theme.initials.length > 2 ? 118 : 150}" fill="#ffffff">${xml(theme.initials)}</text>
</svg>`;

// Banners carry no text: the club page prints the name and tagline over them.
const coverSvg = (theme) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">${decor(1600, 600, theme)}
  <circle cx="1180" cy="520" r="220" fill="${theme.accent}" opacity="0.12"/>
  <path d="M0 470 C 400 380, 800 560, 1600 420 L1600 600 L0 600 Z" fill="#000000" opacity="0.18"/>
</svg>`;

const storySvg = ({ theme, kicker, headline, sub }) => {
    const lines = wrap(headline, 12).slice(0, 5);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${decor(1080, 1920, theme)}
  <text x="90" y="640" font-family="${FONT}" font-weight="700" font-size="36" letter-spacing="4" fill="${theme.accent}">${xml(kicker.toUpperCase())}</text>
  ${lines.map((text, i) => `<text x="90" y="${760 + i * 130}" font-family="${FONT}" font-weight="700" font-size="116" fill="#ffffff">${xml(text)}</text>`).join("")}
  ${wrap(sub, 34).map((text, i) => `<text x="90" y="${800 + lines.length * 130 + i * 62}" font-family="${FONT}" font-size="46" fill="#dbe4ff">${xml(text)}</text>`).join("")}
</svg>`;
};

// ---------------------------------------------------------------- Cloudinary

const assertCloudinary = () => {
    if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
        throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET: showcase images are stored in Cloudinary");
    }
};

const upload = async ({ file, publicId, resource = "image", eager }) => {
    const params = { overwrite: "true", public_id: publicId, timestamp: Math.floor(Date.now() / 1000), ...(eager ? { eager, eager_async: "true" } : {}) };
    const form = new FormData();
    form.append("file", file);
    Object.entries({ ...params, api_key: env.cloudinary.apiKey, signature: signParams(params) }).forEach(([key, value]) => form.append(key, String(value)));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${resource}/upload`, { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(`Cloudinary upload failed for ${publicId}: ${body.error?.message || response.status}`);
    }
    return body;
};

// Uploads generated artwork and returns a PNG delivery URL.
const artwork = async (svg, name) => {
    const uploaded = await upload({ file: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, publicId: `${env.cloudinary.folder}/showcase/${name}` });
    return uploaded.secure_url.replace(/\.svg$/, ".png");
};

const photo = (seed, width = 1080, height = 1350) => `https://picsum.photos/seed/${seed}/${width}/${height}`;

// ---------------------------------------------------------------- Helpers

const makeUser = async ({ name, local }, { faculty = false } = {}) => {
    const email = `${local}@${DOMAIN}`.toLowerCase();
    const parsed = faculty ? parseFacultyEmail(email) : parseStudentEmail(email);
    if (!parsed) {
        throw new Error(`Demo email ${email} does not follow the university format`);
    }
    return User.create({
        name,
        email,
        password: await hashPassword(PASSWORD),
        accountType: faculty ? ACCOUNT_TYPES.FACULTY : ACCOUNT_TYPES.STUDENT,
        globalRole: faculty ? GLOBAL_ROLES.FACULTY : GLOBAL_ROLES.STUDENT,
        departmentCode: parsed.departmentCode,
        batchCode: faculty ? null : parsed.batchCode,
        isEmailVerified: true
    });
};

const approvedClub = async ({ founder, cofounders = [], mentor, admin, president, request, profile }) => {
    const created = await clubRequests.submitRequest(founder, {
        ...request,
        foundingMemberEmails: cofounders.map((user) => user.email),
        proposedMentor: String(mentor._id)
    });
    await clubRequests.verifyRequest(mentor, created._id, "Clear plan and a committed founding team — happy to mentor this club.");
    const { club } = await clubRequests.approveRequest(admin, created._id);
    if (president) {
        await clubs.assignPresident(mentor, club._id, president._id);
        await clubs.updateClub(president, club._id, profile);
    }
    return Club.findById(club._id);
};

const publishedEvent = async ({ club, actor, mentor, ...fields }) => {
    const draft = await events.createDraft(actor, { club: club._id, ...fields });
    await events.submitEvent(actor, draft._id);
    await events.approveEvent(mentor, draft._id, "Looks great — approved.");
    return events.publishEvent(actor, draft._id);
};

const approveJoin = async (president, club, student, message) => {
    await memberships.requestToJoin(student, club._id, message);
    const pending = await memberships.listJoinRequests(president, club._id);
    const request = pending.find((row) => String(row.user._id) === String(student._id));
    await memberships.decideJoinRequest(president, club._id, request._id, true);
};

const register = (student, event, body) => registrations.registerForEvent(student, event._id, body);

// Attendance for a past event: who turned up, scanned by the given officer.
const markAttended = async (event, students, scannedBy, minutesAfterStart = 12) => {
    const at = new Date(new Date(event.startAt).getTime() + minutesAfterStart * 60000);
    await EventRegistrationModel.updateMany(
        { event: event._id, user: { $in: students.map((student) => student._id) }, status: "REGISTERED" },
        { $set: { checkedInAt: at, checkedInBy: scannedBy._id, checkInMethod: "QR" } }
    );
};

// ---------------------------------------------------------------- Reset

const resetShowcase = async () => {
    const users = await User.find({ email: { $in: DEMO_EMAILS } }).select("_id");
    const userIds = users.map((user) => user._id);
    const clubList = await Club.find({ name: { $in: CLUB_NAMES } }).select("_id");
    const clubIds = clubList.map((club) => club._id);
    const eventList = await Event.find({ club: { $in: clubIds } }).select("_id");
    const eventIds = eventList.map((event) => event._id);
    const storyIds = (await Story.find({ club: { $in: clubIds } }).select("_id")).map((story) => story._id);
    const linkPattern = [...clubIds, ...eventIds].map((id) => String(id)).join("|");

    await Promise.all([
        StoryView.deleteMany({ story: { $in: storyIds } }),
        Story.deleteMany({ _id: { $in: storyIds } }),
        EventRegistration.deleteMany({ $or: [{ event: { $in: eventIds } }, { user: { $in: userIds } }] }),
        EventResult.deleteMany({ event: { $in: eventIds } }),
        Team.deleteMany({ event: { $in: eventIds } }),
        FeedPost.deleteMany({ $or: [{ club: { $in: clubIds } }, { event: { $in: eventIds } }] }),
        ClubMembership.deleteMany({ $or: [{ club: { $in: clubIds } }, { user: { $in: userIds } }] }),
        ClubSubscription.deleteMany({ $or: [{ club: { $in: clubIds } }, { user: { $in: userIds } }] }),
        ClubCreationRequest.deleteMany({ $or: [{ requester: { $in: userIds } }, { name: { $in: CLUB_NAMES } }] }),
        Notification.deleteMany({ $or: [{ user: { $in: userIds } }, ...(linkPattern ? [{ link: { $regex: linkPattern } }] : [])] }),
        RefreshToken.deleteMany({ user: { $in: userIds } })
    ]);
    await Event.deleteMany({ _id: { $in: eventIds } });
    await Club.deleteMany({ _id: { $in: clubIds } });
    await User.deleteMany({ _id: { $in: userIds } });
    stories.invalidateTray();
    logger.info("Removed the previous showcase data", { users: userIds.length, clubs: clubIds.length, events: eventIds.length });
};

// ---------------------------------------------------------------- Stories (24 hours)

const createStory = async ({ club, author, media, caption, event = null, hoursAgo = 1 }) => {
    const createdAt = new Date(Date.now() - hoursAgo * 3600000);
    const story = await Story.create({
        club: club._id,
        author: author._id,
        media,
        caption,
        event: event?._id || null,
        expiresAt: new Date(createdAt.getTime() + env.stories.lifetimeHours * 3600000)
    });
    await Story.collection.updateOne({ _id: story._id }, { $set: { createdAt } });
    return story;
};

const cloudinaryMedia = (uploaded, kind) => ({
    kind,
    provider: "cloudinary",
    key: uploaded.public_id,
    version: uploaded.version,
    format: uploaded.format,
    width: uploaded.width || null,
    height: uploaded.height || null,
    duration: kind === "VIDEO" ? Math.min(uploaded.duration || env.stories.maxVideoSeconds, env.stories.maxVideoSeconds) : null,
    bytes: uploaded.bytes || null
});

// Photo, video, generated slide and event-poster stories for each active club, with views and likes.
const loadStories = async (cast) => {
    const find = (name) => Club.findOne({ name });
    const [csi, gdg, shutter] = await Promise.all([find("CSI DDU Student Chapter"), find("GDG on Campus DDU"), find("ShutterBug")]);
    const hackNight = await Event.findOne({ club: csi._id, title: "HackNight 2026" });
    const ioExtended = await Event.findOne({ club: gdg._id, title: "Google I/O Extended DDU" });
    const photoWalk = await Event.findOne({ club: shutter._id, title: "Heritage Photo Walk" });
    const folder = (club) => `${env.cloudinary.folder}/stories/${club._id}`;

    const slide = async (club, name, theme, content) => {
        const svg = storySvg({ theme, ...content });
        const uploaded = await upload({ file: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, publicId: `${folder(club)}/showcase-${name}` });
        return cloudinaryMedia({ ...uploaded, format: "png" }, "IMAGE");
    };
    const photoMedia = async (club, name, seed) => {
        try {
            return cloudinaryMedia(await upload({ file: photo(seed, 1080, 1920), publicId: `${folder(club)}/showcase-${name}` }), "IMAGE");
        } catch (error) {
            logger.warn("Photo download failed; using a generated slide instead", { message: error.message });
            return slide(club, name, THEME.shutter, { kicker: "ShutterBug", headline: "Frames from the walk", sub: "Our best shots of the week" });
        }
    };

    const made = [];
    made.push(
        await createStory({
            club: csi,
            author: cast.aarav,
            media: await slide(csi, "hacknight-open", THEME.csi, { kicker: "CSI DDU", headline: "HackNight registrations are open", sub: "Teams of 2–4 · 30 team slots · Auditorium" }),
            caption: "Form your team and register before the slots run out! 🚀",
            event: hackNight,
            hoursAgo: 5
        }),
        await createStory({
            club: csi,
            author: cast.aarav,
            media: { kind: "IMAGE", provider: "event", key: hackNight.poster },
            caption: "Official HackNight 2026 poster — share it with your friends",
            event: hackNight,
            hoursAgo: 2
        }),
        await createStory({
            club: gdg,
            author: cast.diya,
            media: await slide(gdg, "io-full", THEME.gdg, { kicker: "GDG on Campus", headline: "I/O Extended is full!", sub: "Join the waitlist — seats free up automatically" }),
            caption: "Thank you for the amazing response 💙❤️💛💚",
            event: ioExtended,
            hoursAgo: 7
        }),
        await createStory({
            club: gdg,
            author: cast.meera,
            media: { kind: "IMAGE", provider: "event", key: ioExtended.poster },
            caption: "Keynote watch party + live demos",
            event: ioExtended,
            hoursAgo: 3
        }),
        await createStory({
            club: shutter,
            author: cast.kabir,
            media: await photoMedia(shutter, "walk-1", "ddu-heritage-1"),
            caption: "Golden hour at the old campus gate ✨",
            event: photoWalk,
            hoursAgo: 4
        }),
        await createStory({
            club: shutter,
            author: cast.rohan,
            media: await photoMedia(shutter, "walk-2", "ddu-heritage-2"),
            caption: "Shot on a 50mm — can you guess the spot?",
            hoursAgo: 2
        })
    );

    try {
        const video = await upload({
            file: "https://res.cloudinary.com/demo/video/upload/dog.mp4",
            publicId: `${folder(shutter)}/showcase-reel`,
            resource: "video",
            eager: `c_limit,h_1280,w_720,q_auto,du_${env.stories.maxVideoSeconds}/mp4|so_0,c_limit,h_1280,w_720,q_auto/jpg`
        });
        made.push(
            await createStory({
                club: shutter,
                author: cast.kabir,
                media: cloudinaryMedia(video, "VIDEO"),
                caption: "Behind the lens: a quick reel from today's walk 🎥",
                event: photoWalk,
                hoursAgo: 1
            })
        );
    } catch (error) {
        logger.warn("Video story skipped", { message: error.message });
    }

    // Views and likes, so presidents see who watched.
    const audience = [cast.meera, cast.kabir, cast.rohan, cast.sneha, cast.diya, cast.aarav];
    for (const [index, story] of made.entries()) {
        for (const viewer of audience.slice(0, 3 + (index % 4))) {
            if (String(viewer._id) === String(story.author)) {
                continue;
            }
            await stories.recordView(viewer, story._id);
            if ((index + viewer.name.length) % 2 === 0) {
                await stories.setLiked(viewer, story._id, true);
            }
        }
    }
    stories.invalidateTray();
    return made.length;
};

// ---------------------------------------------------------------- Showcase

const loadShowcase = async () => {
    const admin = await User.findOne({ globalRole: GLOBAL_ROLES.ADMIN, isActive: { $ne: false } });
    if (!admin) {
        throw new Error("No admin account found. Start the backend once (it creates BOOTSTRAP_ADMIN_*) or run npm run seed.");
    }
    const [auditorium, hallA, hallB] = await Promise.all(["Auditorium", "Seminar Hall A", "Seminar Hall B"].map((name) => Venue.findOne({ name })));

    logger.info("Creating demo accounts");
    const cast = {};
    for (const [key, person] of Object.entries(FACULTY)) {
        cast[key] = await makeUser(person, { faculty: true });
    }
    for (const [key, person] of Object.entries(STUDENTS)) {
        cast[key] = await makeUser(person);
    }
    const { mehta, shah, desai, rao, aarav, diya, kabir, meera, rohan, sneha } = cast;

    logger.info("Generating logos, banners and posters");
    const art = {};
    for (const [key, theme] of Object.entries(THEME)) {
        art[`${key}Logo`] = await artwork(logoSvg(theme), `logos/${key}`);
    }
    art.csiCover = await artwork(coverSvg(THEME.csi), "covers/csi");
    art.gdgCover = await artwork(coverSvg(THEME.gdg), "covers/gdg");
    art.shutterCover = await artwork(coverSvg(THEME.shutter), "covers/shutter");
    const poster = (theme, name, content) => artwork(posterSvg({ theme, ...content }), `posters/${name}`);

    logger.info("Creating clubs");
    const csi = await approvedClub({
        founder: aarav,
        cofounders: [meera, kabir],
        mentor: mehta,
        admin,
        president: aarav,
        request: {
            name: "CSI DDU Student Chapter",
            category: "TECHNOLOGY",
            departmentCodes: ["CE", "IT"],
            description:
                "The DDU student chapter of the Computer Society of India. We run coding contests, hackathons, workshops and talks for Computer and IT engineering students, and help members build real projects together.",
            purpose: "Build strong engineers through practice, competition and mentorship from seniors and industry.",
            proposedActivities: "Weekly DSA practice, CodeSprint contests, HackNight hackathon, Git and cloud workshops, industry talks.",
            reason: "CE and IT students need one organised community for technical events instead of scattered groups."
        },
        profile: {
            logo: art.csiLogo,
            coverImage: art.csiCover,
            tagline: "Code · Build · Lead",
            website: "https://www.csi-india.org",
            contactEmail: aarav.email,
            contactPhone: "+91 98250 11001",
            meetingSchedule: "Every Wednesday, 4:30 PM",
            meetingLocation: "Lab 204, CE Department",
            socialLinks: { instagram: "https://instagram.com/csi.ddu", linkedin: "https://www.linkedin.com/company/csi-ddu", github: "https://github.com/csi-ddu" }
        }
    });

    const gdg = await approvedClub({
        founder: diya,
        cofounders: [meera, rohan],
        mentor: shah,
        admin,
        president: diya,
        request: {
            name: "GDG on Campus DDU",
            category: "TECHNOLOGY",
            allDepartments: true,
            description:
                "Google Developer Groups on Campus at DDU: a community for every student who wants to learn Android, Flutter, Firebase, Cloud and AI with hands-on study jams and build solutions for local problems.",
            purpose: "Help students learn Google developer technologies and build real-world solutions together.",
            proposedActivities: "Study jams, I/O Extended, Solution Challenge mentoring, Flutter and Cloud workshops.",
            reason: "Students across departments want a structured way to learn modern developer tools."
        },
        profile: {
            logo: art.gdgLogo,
            coverImage: art.gdgCover,
            tagline: "Learn · Connect · Grow",
            website: "https://gdg.community.dev",
            contactEmail: diya.email,
            meetingSchedule: "Alternate Saturdays, 11:00 AM",
            meetingLocation: "Seminar Hall B",
            socialLinks: { instagram: "https://instagram.com/gdg.ddu", linkedin: "https://www.linkedin.com/company/gdg-on-campus-ddu", x: "https://x.com/gdgddu" }
        }
    });

    const shutter = await approvedClub({
        founder: kabir,
        cofounders: [rohan],
        mentor: desai,
        admin,
        president: kabir,
        request: {
            name: "ShutterBug",
            category: "ART",
            allDepartments: true,
            description:
                "ShutterBug is DDU's photography club. Photo walks, editing workshops, contests and exhibitions for everyone from phone photographers to DSLR enthusiasts.",
            purpose: "Grow a creative photography community and document campus life.",
            proposedActivities: "Monthly photo walks, Lightroom workshops, the Monsoon Frames contest and an annual exhibition.",
            reason: "Many students love photography but have no club to learn and share their work."
        },
        profile: {
            logo: art.shutterLogo,
            coverImage: art.shutterCover,
            tagline: "Every frame tells a story",
            contactEmail: kabir.email,
            meetingSchedule: "Fridays, 5:00 PM",
            meetingLocation: "Student Activity Centre",
            socialLinks: { instagram: "https://instagram.com/shutterbug.ddu", youtube: "https://youtube.com/@shutterbugddu" }
        }
    });

    // Approved by the admin, waiting for its mentor to appoint a president.
    const spectrum = await approvedClub({
        founder: diya,
        cofounders: [sneha],
        mentor: rao,
        admin,
        president: null,
        request: {
            name: "Spectrum",
            category: "CULTURAL",
            allDepartments: true,
            description: "Spectrum is the cultural club of DDU — dance, drama, music and fine arts under one roof, and the team behind the annual cultural fest.",
            purpose: "Celebrate every art form and give students a stage.",
            proposedActivities: "Garba night, drama festival, dance battles, art exhibitions and the annual cultural fest.",
            reason: "Cultural activities need one organised club to plan events across the year."
        }
    });
    await Club.updateOne({ _id: spectrum._id }, { logo: art.spectrumLogo });

    logger.info("Club roles and membership requests");
    await memberships.changeMemberRole(aarav, csi._id, meera._id, "VICE_PRESIDENT");
    await memberships.changeMemberRole(aarav, csi._id, kabir._id, "EVENT_COORDINATOR");
    await memberships.changeMemberRole(diya, gdg._id, meera._id, "MARKETING_COORDINATOR");
    await memberships.changeMemberRole(diya, gdg._id, rohan._id, "TECHNICAL_COORDINATOR");
    await approveJoin(diya, gdg, aarav, "I'd like to help with Cloud study jams.");
    await memberships.changeMemberRole(kabir, shutter._id, rohan._id, "MARKETING_COORDINATOR");
    await approveJoin(kabir, shutter, diya, "Phone photographer, keen to learn editing!");
    // Waiting for the presidents' decision.
    await memberships.requestToJoin(sneha, csi._id, "First-year CE student — I love competitive programming.");
    await memberships.requestToJoin(sneha, gdg._id, "Want to learn Flutter and build apps.");
    // Club bells for clubs Sneha follows without being a member.
    await subscriptions.setSubscription(sneha, shutter._id, true);

    logger.info("Club requests in progress");
    await clubRequests.submitRequest(rohan, {
        name: "Robotics Club",
        category: "TECHNOLOGY",
        departmentCodes: ["EC", "ME", "CE"],
        description: "Designing and building robots for campus showcases and national competitions like Robocon.",
        purpose: "Hands-on experience with electronics, mechanics and control systems.",
        proposedActivities: "Build nights, a robo-race, Arduino and ROS workshops.",
        reason: "There's no robotics community on campus yet.",
        foundingMemberEmails: [],
        proposedMentor: String(desai._id)
    });
    const ecell = await clubRequests.submitRequest(meera, {
        name: "E-Cell DDU",
        category: "ENTREPRENEURSHIP",
        allDepartments: true,
        description: "The entrepreneurship cell: startup talks, ideathons and mentoring for student founders.",
        purpose: "Encourage students to build startups and think like founders.",
        proposedActivities: "Ideathon, founder fireside chats, pitch practice, startup internship fair.",
        reason: "Student founders currently have no support network on campus.",
        foundingMemberEmails: [],
        proposedMentor: String(rao._id)
    });
    await clubRequests.verifyRequest(rao, ecell._id, "Strong proposal. Recommending approval.");
    const quiz = await clubRequests.submitRequest(sneha, {
        name: "Quiz Club",
        category: "LITERARY",
        departmentCodes: ["CE"],
        description: "General, tech and pop-culture quizzing.",
        purpose: "Build a quizzing culture.",
        proposedActivities: "Quizzes.",
        reason: "Quizzers need a club.",
        foundingMemberEmails: [],
        proposedMentor: String(mehta._id)
    });
    await clubRequests.requestChanges(mehta, quiz._id, "Nice idea! Please add a term-wise activity plan and at least two founding members.");

    logger.info("Events across the lifecycle");
    // CSI — team hackathon (upcoming), completed contest with round-wise and final results, workshop with pending edits,
    // one event waiting for the mentor and one draft.
    const hackNight = await publishedEvent({
        club: csi,
        actor: aarav,
        mentor: mehta,
        venue: auditorium._id,
        title: "HackNight 2026",
        shortDescription: "An overnight hackathon — build something amazing with your team in 12 hours.",
        description:
            "Form a team of 2–4 and build a project around this year's theme: smarter campus life. Industry mentors stay all night, with food, swag and prizes for the top three teams.\n\nThe team leader registers the team and invites teammates, who join by accepting the invite.",
        category: "COMPETITION",
        poster: await poster(THEME.csi, "hacknight", { kicker: "CSI DDU presents", title: "HackNight 2026", lines: [`${nice(12)} · 6 PM – 11:30 PM`, "Auditorium · Teams of 2–4"], footer: "Prizes worth ₹30,000 · Register now" }),
        eventDate: day(12),
        startTime: "18:00",
        endTime: "23:30",
        registrationEnd: deadline(10),
        maxParticipants: 30,
        participationMode: "TEAM",
        minTeamSize: 2,
        maxTeamSize: 4,
        rules: "Teams of 2–4 members.\nAll code must be written during the event.\nBring your own laptop and charger.\nOne submission per team.",
        contact: { name: "Aarav Patel", email: aarav.email, phone: "9825011001" }
    });

    const codeSprint = await publishedEvent({
        club: csi,
        actor: aarav,
        mentor: mehta,
        venue: hallB._id,
        title: "CodeSprint 2026",
        shortDescription: "A two-round competitive programming contest.",
        description: "An online qualifier round followed by an on-site final. Individual participation, six problems per round.",
        category: "COMPETITION",
        poster: await poster(THEME.csi, "codesprint", { kicker: "CSI DDU", title: "CodeSprint 2026", lines: ["Qualifier + Final", "Seminar Hall B"], footer: "Individual contest · Certificates for all" }),
        eventDate: day(20),
        startTime: "10:00",
        endTime: "13:00",
        registrationEnd: deadline(18),
        maxParticipants: 60
    });
    for (const student of [meera, kabir, rohan, sneha, diya]) {
        await register(student, codeSprint);
    }
    const qualifier = await results.createRound(kabir, codeSprint._id, {
        name: "Round 1 · Online qualifier",
        description: "Six problems in 90 minutes. The top four go through to the final.",
        entries: [
            { rank: 1, recipientUser: meera._id, score: "580", qualified: true },
            { rank: 2, recipientUser: sneha._id, score: "545", qualified: true },
            { rank: 3, recipientUser: kabir._id, score: "510", qualified: true },
            { rank: 4, recipientUser: rohan._id, score: "470", qualified: true },
            { rank: 5, recipientUser: diya._id, score: "390", qualified: false }
        ]
    });
    await results.publishRound(aarav, codeSprint._id, qualifier.rounds[0]._id);
    await moveToPast(codeSprint._id, 6);
    await markAttended(await Event.findById(codeSprint._id), [meera, kabir, rohan, sneha], kabir);
    await events.completeEvent(aarav, codeSprint._id);
    await results.upsertResult(kabir, codeSprint._id, {
        summary: "48 students took part across two rounds. A tight final — congratulations to our winners and thank you to every participant!",
        awards: [
            { title: "Winner", position: 1, recipientUser: meera._id, prize: "₹5,000 + CSI goodies" },
            { title: "Runner-up", position: 2, recipientUser: sneha._id, prize: "₹3,000" },
            { title: "Second runner-up", position: 3, recipientUser: kabir._id, prize: "₹1,500" },
            { title: "Best first-year coder", recipientUser: sneha._id, prize: "Mechanical keyboard" }
        ]
    });
    await results.publishResult(aarav, codeSprint._id);

    const webDev = await publishedEvent({
        club: csi,
        actor: aarav,
        mentor: mehta,
        venue: hallA._id,
        title: "Web Dev Bootcamp",
        shortDescription: "Build and deploy your first full-stack web app in one afternoon.",
        description: "HTML, CSS and JavaScript refresher, then React and a Node.js API, and finally deploying to the cloud. Laptops required.",
        category: "WORKSHOP",
        poster: await poster(THEME.csi, "webdev", { kicker: "CSI DDU workshop", title: "Web Dev Bootcamp", lines: [`${nice(8)} · 2 PM`, "Seminar Hall A"], footer: "React · Node.js · Deploy" }),
        eventDate: day(8),
        startTime: "14:00",
        endTime: "17:00",
        registrationEnd: deadline(7),
        maxParticipants: 80
    });
    await register(kabir, webDev);
    await register(sneha, webDev);
    // Proposed changes waiting for the mentor: the live event stays as it is until approved and published.
    await events.updateEvent(aarav, webDev._id, {
        title: "Web Dev Bootcamp: React + Node",
        startTime: "15:00",
        endTime: "18:00",
        updateNote: "We're starting an hour later so the morning labs can finish on time."
    });

    const git = await events.createDraft(kabir, {
        club: csi._id,
        venue: hallB._id,
        title: "Git & GitHub Masterclass",
        shortDescription: "Branches, pull requests and resolving merge conflicts — hands-on.",
        description: "Beginner-friendly session covering commits, branching strategies, pull requests and open-source contribution.",
        category: "WORKSHOP",
        poster: await poster(THEME.csi, "git", { kicker: "CSI DDU", title: "Git & GitHub Masterclass", lines: [`${nice(16)} · 11 AM`], footer: "Beginners welcome" }),
        eventDate: day(16),
        startTime: "11:00",
        endTime: "13:00",
        registrationEnd: deadline(14),
        maxParticipants: 70,
        eligibility: { departments: ["CE", "IT"], batches: [], notes: "Bring a laptop with Git installed" }
    });
    await events.submitEvent(kabir, git._id);

    await events.createDraft(aarav, {
        club: csi._id,
        venue: hallA._id,
        title: "Cloud Computing Guest Talk",
        shortDescription: "An engineer from a cloud company on building systems at scale.",
        description: "Talk and Q&A. Speaker to be confirmed.",
        category: "SEMINAR",
        eventDate: day(26),
        startTime: "11:00",
        endTime: "12:30",
        registrationEnd: deadline(24)
    });

    // GDG — full event with a waitlist, one approved (ready to publish), one sent back for changes, one cancelled.
    const ioExtended = await publishedEvent({
        club: gdg,
        actor: diya,
        mentor: shah,
        venue: hallB._id,
        title: "Google I/O Extended DDU",
        shortDescription: "Watch the I/O keynote together, then live demos of Gemini, Android and Flutter.",
        description: "Keynote watch party, lightning talks by students and a hands-on Gemini API demo. Limited seats!",
        category: "TECHNOLOGY",
        poster: await poster(THEME.gdg, "io-extended", { kicker: "GDG on Campus DDU", title: "Google I/O Extended", lines: [`${nice(4)} · 3 PM`, "Seminar Hall B"], footer: "Limited seats · Snacks provided" }),
        eventDate: day(4),
        startTime: "15:00",
        endTime: "18:00",
        registrationEnd: deadline(3),
        maxParticipants: 3
    });
    for (const student of [aarav, meera, kabir, sneha, rohan]) {
        await register(student, ioExtended);
    }

    const studyJam = await events.createDraft(diya, {
        club: gdg._id,
        venue: hallA._id,
        title: "Android Study Jam",
        shortDescription: "Four weeks of guided Android development with Kotlin and Jetpack Compose.",
        description: "Weekly sessions with mentors; complete the Android Basics pathway and build an app.",
        category: "WORKSHOP",
        poster: await poster(THEME.gdg, "study-jam", { kicker: "GDG on Campus DDU", title: "Android Study Jam", lines: ["Kotlin · Jetpack Compose"], footer: "4 weeks · Certificates" }),
        eventDate: day(22),
        startTime: "10:00",
        endTime: "12:00",
        registrationEnd: deadline(20),
        maxParticipants: 100
    });
    await events.submitEvent(diya, studyJam._id);
    await events.approveEvent(shah, studyJam._id, "Approved — publish when your mentors are confirmed.");

    const flutter = await events.createDraft(diya, {
        club: gdg._id,
        venue: auditorium._id,
        title: "Flutter Forward",
        shortDescription: "Build a cross-platform app in a day.",
        description: "A full-day Flutter workshop.",
        category: "WORKSHOP",
        eventDate: day(28),
        startTime: "09:00",
        endTime: "17:00",
        registrationEnd: deadline(26),
        maxParticipants: 300
    });
    await events.submitEvent(diya, flutter._id);
    await events.requestEventChanges(shah, flutter._id, "A full day in the auditorium is a lot — please book Seminar Hall A for a half-day session and add the agenda.");

    const solution = await publishedEvent({
        club: gdg,
        actor: diya,
        mentor: shah,
        venue: hallA._id,
        title: "Solution Challenge Info Session",
        shortDescription: "Everything about the Google Solution Challenge and forming a team.",
        description: "Timeline, judging criteria and team formation.",
        category: "SEMINAR",
        eventDate: day(9),
        startTime: "16:00",
        endTime: "17:00",
        registrationEnd: deadline(8),
        maxParticipants: 100
    });
    await register(rohan, solution);
    await events.cancelEvent(diya, solution._id, "The speaker had to travel. We'll combine this with the Study Jam kickoff instead.");

    // ShutterBug — happening right now, a completed contest with winners, and a rejected proposal.
    const photoWalk = await publishedEvent({
        club: shutter,
        actor: kabir,
        mentor: desai,
        venue: hallA._id,
        title: "Heritage Photo Walk",
        shortDescription: "Capture DDU's heritage buildings in golden-hour light.",
        description: "We meet at Seminar Hall A for a quick composition briefing, then walk the campus and old town. Any camera — phones welcome!",
        category: "ART",
        poster: await poster(THEME.shutter, "photo-walk", { kicker: "ShutterBug", title: "Heritage Photo Walk", lines: ["Golden hour · Any camera"], footer: "Meet at Seminar Hall A" }),
        eventDate: day(2),
        startTime: "16:00",
        endTime: "19:00",
        registrationEnd: deadline(1, "12:00"),
        maxParticipants: 40
    });
    for (const student of [diya, sneha, meera]) {
        await register(student, photoWalk);
    }
    await makeLive(photoWalk._id);
    // Doors are open: two students have already been scanned in.
    await checkIn.openCheckIn(kabir, photoWalk._id);
    for (const student of [diya, sneha]) {
        const registration = await EventRegistrationModel.findOne({ event: photoWalk._id, user: student._id });
        await checkIn.markAttendance(kabir, photoWalk._id, { registrationId: registration._id }, "QR");
    }

    const monsoon = await publishedEvent({
        club: shutter,
        actor: kabir,
        mentor: desai,
        venue: hallA._id,
        title: "Monsoon Frames Photo Contest",
        shortDescription: "Show us the monsoon through your lens.",
        description: "Submit up to three photos on the theme 'Monsoon'. Judged by professional photographers.",
        category: "COMPETITION",
        poster: await poster(THEME.shutter, "monsoon", { kicker: "ShutterBug contest", title: "Monsoon Frames", lines: ["Theme: Monsoon"], footer: "Prizes + exhibition" }),
        eventDate: day(24),
        startTime: "11:00",
        endTime: "13:00",
        registrationEnd: deadline(22),
        maxParticipants: 50
    });
    for (const student of [sneha, diya, aarav, meera]) {
        await register(student, monsoon);
    }
    await moveToPast(monsoon._id, 12, "11:00", "13:00");
    await markAttended(await Event.findById(monsoon._id), [sneha, diya, aarav], rohan);
    await events.completeEvent(kabir, monsoon._id);
    await results.upsertResult(kabir, monsoon._id, {
        summary: "Over 120 photos were submitted. Our judges loved the storytelling in this year's entries — the winning photos will be exhibited in the library foyer.",
        awards: [
            { title: "Best Photograph", position: 1, recipientUser: sneha._id, prize: "₹4,000" },
            { title: "Runner-up", position: 2, recipientUser: diya._id, prize: "₹2,000" },
            { title: "Jury's choice", position: 3, recipientUser: aarav._id, prize: "Photo book" }
        ]
    });
    await results.publishResult(kabir, monsoon._id);

    const portrait = await events.createDraft(kabir, {
        club: shutter._id,
        venue: auditorium._id,
        title: "Late Night Portrait Shoot",
        shortDescription: "Portrait lighting session in the auditorium.",
        description: "Studio lights and models, 9 PM to 1 AM.",
        category: "ART",
        eventDate: day(15),
        startTime: "21:00",
        endTime: "23:59",
        registrationEnd: deadline(13)
    });
    await events.submitEvent(kabir, portrait._id);
    await events.rejectEvent(desai, portrait._id, "Late-night sessions in the auditorium aren't permitted. Please propose a daytime slot.");

    logger.info("Teams");
    // Byte Busters is complete; Null Pointers still needs a member and has a pending invite.
    const bytes = await register(meera, hackNight, { teamName: "Byte Busters", invitees: [String(kabir._id), String(sneha._id)] });
    await teams.respondToInvite(kabir, hackNight._id, bytes.team._id, true);
    await register(rohan, hackNight, { teamName: "Null Pointers", invitees: [String(diya._id)] });

    logger.info("Feed posts");
    await feed.createPost(aarav, {
        club: csi._id,
        type: "ANNOUNCEMENT",
        title: "CSI core team recruitment is open",
        body: "We're looking for event managers, designers and content writers for 2026–27. Fill the form at our desk in Lab 204 by Friday!",
        image: await poster(THEME.csi, "recruitment", { kicker: "CSI DDU", title: "We're hiring!", lines: ["Core team 2026–27"], footer: "Apply by Friday · Lab 204" })
    });
    await feed.createPost(meera, {
        club: gdg._id,
        type: "CLUB_UPDATE",
        title: "Organiser meeting on Saturday",
        body: "All GDG organisers: we'll plan the Study Jam mentors and I/O Extended seating. 11 AM, Seminar Hall B.",
        visibility: "MEMBERS"
    });
    await feed.createPost(kabir, {
        club: shutter._id,
        type: "ANNOUNCEMENT",
        title: "Photo of the week 📸",
        body: "This week's pick comes from Sneha's monsoon series. Tag us on Instagram for a chance to be featured next week!",
        image: photo("shutterbug-photo-of-week", 1200, 900)
    });
    await events.updateEvent(aarav, hackNight._id, { updateNote: "Problem statements are live on the notice board, and dinner will be served at 9 PM." });

    logger.info("Stories");
    const storyCount = await loadStories(cast);

    return { cast, storyCount };
};

// ---------------------------------------------------------------- Run

const run = async () => {
    if (!args.has("--confirm")) {
        throw new Error("This writes demo data into the database in MONGO_URI. Run again with --confirm.");
    }
    validateEnv();
    assertCloudinary();
    await connectDB();
    logger.info("Showcase target", { database: mongoose.connection.name, host: mongoose.connection.host });
    await seedReferenceData();

    if (args.has("--stories")) {
        const cast = {};
        for (const [key, person] of Object.entries(STUDENTS)) {
            cast[key] = await User.findOne({ email: `${person.local}@${DOMAIN}` });
        }
        if (!cast.aarav) {
            throw new Error("The showcase isn't loaded yet. Run without --stories first.");
        }
        const old = await Story.find({ club: { $in: (await Club.find({ name: { $in: CLUB_NAMES } })).map((club) => club._id) } }).select("_id");
        await StoryView.deleteMany({ story: { $in: old.map((story) => story._id) } });
        await Story.deleteMany({ _id: { $in: old.map((story) => story._id) } });
        logger.info("Stories refreshed", { stories: await loadStories(cast) });
        return;
    }

    if (args.has("--reset")) {
        await resetShowcase();
    } else if (await User.exists({ email: { $in: DEMO_EMAILS } })) {
        logger.info("The showcase is already loaded. Use --reset to load it again, or --stories to refresh stories.");
        return;
    }

    const started = Date.now();
    const { cast, storyCount } = await loadShowcase();
    logger.info(`Showcase loaded in ${Math.round((Date.now() - started) / 1000)}s`, { stories: storyCount, password: PASSWORD });
    console.table(
        Object.entries(cast).map(([, user]) => ({ name: user.name, email: user.email, role: user.globalRole }))
    );
};

run()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
        logger.error("Showcase seed failed", { message: error.message, stack: error.stack });
        await mongoose.disconnect();
        process.exit(1);
    });

