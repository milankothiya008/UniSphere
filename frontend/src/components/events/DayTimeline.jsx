import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Clock, MapPin, Users } from "lucide-react";
import { audiencesOverlap, shortClock, visibleRange } from "../../lib/schedule";
import { campusDayStart } from "../../lib/format";

const LANE = 56;
const MIN_WIDTH = 680; // px; narrower screens scroll sideways

// Text width in px, for laying labels out without overlaps (an estimate where there's no canvas, e.g. tests).
let measureContext;
const textWidth = (text, font, perChar) => {
    if (measureContext === undefined) {
        const jsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
        measureContext = jsdom || typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    }
    if (!measureContext) return text.length * perChar;
    measureContext.font = font;
    return measureContext.measureText(text).width;
};

/**
 * Gantt-style layout: each event's coloured bar covers its real duration, and its full name and time sit
 * on the bar and run past it when the event is short. Rows are assigned so no two labels overlap; a label
 * that would run off the right edge grows leftwards instead.
 */
const layoutBlocks = (events, range, bodyWidth) => {
    const span = range.end - range.start;
    const perMinute = bodyWidth / span;
    const family = getComputedFontFamily();
    const rowEnds = [];
    const blocks = [...events]
        .sort((a, b) => a.start - b.start || b.end - a.end)
        .map((event) => {
            const start = Math.max(event.start, range.start);
            const end = Math.min(event.end, range.end);
            const barLeft = (start - range.start) * perMinute;
            const barWidth = Math.max(6, (end - start) * perMinute);
            const meta = `${shortClock(event.start)}–${shortClock(event.end)} · ${event.club.name}`;
            const label = Math.max(textWidth(event.title, `700 12.5px ${family}`, 7.4), textWidth(meta, `400 11px ${family}`, 6.2)) + 26;
            const width = Math.min(Math.max(barWidth, label), bodyWidth);
            const anchorRight = barLeft + width > bodyWidth;
            const left = anchorRight ? Math.max(0, bodyWidth - width) : barLeft;
            let row = rowEnds.findIndex((rowEnd) => rowEnd <= left - 4);
            if (row === -1) {
                row = rowEnds.length;
                rowEnds.push(left + width);
            } else {
                rowEnds[row] = left + width;
            }
            return { event, meta, left, width, barLeft: barLeft - left, barWidth, anchorRight, row };
        });
    return { blocks, rows: Math.max(1, rowEnds.length) };
};

const getComputedFontFamily = () => {
    if (typeof document === "undefined" || !window.getComputedStyle) return "sans-serif";
    return window.getComputedStyle(document.body).fontFamily || "sans-serif";
};

// Events the viewer may open: live ones, and anything of their own clubs. Other clubs' unpublished
// events are shown (they hold the slot) but stay private.
const canOpen = (event) => event.mine || ["PUBLISHED", "COMPLETED"].includes(event.status);

const audienceText = (audience) => (audience === "ALL" ? "All departments" : audience.join(", "));

const minutesNow = (dateKey) => Math.round((Date.now() - campusDayStart(dateKey)) / 60000);

const useNowMinutes = (dateKey) => {
    const [now, setNow] = useState(() => minutesNow(dateKey));
    useEffect(() => {
        setNow(minutesNow(dateKey));
        const timer = setInterval(() => setNow(minutesNow(dateKey)), 60000);
        return () => clearInterval(timer);
    }, [dateKey]);
    return now;
};

/**
 * One day of campus events on an hour grid (8 am – 10 pm, stretched if needed). Overlapping events
 * stack into lanes; events awaiting approval are hatched; events for other students fade when an
 * audience is chosen; `proposed` draws the slot being planned.
 */
export const DayTimeline = ({ dateKey, events, audience = "ALL", proposed, clashIds, label }) => {
    // Venue and audience of the event pointed at or tapped show underneath.
    const [selectedId, setSelectedId] = useState(null);
    const selected = events.find((event) => String(event._id) === String(selectedId)) || null;
    const range = visibleRange(events, proposed ? [proposed] : []);
    const span = range.end - range.start;

    // Labels are laid out in pixels, so follow the timeline's real width.
    const bodyRef = useRef(null);
    const [bodyWidth, setBodyWidth] = useState(MIN_WIDTH);
    useLayoutEffect(() => {
        const body = bodyRef.current;
        if (!body) return undefined;
        const update = () => body.clientWidth && setBodyWidth(body.clientWidth);
        update();
        if (typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(body);
        return () => observer.disconnect();
    }, []);
    const { blocks, rows } = layoutBlocks(events, range, bodyWidth);
    const pct = (minutes) => `${((Math.min(Math.max(minutes, range.start), range.end) - range.start) / span) * 100}%`;
    const width = (start, end) => `${((Math.min(end, range.end) - Math.max(start, range.start)) / span) * 100}%`;
    const hours = [];
    for (let minute = range.start; minute <= range.end; minute += 60) hours.push(minute);
    const now = useNowMinutes(dateKey);
    const showNow = now > range.start && now < range.end;

    // On narrow screens the day scrolls sideways: start at the planned slot, else the first event.
    const scroller = useRef(null);
    const focus = proposed?.start ?? events[0]?.start ?? null;
    useEffect(() => {
        const box = scroller.current;
        if (!box || focus === null || box.scrollWidth <= box.clientWidth) return;
        box.scrollLeft = Math.max(0, ((focus - range.start) / span) * box.scrollWidth - 48);
    }, [dateKey, focus, range.start, span]);

    return (
        <div className="tl" role="group" aria-label={label || "Day timeline"}>
            <div className="tl-scroll" ref={scroller}>
                <div className="tl-inner">
                    <div className="tl-hours" aria-hidden="true">
                        {hours.map((minute) => (
                            <span key={minute} style={{ left: pct(minute) }}>
                                {shortClock(minute)}
                            </span>
                        ))}
                    </div>
                    <div className="tl-body" ref={bodyRef} style={{ height: rows * LANE + 12 }}>
                        {hours.map((minute) => (
                            <span key={minute} className="tl-grid" style={{ left: pct(minute) }} aria-hidden="true" />
                        ))}
                        {proposed && (
                            <div
                                className={`tl-proposed ${clashIds?.size ? "is-clash" : ""}`}
                                style={{
                                    left: pct(proposed.start),
                                    width: width(proposed.start, proposed.end)
                                }}
                            >
                                <span>{proposed.label || "Your event"}</span>
                            </div>
                        )}
                        {blocks.map(({ event, meta, left, width: blockWidth, barLeft, barWidth, anchorRight, row }, index) => {
                            const faded = !audiencesOverlap(event.audience, audience);
                            const classes = [
                                "tl-event",
                                event.tentative ? "is-tentative" : "",
                                event.mine ? "is-mine" : "",
                                faded ? "is-faded" : "",
                                clashIds?.has(String(event._id)) ? "is-clash" : "",
                                anchorRight ? "is-right" : ""
                            ].join(" ");
                            const title = `${event.title} · ${event.club.name} · ${shortClock(event.start)}–${shortClock(event.end)} · ${audienceText(event.audience)}${event.tentative ? " · awaiting approval" : ""}`;
                            const style = { left, width: blockWidth, top: 6 + row * LANE, "--i": Math.min(index, 10) };
                            const on = selected && String(selected._id) === String(event._id);
                            return (
                                <button
                                    key={event._id}
                                    type="button"
                                    className={`${classes} ${on ? "is-selected" : ""}`}
                                    style={style}
                                    title={title}
                                    aria-label={title}
                                    aria-pressed={Boolean(on)}
                                    onClick={() => setSelectedId(on ? null : event._id)}
                                    onMouseEnter={() => setSelectedId(event._id)}
                                    onFocus={() => setSelectedId(event._id)}
                                >
                                    <span className="tl-bar" style={{ left: barLeft, width: barWidth }} aria-hidden="true" />
                                    <strong>{event.title}</strong>
                                    <span className="tl-meta">{meta}</span>
                                </button>
                            );
                        })}
                        {showNow && <span className="tl-now" style={{ left: pct(now) }} aria-label={`Now, ${shortClock(now)}`} />}
                    </div>
                </div>
            </div>
            {events.length > 0 && (
                <div className={`tl-detail ${selected ? "is-on" : ""}`} aria-live="polite">
                    {selected ? (
                        <>
                            <div className="tl-detail-main">
                                <strong>{selected.title}</strong>
                                <span className="tl-detail-meta">
                                    <span>
                                        <Clock size={12} /> {shortClock(selected.start)}–{shortClock(selected.end)}
                                    </span>
                                    <span>{selected.club.name}</span>
                                    {selected.venue?.name && (
                                        <span>
                                            <MapPin size={12} /> {selected.venue.name}
                                        </span>
                                    )}
                                    <span>
                                        <Users size={12} /> {audienceText(selected.audience)}
                                    </span>
                                    {selected.tentative && <span className="tl-detail-flag">Awaiting approval</span>}
                                </span>
                            </div>
                            {canOpen(selected) && (
                                <Link to={`/events/${selected._id}`} className="tl-detail-open">
                                    Open <ChevronRight size={14} />
                                </Link>
                            )}
                        </>
                    ) : (
                        <span className="subtle small">Point at or tap an event to see its venue and who it's for.</span>
                    )}
                </div>
            )}
            <ul className="tl-legend" aria-label="Legend">
                <li>
                    <span className="tl-key" /> Confirmed
                </li>
                <li>
                    <span className="tl-key is-tentative" /> Awaiting approval
                </li>
                <li>
                    <span className="tl-key is-mine" /> Your club
                </li>
                {proposed && (
                    <li>
                        <span className="tl-key is-proposed" /> {proposed.label || "Your event"}
                    </li>
                )}
                {audience !== "ALL" && (
                    <li>
                        <span className="tl-key is-faded" /> Other students
                    </li>
                )}
            </ul>
        </div>
    );
};

export { audienceText };
