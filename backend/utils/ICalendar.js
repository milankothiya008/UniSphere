// Builds iCalendar (.ics) files: one event to add, or a whole calendar people subscribe to (RFC 5545).
// Google Calendar, Apple Calendar and Outlook all read these; a subscribed feed is fetched again from time
// to time, so changed times and cancellations show up in the person's calendar by themselves.

const stamp = (date) =>
    new Date(date)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");

const escapeText = (value) =>
    String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/\r?\n/g, "\\n")
        .replace(/([,;])/g, "\\$1");

// Lines are at most 75 bytes; longer ones continue on the next line after a space.
const fold = (line) => {
    const bytes = Buffer.from(line, "utf8");
    if (bytes.length <= 75) return line;
    const parts = [];
    let current = "";
    let size = 0;
    for (const char of line) {
        const width = Buffer.byteLength(char, "utf8");
        if (size + width > (parts.length ? 74 : 75)) {
            parts.push(current);
            current = "";
            size = 0;
        }
        current += char;
        size += width;
    }
    parts.push(current);
    return parts.join("\r\n ");
};

// Version numbers must grow whenever an item changes; seconds since 2024 fit easily.
const sequenceOf = (updatedAt) => Math.max(0, Math.floor((new Date(updatedAt || Date.now()).getTime() - Date.UTC(2024, 0, 1)) / 1000));

/**
 * items: [{ uid, start, end, title, description, location, url, status ("CONFIRMED" | "TENTATIVE" | "CANCELLED"),
 * updatedAt, alarmMinutes }]
 */
const buildCalendar = ({ name = "CampusConnect", items = [], feed = false } = {}) => {
    const now = stamp(new Date());
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CampusConnect//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        `X-WR-CALNAME:${escapeText(name)}`,
        "X-WR-TIMEZONE:Asia/Kolkata"
    ];
    if (feed) lines.push("REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H");

    for (const item of items) {
        if (!item.start || !item.end) continue;
        lines.push(
            "BEGIN:VEVENT",
            `UID:${item.uid}`,
            `DTSTAMP:${now}`,
            `DTSTART:${stamp(item.start)}`,
            `DTEND:${stamp(item.end)}`,
            `SUMMARY:${escapeText(item.title)}`,
            `SEQUENCE:${sequenceOf(item.updatedAt)}`,
            `STATUS:${item.status || "CONFIRMED"}`
        );
        if (item.updatedAt) lines.push(`LAST-MODIFIED:${stamp(item.updatedAt)}`);
        if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
        if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
        if (item.url) lines.push(`URL:${item.url}`);
        if (item.alarmMinutes && item.status !== "CANCELLED") {
            lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(item.title)}`, `TRIGGER:-PT${item.alarmMinutes}M`, "END:VALARM");
        }
        lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return `${lines.map(fold).join("\r\n")}\r\n`;
};

module.exports = { buildCalendar, escapeText, stamp };
