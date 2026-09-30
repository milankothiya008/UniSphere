// Events are scheduled in university-local time; render them in that zone regardless of the viewer's device.
export const UNIVERSITY_TIMEZONE = import.meta.env.VITE_UNIVERSITY_TIMEZONE || "Asia/Kolkata";

const fmt = (options) => new Intl.DateTimeFormat("en-IN", { timeZone: UNIVERSITY_TIMEZONE, ...options });

const toDate = (value) => (value instanceof Date ? value : new Date(value));

const valid = (value) => value !== null && value !== undefined && !Number.isNaN(toDate(value).getTime());

export const formatDate = (value) => (valid(value) ? fmt({ day: "numeric", month: "short", year: "numeric" }).format(toDate(value)) : "—");

export const formatDateLong = (value) =>
    valid(value) ? fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(toDate(value)) : "—";

export const formatTime = (value) => (valid(value) ? fmt({ hour: "numeric", minute: "2-digit" }).format(toDate(value)) : "—");

export const formatDateTime = (value) =>
    valid(value) ? fmt({ day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(toDate(value)) : "—";

export const formatTimeRange = (start, end) => `${formatTime(start)} – ${formatTime(end)}`;

export const dateParts = (value) => {
    if (!valid(value)) {
        return { month: "", day: "" };
    }
    const date = toDate(value);
    return {
        month: fmt({ month: "short" }).format(date),
        day: fmt({ day: "numeric" }).format(date)
    };
};

// YYYY-MM-DD for the given instant in the university timezone (used to prefill date inputs).
export const toDateInput = (value) => {
    if (!valid(value)) {
        return "";
    }
    const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(toDate(value));
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
};

// Value for <input type="datetime-local"> in the university timezone.
export const toDateTimeInput = (value) => {
    if (!valid(value)) {
        return "";
    }
    const parts = fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
        toDate(value)
    );
    const get = (type) => parts.find((p) => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
};

const OFFSET = import.meta.env.VITE_UNIVERSITY_TZ_OFFSET || "+05:30";

// Converts a datetime-local value (university time) to an ISO instant for the API.
export const fromDateTimeInput = (value) => (value ? new Date(`${value}:00${OFFSET}`).toISOString() : "");

// Instagram-style age: "now", "5m", "3h", "2d", "4w", then the date.
export const shortAgo = (value) => {
    if (!valid(value)) {
        return "";
    }
    const seconds = Math.max(0, Math.round((Date.now() - toDate(value).getTime()) / 1000));
    for (const [suffix, size] of [["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]]) {
        if (seconds >= size) {
            return suffix === "w" && seconds >= 604800 * 8 ? formatDate(value) : `${Math.floor(seconds / size)}${suffix}`;
        }
    }
    return "now";
};

export const timeAgo = (value) => {
    if (!valid(value)) {
        return "";
    }
    const seconds = Math.round((Date.now() - toDate(value).getTime()) / 1000);
    const units = [
        ["year", 31536000],
        ["month", 2592000],
        ["week", 604800],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60]
    ];
    const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return rtf.format(-Math.round(seconds / size), unit);
        }
    }
    return "just now";
};

export const humanize = (value) =>
    value
        ? String(value)
              .toLowerCase()
              .split("_")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(" ")
        : "";

export const initials = (name = "") =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "?";

export const plural = (count, word, pluralWord = `${word}s`) => `${count} ${count === 1 ? word : pluralWord}`;

export const batchLabel = (code) => (code ? `20${code}` : "");

// "All departments" or "CE, IT" for a club / club request.
export const departmentsLabel = (scope) => (scope?.allDepartments ? "All departments" : (scope?.departmentCodes || []).join(", "));

// Whole calendar days from `now` to `value` in the university timezone (0 = today, 1 = tomorrow).
export const daysUntil = (value, now = Date.now()) => {
    const day = (input) => new Date(`${toDateInput(input)}T00:00:00Z`).getTime();
    return Math.round((day(value) - day(now)) / 86400000);
};

// [[value, unit], …] for a countdown, e.g. [[2, "days"], [5, "hrs"], [12, "min"]].
export const countdownParts = (ms) => {
    const total = Math.max(0, Math.floor(ms / 60000));
    const days = Math.floor(total / 1440);
    const hours = Math.floor((total % 1440) / 60);
    const minutes = total % 60;
    return days > 0
        ? [[days, days === 1 ? "day" : "days"], [hours, "hrs"], [minutes, "min"]]
        : [[hours, "hrs"], [minutes, "min"]];
};

// The instant a university-calendar day ("YYYY-MM-DD") starts.
export const campusDayStart = (dateKey) => new Date(`${dateKey}T00:00:00${OFFSET}`);

// "YYYY-MM-DD" plus `days` calendar days.
export const addDaysToKey = (dateKey, days) => new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
