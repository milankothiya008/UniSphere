const CLUB_CATEGORIES = Object.freeze([
    "TECHNOLOGY",
    "SPORTS",
    "CULTURAL",
    "LITERARY",
    "MUSIC",
    "ART",
    "SOCIAL_SERVICE",
    "ENTREPRENEURSHIP",
    "OTHER"
]);

// HACKATHON events get the hackathon tools: agenda, problem statements, project submission and judging.
const EVENT_CATEGORIES = Object.freeze([...CLUB_CATEGORIES.filter((c) => c !== "OTHER"), "WORKSHOP", "SEMINAR", "COMPETITION", "HACKATHON", "OTHER"]);

module.exports = { CLUB_CATEGORIES, EVENT_CATEGORIES };
