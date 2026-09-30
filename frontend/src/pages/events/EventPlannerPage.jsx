import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Clock, MapPin, Sparkles, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useWorkspace } from "../../context/WorkspaceContext";
import { AsyncContent, Badge, ButtonLink, Card, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { DayTimeline, audienceText } from "../../components/events/DayTimeline";
import { addDaysToKey, campusDayStart, toDateInput } from "../../lib/format";
import { DAY_END, DAY_START, clock, duration, eventsOnDay, freeWindows, shortClock } from "../../lib/schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const keyParts = (key) => {
    const date = new Date(`${key}T00:00:00Z`);
    return {
        weekday: WEEKDAYS[date.getUTCDay()],
        day: date.getUTCDate(),
        month: MONTHS[date.getUTCMonth()],
        dow: date.getUTCDay()
    };
};

// Weeks run Monday to Sunday.
const weekStartOf = (key) => addDaysToKey(key, -((keyParts(key).dow + 6) % 7));

const dayTitle = (key, today) => {
    const { weekday, day, month } = keyParts(key);
    const prefix = key === today ? "Today" : key === addDaysToKey(today, 1) ? "Tomorrow" : weekday;
    return `${prefix}, ${day} ${month}`;
};

// A suggested length for a new event in a free window: two hours, or the whole window if shorter.
const suggestedEnd = (window) => Math.min(window.start + 120, window.end);

const DayButton = ({ dateKey, selected, today, events, onSelect }) => {
    const { weekday, day } = keyParts(dateKey);
    const busy = events.length;
    const tentative = events.filter((event) => event.tentative).length;
    return (
        <button
            type="button"
            className={`week-day ${selected ? "is-on" : ""} ${dateKey === today ? "is-today" : ""} ${dateKey < today ? "is-past" : ""}`}
            aria-pressed={selected}
            onClick={() => onSelect(dateKey)}
            aria-label={`${dayTitle(dateKey, today)}: ${busy ? `${busy} event${busy === 1 ? "" : "s"}` : "free"}`}
        >
            <span className="week-day-name">{weekday}</span>
            <span className="week-day-num">{day}</span>
            <span className="week-day-load" aria-hidden="true">
                {busy === 0 ? (
                    <em>Free</em>
                ) : (
                    Array.from({ length: Math.min(busy, 4) }, (_, i) => <i key={i} className={i >= busy - tentative ? "is-tentative" : ""} />)
                )}
            </span>
        </button>
    );
};

const EventRow = ({ event }) => {
    const open = event.mine || ["PUBLISHED", "COMPLETED"].includes(event.status);
    const body = (
        <>
            <span className={`planner-row-time ${event.tentative ? "is-tentative" : ""}`}>
                <strong>{shortClock(event.start)}</strong>
                <span>{shortClock(event.end)}</span>
            </span>
            <span className="planner-row-body">
                <strong>{event.title}</strong>
                <span className="subtle small">
                    {event.club.name}
                    {event.venue && (
                        <>
                            {" · "}
                            <MapPin size={11} /> {event.venue.name}
                        </>
                    )}
                </span>
                <span className="planner-row-chips">
                    <span className="planner-chip">
                        <Users size={11} /> {audienceText(event.audience)}
                    </span>
                    {event.tentative ? (
                        <Badge tone="violet">Awaiting approval</Badge>
                    ) : event.status === "APPROVED" ? (
                        <Badge tone="info">Approved</Badge>
                    ) : null}
                    {event.mine && <Badge tone="gold">Your club</Badge>}
                    {event.status === "PUBLISHED" && event.registeredCount > 0 && (
                        <span className="subtle small">
                            {event.registeredCount}
                            {event.maxParticipants ? `/${event.maxParticipants}` : ""} registered
                        </span>
                    )}
                </span>
            </span>
        </>
    );
    return open ? (
        <Link to={`/events/${event._id}`} className="planner-row">
            {body}
        </Link>
    ) : (
        <div className="planner-row">{body}</div>
    );
};

/**
 * Campus-wide event planner: which slots other clubs have taken on each day, and which are still
 * free, so clubs stop scheduling events on top of each other and splitting their audience.
 */
const EventPlannerPage = () => {
    const { eventClubs, reference } = useWorkspace();
    const today = toDateInput(new Date());
    const [filters, setFilters] = useQueryState({ date: today, dept: "" });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : today;
    const weekStart = weekStartOf(date);
    const week = Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i));
    const audience = filters.dept ? [filters.dept] : "ALL";
    const canCreate = eventClubs.length > 0;

    const { data, loading, error, reload } = useApi(() => eventApi.schedule({ from: weekStart, days: 7 }), [weekStart]);
    const byDay = useMemo(() => Object.fromEntries(week.map((key) => [key, eventsOnDay(data?.items, key)])), [data, week.join()]); // eslint-disable-line react-hooks/exhaustive-deps
    const dayEvents = byDay[date] || [];

    // Free windows from 8 am (or from now, today) to 10 pm, at least an hour long.
    const nowMinutes = Math.ceil((Date.now() - campusDayStart(date)) / 60000 / 30) * 30;
    const from = date === today ? Math.max(DAY_START, nowMinutes) : DAY_START;
    const windows = date < today ? [] : freeWindows(dayEvents, { from, to: DAY_END, audience });
    const shown = audience === "ALL" ? dayEvents : dayEvents.filter((event) => event.audience === "ALL" || event.audience.includes(filters.dept));

    const select = (key) => setFilters({ date: key });
    const tentativeCount = dayEvents.filter((event) => event.tentative).length;

    return (
        <>
            <PageHeader
                title="Event planner"
                actions={
                    canCreate && (
                        <ButtonLink to={`/events/create?date=${date >= today ? date : today}`}>
                            <CalendarPlus size={16} /> Plan an event
                        </ButtonLink>
                    )
                }
            />
            <p className="subtle planner-intro">
                See when other clubs have events before you pick a time. Two events for the same students at the same time split the turnout — pick a free slot
                instead.
            </p>

            <div className="stack-lg">
                <Card padded={false} className="planner-week">
                    <div className="planner-week-head">
                        <button type="button" className="planner-nav" onClick={() => select(addDaysToKey(date, -7))} aria-label="Previous week">
                            <ChevronLeft size={18} />
                        </button>
                        <strong>
                            {keyParts(week[0]).day} {keyParts(week[0]).month} – {keyParts(week[6]).day} {keyParts(week[6]).month}
                        </strong>
                        <button type="button" className="planner-nav" onClick={() => select(addDaysToKey(date, 7))} aria-label="Next week">
                            <ChevronRight size={18} />
                        </button>
                        {date !== today && (
                            <button type="button" className="planner-today" onClick={() => select(today)}>
                                Today
                            </button>
                        )}
                        <select
                            className="select planner-dept"
                            value={filters.dept}
                            onChange={(event) => setFilters({ dept: event.target.value })}
                            aria-label="Students of"
                        >
                            <option value="">All students</option>
                            {(reference.departments || []).map((department) => (
                                <option key={department.code} value={department.code}>
                                    {department.code} students
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="week-strip">
                        {week.map((key) => (
                            <DayButton key={key} dateKey={key} selected={key === date} today={today} events={byDay[key] || []} onSelect={select} />
                        ))}
                    </div>
                </Card>

                <AsyncContent loading={loading && !data} error={error} onRetry={reload} skeleton={<Skeleton height={220} />}>
                    <Card
                        title={dayTitle(date, today)}
                        actions={
                            <span className="subtle small">
                                {dayEvents.length
                                    ? `${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}${tentativeCount ? ` · ${tentativeCount} awaiting approval` : ""}`
                                    : "Nothing booked"}
                            </span>
                        }
                    >
                        <DayTimeline dateKey={date} events={dayEvents} audience={audience} label={`Events on ${dayTitle(date, today)}`} />
                    </Card>

                    <div className="planner-grid">
                        <Card title={filters.dept ? `Free for ${filters.dept} students` : "Free slots"}>
                            {date < today ? (
                                <p className="subtle">This day has passed.</p>
                            ) : windows.length === 0 ? (
                                <EmptyState
                                    icon={CalendarClock}
                                    title="No free hour left"
                                    description="Every hour between 8 am and 10 pm has an event for these students. Try another day."
                                />
                            ) : (
                                <ul className="free-list">
                                    {windows.map((window) => (
                                        <li key={window.start} className="free-slot">
                                            <span className="free-slot-icon">
                                                <Sparkles size={16} />
                                            </span>
                                            <span className="free-slot-body">
                                                <strong>
                                                    {shortClock(window.start)} – {shortClock(window.end)}
                                                </strong>
                                                <span className="subtle small">
                                                    <Clock size={11} /> {duration(window.end - window.start)} free
                                                </span>
                                            </span>
                                            {canCreate && (
                                                <Link
                                                    className="free-slot-go"
                                                    to={`/events/create?date=${date}&start=${clock(window.start)}&end=${clock(suggestedEnd(window))}`}
                                                >
                                                    Plan here
                                                </Link>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>

                        <Card title="What's on" padded={false}>
                            {shown.length === 0 ? (
                                <EmptyState
                                    icon={CalendarClock}
                                    title="No events"
                                    description={filters.dept ? `Nothing for ${filters.dept} students this day.` : "No club has booked this day yet."}
                                />
                            ) : (
                                <div className="planner-list">
                                    {shown.map((event) => (
                                        <EventRow key={event._id} event={event} />
                                    ))}
                                </div>
                            )}
                        </Card>
                    </div>
                </AsyncContent>
            </div>
        </>
    );
};

export default EventPlannerPage;
