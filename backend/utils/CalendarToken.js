const crypto = require("crypto");
const { env } = require("../config/env");

// The private address of someone's calendar feed. Calendar apps fetch it without signing in, so it carries
// a signature over the user and their current key version; "Reset link" bumps the version, which makes
// every older address stop working.

const sign = (userId, version) =>
    crypto.createHmac("sha256", `${env.jwtAccessSecret}:calendar`).update(`${userId}:${version}`).digest("base64url").slice(0, 32);

const createCalendarToken = (userId, version = 0) => `${Buffer.from(String(userId)).toString("base64url")}.${sign(userId, version)}`;

/** The user id the token names, or null when it's malformed. The signature is checked by matchesCalendarToken. */
const readCalendarToken = (token) => {
    const [encoded, signature] = String(token || "").split(".");
    if (!encoded || !signature) return null;
    const userId = Buffer.from(encoded, "base64url").toString("utf8");
    return /^[a-f0-9]{24}$/i.test(userId) ? { userId, signature } : null;
};

const matchesCalendarToken = (token, userId, version = 0) => {
    const parsed = readCalendarToken(token);
    if (!parsed || parsed.userId !== String(userId)) return false;
    const expected = Buffer.from(sign(userId, version));
    const actual = Buffer.from(parsed.signature);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

module.exports = { createCalendarToken, readCalendarToken, matchesCalendarToken };
