const crypto = require("crypto");
const { env } = require("../config/env");

// Unsubscribe links work without signing in (as email clients expect), so each token is signed and
// names exactly one person and one thing to switch off: an email category ("pref") or a club's bell ("club").
const SCOPES = ["pref", "club"];

const sign = (payload) =>
    crypto.createHmac("sha256", `${env.jwtAccessSecret}:unsubscribe`).update(payload).digest("base64url").slice(0, 32);

const createUnsubscribeToken = ({ userId, scope, key }) => {
    const payload = Buffer.from(JSON.stringify({ u: String(userId), s: scope, k: String(key) })).toString("base64url");
    return `${payload}.${sign(payload)}`;
};

// Returns { userId, scope, key } or null when the token is malformed or tampered with.
const readUnsubscribeToken = (token) => {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || !signature) {
        return null;
    }

    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return null;
    }

    try {
        const { u, s, k } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return SCOPES.includes(s) && u && k ? { userId: u, scope: s, key: k } : null;
    } catch {
        return null;
    }
};

module.exports = { createUnsubscribeToken, readUnsubscribeToken };
