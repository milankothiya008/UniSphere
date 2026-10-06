const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const parseExpiryToMs = (value, fallbackMs) => {
    if (!value) {
        return fallbackMs;
    }

    if (/^\d+$/.test(value)) {
        return Number(value) * 1000;
    }

    const match = String(value).match(/^(\d+)([smhd])$/);
    if (!match) {
        return fallbackMs;
    }

    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

    return amount * multipliers[unit];
};

// The secrets as ready-made key objects. Given a plain string, jsonwebtoken first tries (and fails) to read it
// as a public key on every call, which is costly when every request checks a token. Same secrets, same tokens.
const keyCache = new Map();
const keyFor = (secret) => {
    if (typeof secret !== "string" || !secret) return secret;
    let key = keyCache.get(secret);
    if (!key) {
        key = crypto.createSecretKey(Buffer.from(secret));
        keyCache.set(secret, key);
    }
    return key;
};

const signAccessToken = (payload) => {
    return jwt.sign(payload, keyFor(env.jwtAccessSecret), { expiresIn: env.accessTokenExpiry });
};

const signRefreshToken = (payload) => {
    return jwt.sign(payload, keyFor(env.jwtRefreshSecret), { expiresIn: env.refreshTokenExpiry });
};

const verifyAccessToken = (token) => jwt.verify(token, keyFor(env.jwtAccessSecret));

const verifyRefreshToken = (token) => jwt.verify(token, keyFor(env.jwtRefreshSecret));

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const generateRawToken = () => crypto.randomBytes(32).toString("hex");

const OTP_LENGTH = 6;

const generateOtp = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

// Codes are short, so the hash is keyed with a server secret and bound to the user.
const hashOtp = (userId, code) =>
    crypto.createHmac("sha256", env.jwtAccessSecret).update(`${userId}:${code}`).digest("hex");

const otpMatches = (userId, code, storedHash) => {
    if (!storedHash) {
        return false;
    }
    const expected = Buffer.from(storedHash, "hex");
    const actual = Buffer.from(hashOtp(userId, code), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const refreshTokenTtlMs = () => parseExpiryToMs(env.refreshTokenExpiry, 7 * 24 * 60 * 60 * 1000);

module.exports = {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    hashToken,
    generateRawToken,
    OTP_LENGTH,
    generateOtp,
    hashOtp,
    otpMatches,
    refreshTokenTtlMs
};
