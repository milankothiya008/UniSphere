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

const EVENT_CATEGORIES = Object.freeze([...CLUB_CATEGORIES.filter((c) => c !== "OTHER"), "WORKSHOP", "SEMINAR", "COMPETITION", "OTHER"]);

module.exports = { CLUB_CATEGORIES, EVENT_CATEGORIES };
