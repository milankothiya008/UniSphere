const { env } = require("../config/env");

// Dates are stored in UTC; people read them in the university's timezone (UNIVERSITY_TZ_OFFSET).
const offsetMinutes = () => {
    const match = String(env.timezoneOffset).match(/^([+-])(\d{2}):(\d{2})$/);
    if (!match) {
        return 0;
    }
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
};

const shifted = (date) => new Date(new Date(date).getTime() + offsetMinutes() * 60000);

// "14:30"
const formatTime = (date) => shifted(date).toISOString().slice(11, 16);

// "Tue, 6 Oct 2026"
const formatDate = (date) =>
    shifted(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// "Tue, 6 Oct 2026 · 18:00–23:30"
const formatSchedule = (startAt, endAt) =>
    formatDate(startAt) === formatDate(endAt)
        ? `${formatDate(startAt)} · ${formatTime(startAt)}–${formatTime(endAt)}`
        : `${formatDate(startAt)}, ${formatTime(startAt)} – ${formatDate(endAt)}, ${formatTime(endAt)}`;

module.exports = { offsetMinutes, formatTime, formatDate, formatSchedule };
