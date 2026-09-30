// Pure helpers for the event planner: placing a day's events on a timeline, finding free windows and
// spotting clashes. Times are minutes from the start of the university-calendar day.
import { campusDayStart } from "./format";

export const DAY_START = 8 * 60;
export const DAY_END = 22 * 60;

/** Minutes since the day's midnight (may be negative or past 1440 for events spanning days). */
export const minutesOf = (value, dateKey) => Math.round((new Date(value) - campusDayStart(dateKey)) / 60000);

/** "HH:mm" for minutes since midnight. */
export const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "6 pm", "6:30 pm". */
export const shortClock = (minutes) => {
    const hours = Math.floor(minutes / 60) % 24;
    const mins = minutes % 60;
    const suffix = hours < 12 ? "am" : "pm";
    const twelve = hours % 12 || 12;
    return `${twelve}${mins ? `:${String(mins).padStart(2, "0")}` : ""} ${suffix}`;
};

/** "2 h", "1 h 30 min", "45 min". */
export const duration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (!hours) return `${mins} min`;
    return mins ? `${hours} h ${mins} min` : `${hours} h`;
};

/** Whether two audiences ("ALL" or department codes) share any students. */
export const audiencesOverlap = (a, b) => {
    if (a === "ALL" || b === "ALL" || !a || !b) return true;
    return a.some((code) => b.includes(code));
};

/** The day's events clipped to that day, as { ...event, start, end } in minutes, sorted by start. */
export const eventsOnDay = (items, dateKey) =>
    (items || [])
        .map((item) => ({
            ...item,
            start: Math.max(0, minutesOf(item.startAt, dateKey)),
            end: Math.min(1440, minutesOf(item.endAt, dateKey))
        }))
        .filter((item) => item.end > item.start)
        .sort((a, b) => a.start - b.start || b.end - a.end);

/**
 * Stacks overlapping events into lanes (first lane with room), so none cover each other.
 * Returns { placed: [{ ...event, lane }], lanes }.
 */
export const layoutLanes = (dayEvents) => {
    const laneEnds = [];
    const placed = dayEvents.map((event) => {
        let lane = laneEnds.findIndex((end) => end <= event.start);
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(event.end);
        } else {
            laneEnds[lane] = event.end;
        }
        return { ...event, lane };
    });
    return { placed, lanes: Math.max(1, laneEnds.length) };
};

/** The visible hours: 8 am to 10 pm, stretched to fit anything earlier or later. */
export const visibleRange = (dayEvents, extra = []) => {
    const all = [...dayEvents, ...extra];
    const start = Math.min(DAY_START, ...all.map((event) => Math.floor(event.start / 60) * 60));
    const end = Math.max(DAY_END, ...all.map((event) => Math.ceil(event.end / 60) * 60));
    return { start: Math.max(0, start), end: Math.min(1440, end) };
};

/**
 * Gaps of at least `minLength` minutes between `from` and `to` when none of `busy` is running.
 * Only events that share students with `audience` count as busy (pass "ALL" to count everything).
 */
export const freeWindows = (dayEvents, { from = DAY_START, to = DAY_END, minLength = 60, audience = "ALL" } = {}) => {
    const busy = dayEvents.filter((event) => audiencesOverlap(event.audience, audience)).sort((a, b) => a.start - b.start);
    const windows = [];
    let cursor = from;
    for (const event of busy) {
        if (event.start - cursor >= minLength) windows.push({ start: cursor, end: Math.min(event.start, to) });
        cursor = Math.max(cursor, event.end);
        if (cursor >= to) break;
    }
    if (to - cursor >= minLength) windows.push({ start: cursor, end: to });
    return windows.filter((window) => window.end - window.start >= minLength);
};

/**
 * Events overlapping the slot [start, end) (minutes), other than `excludeId`. Each says whether it is for
 * the same students (`sameAudience`), which is what actually splits the turnout.
 */
export const clashesWith = (dayEvents, { start, end, audience = "ALL", excludeId } = {}) =>
    dayEvents
        .filter((event) => String(event._id) !== String(excludeId) && event.start < end && event.end > start)
        .map((event) => ({
            ...event,
            sameAudience: audiencesOverlap(event.audience, audience)
        }))
        .sort((a, b) => Number(b.sameAudience) - Number(a.sameAudience) || a.start - b.start);

/** "HH:mm" → minutes. */
export const toMinutes = (time) => {
    const [hours, minutes] = String(time || "")
        .split(":")
        .map(Number);
    return Number.isFinite(hours) ? hours * 60 + (minutes || 0) : null;
};
