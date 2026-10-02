import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Clock, MapPin, Users } from "lucide-react";
import { audiencesOverlap, layoutLanes, shortClock, visibleRange } from "../../lib/schedule";
import { campusDayStart } from "../../lib/format";

const LANE = 70;

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
    const { placed, lanes } = layoutLanes(events);
    // Short events are narrow blocks, so the full details of the one pointed at or tapped show underneath.
    const [selectedId, setSelectedId] = useState(null);
    const selected = placed.find((event) => String(event._id) === String(selectedId)) || null;
    const range = visibleRange(events, proposed ? [proposed] : []);
    const span = range.end - range.start;
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
                    <div className="tl-body" style={{ height: lanes * LANE + 16 }}>
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
                        {placed.map((event, index) => {
                            const faded = !audiencesOverlap(event.audience, audience);
                            const classes = [
                                "tl-event",
                                event.tentative ? "is-tentative" : "",
                                event.mine ? "is-mine" : "",
                                faded ? "is-faded" : "",
                                clashIds?.has(String(event._id)) ? "is-clash" : ""
                            ].join(" ");
                            const title = `${event.title} · ${event.club.name} · ${shortClock(event.start)}–${shortClock(event.end)} · ${audienceText(event.audience)}${event.tentative ? " · awaiting approval" : ""}`;
                            const style = {
                                left: pct(event.start),
                                width: width(event.start, event.end),
                                top: 8 + event.lane * LANE,
                                "--i": Math.min(index, 10)
                            };
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
                                    <strong>{event.title}</strong>
                                    <span>
                                        {shortClock(event.start)}–{shortClock(event.end)} · {event.club.name}
                                    </span>
                                </button>
                            );
                        })}
                        {showNow && <span className="tl-now" style={{ left: pct(now) }} aria-label={`Now, ${shortClock(now)}`} />}
                    </div>
                </div>
            </div>
            {placed.length > 0 && (
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
                        <span className="subtle small">Point at or tap an event to see its full name and details.</span>
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
