const QRCode = require("qrcode");
const Event = require("../models/Event");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { REGISTRATION_STATUS, AUDIT_ACTIONS } = require("../constants/Statuses");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { formatDateKey } = require("../utils/UniversityRules");
const { generateTicketCode, createTicketToken, readTicketToken } = require("../utils/TicketToken");
const { recordAudit } = require("./AuditService");
const { emailUsers } = require("./NotificationService");
const logger = require("../utils/Logger");

// Tickets: every registration that holds a place carries a ticket code and a signed QR token
// (utils/TicketToken). The ticket is shown in the app and emailed with the QR image; club officers
// scan or type it at the door (services/CheckInService).

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2 };
const MAX_CODE_ATTEMPTS = 3;

// The fields written whenever a registration (re)enters REGISTERED: a fresh code, and no attendance yet.
const ticketFields = (now = new Date()) => ({
    ticketCode: generateTicketCode(),
    ticketIssuedAt: now,
    checkedInAt: null,
    checkedInBy: null,
    checkInMethod: null,
    checkInNote: null
});

// Runs a registration write with freshly generated ticket fields, regenerating the code on the (very rare)
// duplicate-code error. Any other duplicate error is rethrown so callers keep their "already registered" handling.
const withTicketRetry = async (write) => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await write(ticketFields());
        } catch (error) {
            if (error.code === 11000 && error.keyPattern?.ticketCode && attempt < MAX_CODE_ATTEMPTS) {
                continue;
            }
            throw error;
        }
    }
};

// Registrations made before tickets existed get a code the first time their ticket is opened.
const ensureTicket = async (registration) => {
    if (registration.status !== REGISTRATION_STATUS.REGISTERED || registration.ticketCode) {
        return registration;
    }
    const updated = await withTicketRetry(({ ticketCode, ticketIssuedAt }) =>
        EventRegistration.findOneAndUpdate(
            { _id: registration._id, status: REGISTRATION_STATUS.REGISTERED, ticketCode: { $exists: false } },
            { $set: { ticketCode, ticketIssuedAt } },
            { returnDocument: "after" }
        )
    );
    if (updated) {
        await recordAudit({
            action: AUDIT_ACTIONS.TICKET_ISSUED,
            actor: registration.user,
            targetType: "EventRegistration",
            targetId: registration._id,
            metadata: { eventId: registration.event, reason: "backfill" }
        });
    }
    return updated || EventRegistration.findById(registration._id);
};

const EVENT_FIELDS = "title startAt endAt eventDate startTime endTime venue club poster participationMode status";

const loadTicketEvent = (eventId) => Event.findById(eventId).select(EVENT_FIELDS).populate("venue", "name location").populate("club", "name logo");

const whenLabel = (event) => `${formatDateKey(event.eventDate)}, ${event.startTime}–${event.endTime}`;
const whereLabel = (event) => (event.venue ? [event.venue.name, event.venue.location].filter(Boolean).join(", ") : "");

const tokenFor = (registration) => createTicketToken({ registrationId: registration._id, ticketCode: registration.ticketCode });

// The signed-in student's ticket for an event (only while they hold a place).
const getMyTicket = async (actor, eventId) => {
    const found = await EventRegistration.findOne({ event: eventId, user: actor._id, status: REGISTRATION_STATUS.REGISTERED }).populate("team", "name");
    if (!found) {
        throw new AppError("You don't have a ticket for this event", 404, ERROR_CODES.NOT_FOUND);
    }
    const registration = await ensureTicket(found);
    const event = await loadTicketEvent(eventId);
    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }
    const token = tokenFor(registration);

    return {
        registrationId: registration._id,
        ticketCode: registration.ticketCode,
        issuedAt: registration.ticketIssuedAt,
        checkedInAt: registration.checkedInAt,
        checkInMethod: registration.checkInMethod,
        token,
        qrDataUrl: await QRCode.toDataURL(token, { ...QR_OPTIONS, width: 512 }),
        holder: { _id: actor._id, name: actor.name, email: actor.email },
        event: {
            _id: event._id,
            title: event.title,
            status: event.status,
            startAt: event.startAt,
            endAt: event.endAt,
            when: whenLabel(event),
            venue: event.venue ? { name: event.venue.name, location: event.venue.location } : null,
            club: event.club ? { _id: event.club._id, name: event.club.name, logo: event.club.logo } : null,
            poster: event.poster,
            participationMode: event.participationMode
        },
        team: found.team ? { name: found.team.name, role: registration.teamRole } : null
    };
};

// The QR image linked from ticket emails. Stateless: a valid signature is all that is needed to draw it;
// whether the ticket still counts is decided when it is scanned.
const renderTicketPng = async (token) => {
    if (!readTicketToken(token)) {
        throw new AppError("Ticket not found", 404, ERROR_CODES.NOT_FOUND);
    }
    return QRCode.toBuffer(token, { ...QR_OPTIONS, type: "png", width: 360 });
};

const SUBJECTS = {
    registered: (event) => `Your ticket for ${event.title}`,
    team: (event, team) => `Your ticket for ${event.title}${team ? ` · team "${team.name}"` : ""}`,
    // Wording kept in step with the earlier promotion email.
    promoted: (event) => `You're in! A spot opened up for ${event.title}`
};

const PARAGRAPHS = {
    registered: () => ["You're registered. Show the QR code below at the entrance, or read out your ticket code."],
    team: (team) => [
        `You're registered${team ? ` with team "${team.name}"` : ""}. Every team member has their own ticket — show the QR code below at the entrance, or read out your ticket code.`
    ],
    promoted: () => [
        "You've moved off the waitlist and are now registered. If you can no longer make it, cancel so the next person gets your seat.",
        "Show the QR code below at the entrance, or read out your ticket code."
    ]
};

// Emails the ticket (QR image + code) to the student. Never throws: registration must succeed even if mail fails.
const sendTicketEmail = async (registrationId, { reason = "registered" } = {}) => {
    try {
        const registration = await EventRegistration.findById(registrationId).populate("team", "name");
        if (!registration || registration.status !== REGISTRATION_STATUS.REGISTERED || !registration.ticketCode) {
            return 0;
        }
        const event = await loadTicketEvent(registration.event);
        if (!event) {
            return 0;
        }
        const token = tokenFor(registration);
        const team = registration.team;
        const subject = (SUBJECTS[reason] || SUBJECTS.registered)(event, team);
        const paragraphs = (PARAGRAPHS[reason] || PARAGRAPHS.registered)(team);

        return await emailUsers([registration.user], {
            category: EMAIL_CATEGORIES.ACCOUNT,
            dedupeKey: () => `ticket:${registration._id}:${registration.ticketCode}`,
            compose: (user) => ({
                subject,
                heading: subject,
                paragraphs,
                details: [
                    ["Event", event.title],
                    ["When", whenLabel(event)],
                    ["Where", whereLabel(event)],
                    ["Ticket holder", user.name],
                    ["Team", team ? team.name : null]
                ],
                code: registration.ticketCode,
                qr: { src: `/api/tickets/${token}/qr.png`, alt: `QR ticket ${registration.ticketCode}` },
                action: { label: "Open your ticket", url: `/events/${event._id}?ticket=1` }
            })
        });
    } catch (error) {
        logger.error("Ticket email failed", { registrationId: String(registrationId), reason, message: error.message });
        return 0;
    }
};

module.exports = { ticketFields, withTicketRetry, ensureTicket, getMyTicket, renderTicketPng, sendTicketEmail, tokenFor };
