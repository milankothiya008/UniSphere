import { Link } from "react-router-dom";
import { CalendarRange, CheckCircle2, TriangleAlert, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { Card, Skeleton } from "../ui";
import { DayTimeline, audienceText } from "./DayTimeline";
import { clashesWith, eventsOnDay, shortClock, toMinutes } from "../../lib/schedule";
import { formatDateLong, campusDayStart } from "../../lib/format";

/**
 * What else is on campus that day, with the planned slot drawn in and any clashes called out. Clashes
 * only warn: a club may still go ahead, and the mentor sees the same list when approving.
 */
export const ScheduleCheck = ({
    dateKey,
    endDate,
    startTime,
    endTime,
    audience = "ALL",
    excludeId,
    title = "Campus schedule that day",
    reviewer = false,
    embedded = false
}) => {
    const { data, loading, error } = useApi(() => eventApi.schedule({ from: dateKey, days: 1 }), [dateKey], { enabled: Boolean(dateKey) });
    const start = toMinutes(startTime);
    // A multi-day event runs past midnight: its end is counted on from the first day.
    const extraDays = endDate && dateKey ? Math.max(0, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${dateKey}T00:00:00Z`)) / 86400000)) : 0;
    const endMinutes = toMinutes(endTime);
    const end = endMinutes === null ? null : endMinutes + extraDays * 1440;
    // Hidden for anyone the planner is closed to (the server decides).
    if (!dateKey || error) return null;

    const dayEvents = eventsOnDay(data?.items, dateKey).filter((event) => String(event._id) !== String(excludeId));
    const validSlot = start !== null && end !== null && end > start;
    const clashes = validSlot ? clashesWith(dayEvents, { start, end, audience }) : [];
    const sameStudents = clashes.filter((event) => event.sameAudience);
    const otherStudents = clashes.filter((event) => !event.sameAudience);
    const who = reviewer ? "This event" : "Your event";

    const plannerLink = (
        <Link to={`/events/planner?date=${dateKey}`} className="planner-link">
            <CalendarRange size={14} /> Open planner
        </Link>
    );

    const body = (
        <div className="stack">
            <p className="subtle small" style={{ margin: 0 }}>
                {formatDateLong(campusDayStart(dateKey))} ·{" "}
                {dayEvents.length ? `${dayEvents.length} other event${dayEvents.length === 1 ? "" : "s"}` : "nothing else booked yet"}
            </p>
            {loading && !data ? (
                <Skeleton height={96} />
            ) : (
                <DayTimeline
                    dateKey={dateKey}
                    events={dayEvents}
                    audience={audience}
                    proposed={validSlot ? { start, end, label: reviewer ? "This event" : "Your event" } : null}
                    clashIds={new Set(sameStudents.map((event) => String(event._id)))}
                    label={`Events on ${dateKey}`}
                />
            )}
            {validSlot && data && (
                <>
                    {sameStudents.length > 0 && (
                        <div className="clash-note is-warn" role="status">
                            <TriangleAlert size={18} />
                            <div>
                                <strong>
                                    {who} overlaps {sameStudents.length === 1 ? "an event" : `${sameStudents.length} events`} for the same students
                                </strong>
                                <ul>
                                    {sameStudents.map((event) => (
                                        <li key={event._id}>
                                            <b>{event.title}</b> ({event.club.name}) runs {shortClock(event.start)}–{shortClock(event.end)} for{" "}
                                            {audienceText(event.audience)} students
                                            {event.tentative ? " · awaiting approval" : ""}
                                        </li>
                                    ))}
                                </ul>
                                <span className="subtle small">
                                    {reviewer
                                        ? "Students may have to choose between them. You can still approve."
                                        : "Turnout may split between them. You can still go ahead — or pick a free slot in the planner."}
                                </span>
                            </div>
                        </div>
                    )}
                    {otherStudents.length > 0 && (
                        <div className="clash-note" role="status">
                            <Users size={18} />
                            <div>
                                <strong>Also running then, for other students</strong>
                                <ul>
                                    {otherStudents.map((event) => (
                                        <li key={event._id}>
                                            <b>{event.title}</b> ({event.club.name}) · {shortClock(event.start)}–{shortClock(event.end)} ·{" "}
                                            {audienceText(event.audience)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                    {clashes.length === 0 && (
                        <div className="clash-note is-ok" role="status">
                            <CheckCircle2 size={18} />
                            <strong>No other event at this time — a clear slot.</strong>
                        </div>
                    )}
                </>
            )}
        </div>
    );

    // Inside another card (the event form) it drops its own card frame.
    return embedded ? (
        <section className="schedule-embed" aria-label={title}>
            <header className="schedule-embed-head">
                <strong>{title}</strong>
                {plannerLink}
            </header>
            {body}
        </section>
    ) : (
        <Card title={title} actions={plannerLink}>
            {body}
        </Card>
    );
};
