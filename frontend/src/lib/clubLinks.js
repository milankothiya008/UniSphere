// Mirrors backend/utils/ClubLinks.js so mistakes show while typing; the server re-checks everything.
export const SOCIAL_PLATFORMS = [
    { key: "instagram", label: "Instagram", hosts: ["instagram.com"], placeholder: "instagram.com/yourclub" },
    { key: "linkedin", label: "LinkedIn", hosts: ["linkedin.com", "lnkd.in"], placeholder: "linkedin.com/company/yourclub" },
    { key: "x", label: "X (Twitter)", hosts: ["x.com", "twitter.com"], placeholder: "x.com/yourclub" },
    { key: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"], placeholder: "youtube.com/@yourclub" },
    { key: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com", "fb.me"], placeholder: "facebook.com/yourclub" },
    { key: "github", label: "GitHub", hosts: ["github.com"], placeholder: "github.com/yourclub" },
    { key: "discord", label: "Discord", hosts: ["discord.gg", "discord.com"], placeholder: "discord.gg/invite-code" },
    { key: "whatsapp", label: "WhatsApp", hosts: ["chat.whatsapp.com", "whatsapp.com", "wa.me"], placeholder: "chat.whatsapp.com/invite-code" }
];

export const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,18}[0-9]$/;

const matchesHost = (hostname, hosts) => hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

// Returns an error message for a bad link, or null when it is empty or fine.
export const linkProblem = (value, { label, hosts = null }) => {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return null;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    let url;
    try {
        url = new URL(withScheme);
    } catch {
        return `${label} must be a valid web address`;
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) {
        return `${label} must be a valid web address`;
    }
    if (hosts && !matchesHost(url.hostname.toLowerCase(), hosts)) {
        return `${label} link must be on ${hosts[0]}`;
    }
    return null;
};

// "https://www.instagram.com/ddu.robotics/" -> "instagram.com/ddu.robotics"
export const displayUrl = (href) => {
    try {
        const url = new URL(href);
        const path = url.pathname.replace(/\/$/, "");
        return `${url.hostname.replace(/^www\./, "")}${path}`;
    } catch {
        return href;
    }
};

export const activeSocialLinks = (club) => SOCIAL_PLATFORMS.filter((platform) => club?.socialLinks?.[platform.key]);
