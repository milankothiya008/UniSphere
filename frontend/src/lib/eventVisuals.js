import {
    BookOpen,
    Briefcase,
    Code2,
    Cpu,
    Handshake,
    Lightbulb,
    Music,
    Palette,
    Presentation,
    Sparkles,
    Swords,
    Trophy,
    Wrench
} from "lucide-react";

// A colour story and icon per category, used for poster-less events, chips and accents.
// `from`/`to` paint the cover gradient; `glow` is the soft highlight in its corner.
export const CATEGORY_STYLE = {
    TECHNOLOGY: { icon: Code2, from: "#0f1a47", to: "#2c46b0", glow: "rgba(96, 165, 250, 0.55)" },
    SPORTS: { icon: Trophy, from: "#073b2e", to: "#0f8a5f", glow: "rgba(110, 231, 183, 0.5)" },
    CULTURAL: { icon: Sparkles, from: "#4a0f3a", to: "#b83280", glow: "rgba(251, 182, 206, 0.5)" },
    LITERARY: { icon: BookOpen, from: "#2e1a47", to: "#6d3fd1", glow: "rgba(196, 181, 253, 0.5)" },
    MUSIC: { icon: Music, from: "#3b0a45", to: "#9333ea", glow: "rgba(245, 184, 61, 0.45)" },
    ART: { icon: Palette, from: "#4a1d0f", to: "#dc5a1c", glow: "rgba(253, 186, 116, 0.55)" },
    SOCIAL_SERVICE: { icon: Handshake, from: "#0b3a45", to: "#0e8aa0", glow: "rgba(103, 232, 249, 0.45)" },
    ENTREPRENEURSHIP: { icon: Briefcase, from: "#3a2a05", to: "#b7791f", glow: "rgba(250, 204, 21, 0.45)" },
    WORKSHOP: { icon: Wrench, from: "#10243f", to: "#1f6fd1", glow: "rgba(147, 197, 253, 0.5)" },
    SEMINAR: { icon: Presentation, from: "#1e2a3a", to: "#475569", glow: "rgba(203, 213, 225, 0.45)" },
    COMPETITION: { icon: Swords, from: "#450a0a", to: "#c2362f", glow: "rgba(245, 184, 61, 0.5)" },
    HACKATHON: { icon: Cpu, from: "#04121f", to: "#0b6e6e", glow: "rgba(52, 211, 153, 0.5)" },
    OTHER: { icon: Lightbulb, from: "#1b2a6b", to: "#3c5bd6", glow: "rgba(245, 184, 61, 0.4)" }
};

export const categoryStyle = (category) => CATEGORY_STYLE[category] || CATEGORY_STYLE.OTHER;

// CSS custom properties for a category-themed surface.
export const categoryVars = (category) => {
    const style = categoryStyle(category);
    return { "--cat-from": style.from, "--cat-to": style.to, "--cat-glow": style.glow };
};

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "Starts in 2d 4h", "Starts in 3h 10m", "Starting soon"
export const startsInLabel = (startAt, now = Date.now()) => {
    const ms = new Date(startAt).getTime() - now;
    if (ms <= 0) {
        return null;
    }
    if (ms < 15 * MINUTE) {
        return "Starting soon";
    }
    const days = Math.floor(ms / DAY);
    const hours = Math.floor((ms % DAY) / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    if (days > 0) {
        return `Starts in ${days}d ${hours}h`;
    }
    return hours > 0 ? `Starts in ${hours}h ${minutes}m` : `Starts in ${minutes}m`;
};
