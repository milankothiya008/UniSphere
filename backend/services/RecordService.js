const Certificate = require("../models/Certificate");
require("../models/Club");
require("../models/Event");
const ClubMembership = require("../models/ClubMembership");
const EventRegistration = require("../models/EventRegistration");
const EventResult = require("../models/EventResult");
const Team = require("../models/Team");
const User = require("../models/User");
const { env } = require("../config/env");
const { EVENT_STATUS, REGISTRATION_STATUS, RESULT_STATUS, CHECK_IN_STATUS, TEAM_STATUS, TEAM_MEMBER_STATUS, MEMBERSHIP_STATUS } = require("../constants/Statuses");
const { roleName } = require("../utils/ClubRoles");
const { formatDate } = require("../utils/CampusTime");
const { renderPdf, table, dateRange, NAVY, GOLD, INK, MUTED } = require("../utils/Pdf");

// A student's participation record: clubs and roles, events they took part in, awards and certificates —
// the document students attach to placement and scholarship applications.

const idOf = (value) => String(value?._id || value || "");
const humanize = (value) => String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const collectRecord = async (userId) => {
    const now = new Date();
    const [user, memberships, registrations, teams, certificates] = await Promise.all([
        User.findById(userId).select("name email departmentCode batchCode accountType createdAt").lean(),
        ClubMembership.find({ user: userId, status: MEMBERSHIP_STATUS.APPROVED }).populate("club", "name roles status").lean(),
        EventRegistration.find({ user: userId, status: REGISTRATION_STATUS.REGISTERED })
            .populate({ path: "event", select: "title category startAt endAt status checkIn club participationMode", populate: { path: "club", select: "name" } })
            .populate("team", "name")
            .lean(),
        Team.find({ status: TEAM_STATUS.ACTIVE, members: { $elemMatch: { user: userId, status: { $in: [TEAM_MEMBER_STATUS.LEADER, TEAM_MEMBER_STATUS.ACCEPTED] } } } })
            .select("event name")
            .lean(),
        Certificate.find({ user: userId, revokedAt: null }).sort({ eventStartAt: -1 }).lean()
    ]);

    // Events that have happened: completed, or published and already over.
    const events = registrations
        .filter((row) => row.event && (row.event.status === EVENT_STATUS.COMPLETED || (row.event.status === EVENT_STATUS.PUBLISHED && row.event.endAt <= now)))
        .map((row) => {
            const checkInUsed = row.event.checkIn?.status && row.event.checkIn.status !== CHECK_IN_STATUS.NOT_STARTED;
            return {
                eventId: row.event._id,
                title: row.event.title,
                club: row.event.club?.name || "",
                category: humanize(row.event.category),
                startAt: row.event.startAt,
                endAt: row.event.endAt,
                team: row.team?.name || null,
                attendance: row.checkedInAt ? "Attended" : checkInUsed ? "Absent" : "Registered"
            };
        })
        .filter((row) => row.attendance !== "Absent")
        .sort((a, b) => b.startAt - a.startAt);

    const teamNames = new Map(teams.map((team) => [idOf(team.event), team.name.toLowerCase()]));
    const results = await EventResult.find({
        status: RESULT_STATUS.PUBLISHED,
        $or: [{ "awards.recipientUser": userId }, { event: { $in: teams.map((team) => team.event) } }]
    })
        .populate({ path: "event", select: "title startAt endAt club", populate: { path: "club", select: "name" } })
        .lean();
    const awards = results
        .flatMap((result) =>
            result.awards
                .filter((award) => idOf(award.recipientUser) === idOf(userId) || (award.teamName && award.teamName.toLowerCase() === teamNames.get(idOf(result.event?._id))))
                .map((award) => ({ title: award.title, position: award.position, team: award.teamName, event: result.event?.title || "", club: result.event?.club?.name || "", date: result.event?.startAt }))
        )
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    const clubs = memberships
        .filter((membership) => membership.club)
        .map((membership) => ({ club: membership.club.name, role: roleName(membership.club, membership.role), since: membership.joinedAt || membership.createdAt }));

    return { user, clubs, events, awards, certificates };
};

/** The record as a PDF. */
const recordPdf = async (actor) => {
    const record = await collectRecord(actor._id);
    const { user } = record;
    const pdf = await renderPdf({ size: "A4", margin: 48, info: { Title: `Participation record — ${user.name}` } }, (doc) => {
        const width = doc.page.width - 96;
        doc.rect(0, 0, doc.page.width, 8).fill(NAVY);
        doc.rect(0, 8, doc.page.width, 2).fill(GOLD);
        doc.y = 40;
        doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text(`${env.universityName.toUpperCase()} · CAMPUSCONNECT`, 48, doc.y, { characterSpacing: 1.5 });
        doc.moveDown(0.6);
        doc.fillColor(NAVY).font("Times-Bold").fontSize(26).text("Participation record");
        doc.moveDown(0.3);
        doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text(user.name);
        doc.fillColor(MUTED)
            .font("Helvetica")
            .fontSize(10)
            .text([user.departmentCode, user.batchCode && `Batch 20${user.batchCode}`, user.email].filter(Boolean).join("  ·  "));
        doc.moveDown(0.6);

        const statsY = doc.y;
        [
            ["Events", record.events.length],
            ["Awards", record.awards.length],
            ["Clubs", record.clubs.length],
            ["Certificates", record.certificates.length]
        ].forEach(([label, value], index) => {
            const x = 48 + index * (width / 4);
            doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(18).text(String(value), x, statsY, { width: width / 4 });
            doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(label, x, statsY + 22, { width: width / 4 });
        });
        doc.y = statsY + 44;
        doc.moveTo(48, doc.y).lineTo(48 + width, doc.y).lineWidth(0.6).strokeColor("#d8dce6").stroke();
        doc.moveDown(1);

        const section = (title) => {
            if (doc.y > doc.page.height - 140) doc.addPage();
            doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(title, 48, doc.y);
            doc.moveDown(0.5);
        };

        section("Clubs and roles");
        table(doc, {
            x: 48,
            columns: [
                { label: "Club", width: width * 0.5, bold: true },
                { label: "Role", width: width * 0.3 },
                { label: "Since", width: width * 0.2 }
            ],
            rows: record.clubs.map((row) => [row.club, row.role, formatDate(row.since)]),
            empty: "Not a member of any club yet."
        });

        section("Awards and achievements");
        table(doc, {
            x: 48,
            columns: [
                { label: "Award", width: width * 0.3, bold: true },
                { label: "Event", width: width * 0.4 },
                { label: "Club", width: width * 0.3 }
            ],
            rows: record.awards.map((row) => [`${row.title}${row.team ? ` (team ${row.team})` : ""}`, `${row.event}${row.date ? `, ${formatDate(row.date)}` : ""}`, row.club]),
            empty: "No awards yet."
        });

        section("Events");
        table(doc, {
            x: 48,
            columns: [
                { label: "Date", width: width * 0.2 },
                { label: "Event", width: width * 0.38, bold: true },
                { label: "Club", width: width * 0.27 },
                { label: "Status", width: width * 0.15 }
            ],
            rows: record.events.map((row) => [dateRange(row.startAt, row.endAt), `${row.title}${row.team ? `\nTeam ${row.team}` : ""}`, row.club, row.attendance]),
            empty: "No events yet."
        });

        section("Certificates");
        table(doc, {
            x: 48,
            columns: [
                { label: "Certificate", width: width * 0.32, bold: true },
                { label: "Event", width: width * 0.4 },
                { label: "ID", width: width * 0.28 }
            ],
            rows: record.certificates.map((row) => [row.kind === "MERIT" ? `Merit — ${row.awardTitle}` : "Participation", row.eventTitle, row.code]),
            empty: "No certificates yet."
        });

        doc.fillColor(MUTED)
            .font("Helvetica")
            .fontSize(8.5)
            .text(
                `Generated on ${formatDate(new Date())} from CampusConnect records. Certificates can be verified at ${env.clientUrl.replace(/\/$/, "")}/verify/<ID>. "Attended" means checked in at the event; "Registered" means the club didn't record attendance.`,
                48,
                doc.y + 6,
                { width }
            );
    });
    return { pdf, filename: `${user.name.replace(/[^\w-]+/g, "_")}_participation_record.pdf` };
};

module.exports = { collectRecord, recordPdf };
