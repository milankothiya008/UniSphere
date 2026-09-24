// Builds an iCalendar (.ics) file so an event can be added to Google, Apple or Outlook calendars.

const stamp = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// RFC 5545: escape backslashes, semicolons, commas and newlines; fold lines longer than 75 octets.
const escapeText = (value) =>
    String(value ?? "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");

const fold = (line) => {
    const parts = [];
    let rest = line;
    while (rest.length > 74) {
        parts.push(rest.slice(0, 74));
        rest = ` ${rest.slice(74)}`;
    }
    parts.push(rest);
    return parts.join("\r\n");
};

export const buildIcs = (event, { url } = {}) => {
    const location = [event.venue?.name, event.venue?.location].filter(Boolean).join(", ");
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CampusConnect//Events//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${event._id}@campusconnect`,
        `DTSTAMP:${stamp(Date.now())}`,
        `DTSTART:${stamp(event.startAt)}`,
        `DTEND:${stamp(event.endAt)}`,
        `SUMMARY:${escapeText(event.title)}`,
        `DESCRIPTION:${escapeText([event.shortDescription, event.club?.name ? `Hosted by ${event.club.name}` : null, url].filter(Boolean).join("\n\n"))}`,
        location ? `LOCATION:${escapeText(location)}` : null,
        url ? `URL:${url}` : null,
        "END:VEVENT",
        "END:VCALENDAR"
    ].filter(Boolean);
    return lines.map(fold).join("\r\n") + "\r\n";
};

export const downloadIcs = (event) => {
    const url = `${window.location.origin}/events/${event._id}`;
    const blob = new Blob([buildIcs(event, { url })], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${String(event.title).replace(/[^\w-]+/g, "_")}.ics`;
    link.click();
    URL.revokeObjectURL(href);
};
