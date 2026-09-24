const AppError = require("./AppError");
const ERROR_CODES = require("../constants/ErrorCodes");

// Social profiles a club can list. Each link must point at the platform's own domain, so a
// "YouTube" button can never lead somewhere else.
const SOCIAL_PLATFORMS = Object.freeze({
    instagram: { label: "Instagram", hosts: ["instagram.com"] },
    linkedin: { label: "LinkedIn", hosts: ["linkedin.com", "lnkd.in"] },
    x: { label: "X (Twitter)", hosts: ["x.com", "twitter.com"] },
    youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
    facebook: { label: "Facebook", hosts: ["facebook.com", "fb.com", "fb.me"] },
    github: { label: "GitHub", hosts: ["github.com"] },
    discord: { label: "Discord", hosts: ["discord.gg", "discord.com"] },
    whatsapp: { label: "WhatsApp", hosts: ["chat.whatsapp.com", "whatsapp.com", "wa.me"] }
});

const MAX_URL_LENGTH = 300;

const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);

const matchesHost = (hostname, hosts) => hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

// Accepts "instagram.com/club" as well as full URLs, and returns a clean https(s) URL or null when empty.
const normalizeUrl = (value, { label, hosts = null } = {}) => {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return null;
    }

    if (raw.length > MAX_URL_LENGTH) {
        throw invalid(`${label} link is too long`);
    }

    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let url;
    try {
        url = new URL(withScheme);
    } catch {
        throw invalid(`${label} must be a valid web address`);
    }

    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
        throw invalid(`${label} must be a valid web address`);
    }

    if (url.username || url.password) {
        throw invalid(`${label} must not contain a username or password`);
    }

    const hostname = url.hostname.toLowerCase();
    if (hosts && !matchesHost(hostname, hosts)) {
        throw invalid(`${label} link must be on ${hosts[0]}`);
    }

    return url.toString();
};

const normalizeSocialLinks = (links = {}) => {
    if (links === null || typeof links !== "object" || Array.isArray(links)) {
        throw invalid("Social links must be an object");
    }

    const unknown = Object.keys(links).filter((key) => !SOCIAL_PLATFORMS[key]);
    if (unknown.length) {
        throw invalid(`Unsupported social link: ${unknown.join(", ")}`);
    }

    return Object.fromEntries(
        Object.entries(SOCIAL_PLATFORMS).map(([key, platform]) => [key, normalizeUrl(links[key], platform)])
    );
};

module.exports = { SOCIAL_PLATFORMS, normalizeUrl, normalizeSocialLinks };
