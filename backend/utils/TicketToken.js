const crypto = require("crypto");
const { env } = require("../config/env");

// Event tickets. Each registration that holds a place gets a short code (printed on the ticket and typed
// at the door when a QR can't be scanned) and a signed token (the QR's content). The signature covers the
// registration and its current code, so a QR from a cancelled registration fails as soon as it is scanned,
// before any database lookup.

// No 0/O, 1/I/L or U: easy to read out and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_PATTERN = /^CC-[A-HJ-NP-TV-Z2-9]{8}$/;
const ID_PATTERN = /^[a-f0-9]{24}$/;

const generateTicketCode = () => `CC-${Array.from({ length: 8 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("")}`;

// Accepts "cc-7k3m 9qwa", "CC7K3M9QWA" or "7K3M9QWA"; returns the canonical code or null.
const normalizeTicketCode = (input) => {
    const raw = String(input || "")
        .toUpperCase()
        .replace(/[\s-]/g, "");
    const body = raw.length === 10 && raw.startsWith("CC") ? raw.slice(2) : raw;
    const code = `CC-${body}`;
    return CODE_PATTERN.test(code) ? code : null;
};

const sign = (registrationId, ticketCode) =>
    crypto.createHmac("sha256", `${env.jwtAccessSecret}:ticket`).update(`${registrationId}:${ticketCode}`).digest("base64url").slice(0, 32);

const createTicketToken = ({ registrationId, ticketCode }) => `${registrationId}.${ticketCode}.${sign(String(registrationId), ticketCode)}`;

// Returns { registrationId, ticketCode } or null when the token is malformed or tampered with.
const readTicketToken = (token) => {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) {
        return null;
    }
    const [registrationId, ticketCode, signature] = parts;
    if (!ID_PATTERN.test(registrationId) || !CODE_PATTERN.test(ticketCode)) {
        return null;
    }
    const expected = Buffer.from(sign(registrationId, ticketCode));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
    }
    return { registrationId, ticketCode };
};

module.exports = { generateTicketCode, normalizeTicketCode, createTicketToken, readTicketToken, CODE_PATTERN };
