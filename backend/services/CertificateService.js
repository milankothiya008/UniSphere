const crypto = require("crypto");
const Certificate = require("../models/Certificate");
const Club = require("../models/Club");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const EventResult = require("../models/EventResult");
const Team = require("../models/Team");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS, REGISTRATION_STATUS, RESULT_STATUS, TEAM_STATUS, TEAM_MEMBER_STATUS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { certificatePdf } = require("../utils/Pdf");
const { notify } = require("./NotificationService");

// Certificates, when the president switches them on for an event:
//   PARTICIPATION — every student checked in at the event, once it has ended;
//   MERIT         — winners in the published final results (every member of a winning team).
// They're issued on first request with a code anyone can verify at /verify/<code>.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => `CERT-${Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("")}`;
const idOf = (value) => String(value?._id || value || "");

const hasEnded = (event, now = new Date()) => event.status === EVENT_STATUS.COMPLETED || (event.status === EVENT_STATUS.PUBLISHED && event.endAt <= now);

// The user's team names in this event (team awards name the team).
const teamNamesOf = async (eventId, userId) =>
    (
        await Team.find({ event: eventId, status: TEAM_STATUS.ACTIVE, members: { $elemMatch: { user: userId, status: { $in: [TEAM_MEMBER_STATUS.LEADER, TEAM_MEMBER_STATUS.ACCEPTED] } } } })
            .select("name")
            .lean()
    ).map((team) => team.name);

/** What the user can get for this event: [{ kind, awardTitle, teamName }]. */
const entitlementsFor = async (event, user) => {
    if (!event.certificatesEnabled || !hasEnded(event)) return [];
    const [registration, result, teams] = await Promise.all([
        EventRegistration.findOne({ event: event._id, user: user._id, status: REGISTRATION_STATUS.REGISTERED, checkedInAt: { $ne: null } }).select("team").lean(),
        EventResult.findOne({ event: event._id, status: RESULT_STATUS.PUBLISHED }).select("awards").lean(),
        teamNamesOf(event._id, user._id)
    ]);
    const list = [];
    const lowered = teams.map((name) => name.toLowerCase());
    if (registration) list.push({ kind: "PARTICIPATION", awardTitle: null, teamName: teams[0] || null });
    const award = (result?.awards || [])
        .filter((item) => idOf(item.recipientUser) === idOf(user._id) || (item.teamName && lowered.includes(item.teamName.toLowerCase())))
        .sort((a, b) => (a.position || 99) - (b.position || 99))[0];
    if (award) list.push({ kind: "MERIT", awardTitle: award.title, teamName: award.teamName || null });
    return list;
};

const issue = async (event, club, user, entitlement) => {
    const existing = await Certificate.findOne({ event: event._id, user: user._id, kind: entitlement.kind });
    if (existing) {
        // Keep the wording current (e.g. results corrected) while the code stays the same.
        if (existing.awardTitle !== entitlement.awardTitle || existing.revokedAt) {
            existing.awardTitle = entitlement.awardTitle;
            existing.teamName = entitlement.teamName;
            existing.revokedAt = null;
            await existing.save();
        }
        return existing;
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await Certificate.create({
                code: newCode(),
                event: event._id,
                club: club._id,
                user: user._id,
                kind: entitlement.kind,
                recipientName: user.name,
                eventTitle: event.title,
                clubName: club.name,
                eventStartAt: event.startAt,
                eventEndAt: event.endAt,
                awardTitle: entitlement.awardTitle,
                teamName: entitlement.teamName
            });
        } catch (error) {
            if (error.code !== 11000) throw error;
            const raced = await Certificate.findOne({ event: event._id, user: user._id, kind: entitlement.kind });
            if (raced) return raced;
        }
    }
    throw new AppError("Couldn't issue the certificate, please try again", 500, ERROR_CODES.CONFLICT);
};

const view = (certificate) => ({
    _id: certificate._id,
    code: certificate.code,
    kind: certificate.kind,
    event: certificate.event,
    eventTitle: certificate.eventTitle,
    clubName: certificate.clubName,
    eventStartAt: certificate.eventStartAt,
    eventEndAt: certificate.eventEndAt,
    awardTitle: certificate.awardTitle,
    teamName: certificate.teamName,
    issuedAt: certificate.issuedAt
});

/** The viewer's certificates for one event (issued on the spot if they qualify). */
const myCertificatesForEvent = async (actor, eventId) => {
    const event = await Event.findById(eventId);
    if (!event) throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    const entitlements = await entitlementsFor(event, actor);
    if (!entitlements.length) return { enabled: event.certificatesEnabled, items: [] };
    const club = await Club.findById(event.club).select("name");
    const user = await User.findById(actor._id).select("name");
    const items = [];
    for (const entitlement of entitlements) items.push(view(await issue(event, club, user, entitlement)));
    return { enabled: true, items };
};

/** Every certificate the student has, across events (issuing any they qualify for but haven't opened yet). */
const listMine = async (actor) => {
    const [attended, teams] = await Promise.all([
        EventRegistration.find({ user: actor._id, status: REGISTRATION_STATUS.REGISTERED, checkedInAt: { $ne: null } }).select("event").lean(),
        Team.find({ status: TEAM_STATUS.ACTIVE, members: { $elemMatch: { user: actor._id, status: { $in: [TEAM_MEMBER_STATUS.LEADER, TEAM_MEMBER_STATUS.ACCEPTED] } } } })
            .select("event")
            .lean()
    ]);
    const won = await EventResult.find({
        status: RESULT_STATUS.PUBLISHED,
        $or: [{ "awards.recipientUser": actor._id }, { event: { $in: teams.map((team) => team.event) } }]
    })
        .select("event")
        .lean();
    const eventIds = [...new Set([...attended.map((row) => idOf(row.event)), ...won.map((row) => idOf(row.event))])];
    const events = await Event.find({ _id: { $in: eventIds }, certificatesEnabled: true }).sort({ startAt: -1 });
    const items = [];
    for (const event of events) {
        const result = await myCertificatesForEvent(actor, event._id);
        items.push(...result.items);
    }
    return items;
};

const loadByCode = async (code) => Certificate.findOne({ code: String(code || "").trim().toUpperCase() });

/** Public check of a certificate code. */
const verify = async (code) => {
    const certificate = await loadByCode(code);
    if (!certificate) return { valid: false };
    return { valid: !certificate.revokedAt, revoked: Boolean(certificate.revokedAt), recipientName: certificate.recipientName, ...view(certificate) };
};

/** The PDF, for its owner. */
const certificateFile = async (actor, code) => {
    const certificate = await loadByCode(code);
    if (!certificate || idOf(certificate.user) !== idOf(actor._id)) throw new AppError("Certificate not found", 404, ERROR_CODES.NOT_FOUND);
    if (certificate.revokedAt) throw new AppError("This certificate has been withdrawn", 410, ERROR_CODES.INVALID_STATE);
    const club = await Club.findById(certificate.club).populate("president", "name").populate("mentor", "name").select("president mentor").lean();
    const pdf = await certificatePdf(certificate, { president: club?.president?.name, mentor: club?.mentor?.name });
    return { pdf, filename: `${certificate.eventTitle.replace(/[^\w-]+/g, "_")}_${certificate.kind === "MERIT" ? "merit" : "participation"}_certificate.pdf` };
};

// ---------------------------------------------------------------- Announcements

const link = (event) => `/events/${event._id}#certificates`;

/** Tells checked-in students their participation certificate is ready (when the event ends with certificates on). */
const announceCertificates = async (event) => {
    if (!event.certificatesEnabled) return;
    const attendees = (await EventRegistration.find({ event: event._id, status: REGISTRATION_STATUS.REGISTERED, checkedInAt: { $ne: null } }).select("user").lean()).map((row) => row.user);
    await notify(attendees, {
        type: NOTIFICATION_TYPES.CERTIFICATE_READY,
        title: `Your certificate for ${event.title} is ready`,
        message: "Download your participation certificate from the event page.",
        link: link(event),
        email: true,
        emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY
    });
};

/** Tells winners their merit certificate is ready (when final results are published). */
const announceMerit = async (event, result) => {
    if (!event.certificatesEnabled) return;
    const direct = result.awards.map((award) => award.recipientUser).filter(Boolean);
    const teamNames = result.awards.map((award) => award.teamName?.toLowerCase()).filter(Boolean);
    const teams = teamNames.length ? await Team.find({ event: event._id, status: TEAM_STATUS.ACTIVE }).select("name members").lean() : [];
    const members = teams
        .filter((team) => teamNames.includes(team.name.toLowerCase()))
        .flatMap((team) => team.members.filter((member) => [TEAM_MEMBER_STATUS.LEADER, TEAM_MEMBER_STATUS.ACCEPTED].includes(member.status)).map((member) => member.user));
    await notify([...direct, ...members], {
        type: NOTIFICATION_TYPES.CERTIFICATE_READY,
        title: `Your merit certificate for ${event.title} is ready`,
        message: "Congratulations! Download it from the event page.",
        link: link(event),
        email: true,
        emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY
    });
};

module.exports = { myCertificatesForEvent, listMine, verify, certificateFile, announceCertificates, announceMerit, entitlementsFor };
