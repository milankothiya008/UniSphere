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

const signAccessToken = (payload) => {
    return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.accessTokenExpiry });
};

const signRefreshToken = (payload) => {
    return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.refreshTokenExpiry });
};

const verifyAccessToken = (token) => jwt.verify(token, env.jwtAccessSecret);

const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

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
