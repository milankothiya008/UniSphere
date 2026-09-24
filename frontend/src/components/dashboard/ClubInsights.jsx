import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CalendarCheck2, CalendarClock, CalendarDays, Gauge, Table2, Ticket, Users } from "lucide-react";
import { StatTile } from "../ui";
import { formatDate, plural } from "../../lib/format";

// Rounds the axis maximum up to a clean 1 / 2 / 5 × 10ⁿ value so ticks read naturally.
const niceMax = (value) => {
    if (value <= 5) {
        return 5;
    }
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 5, 10].find((multiplier) => multiplier * magnitude >= value);
    return step * magnitude;
};

const compact = (value) => new Intl.NumberFormat("en-IN", { notation: value >= 10000 ? "compact" : "standard" }).format(value);

const stateLabel = (event) => (event.status === "COMPLETED" ? "Completed" : event.upcoming ? "Upcoming" : "Ended — not marked completed");

// One horizontal bar per event: the filled bar is registrations, the light track behind it is capacity.
const RegistrationsChart = ({ events }) => {
    const [active, setActive] = useState(null);
    const max = useMemo(() => niceMax(Math.max(1, ...events.map((event) => Math.max(event.registered, event.capacity || 0)))), [events]);
    const ticks = [0, max / 2, max];

    return (
        <div className="reg-chart" onMouseLeave={() => setActive(null)}>
            <div className="reg-chart-axis" aria-hidden="true">
                <span />
                <div className="reg-chart-ticks">
                    {ticks.map((tick) => (
                        <span key={tick} style={{ left: `${(tick / max) * 100}%` }}>
                            {compact(tick)}
                        </span>
                    ))}
                </div>
            </div>
            <ul className="reg-chart-rows">
                {events.map((event) => {
                    const fill = event.capacity ? Math.round((event.registered / event.capacity) * 100) : null;
                    const isActive = active === event._id;
                    return (
                        <li key={event._id}>
                            <Link
                                to={`/events/${event._id}/participants`}
                                className={`reg-chart-row ${isActive ? "active" : ""}`}
                                onMouseEnter={() => setActive(event._id)}
                                onFocus={() => setActive(event._id)}
                                onBlur={() => setActive(null)}
                                aria-label={`${event.title}: ${event.registered} registered${event.capacity ? ` of ${event.capacity}` : ""}${event.waitlist ? `, ${event.waitlist} on the waitlist` : ""}`}
                            >
                                <span className="reg-chart-label">
                                    <strong>{event.title}</strong>
                                    <small>{formatDate(event.startAt)}</small>
                                </span>
                                <span className="reg-chart-plot">
                                    <span className="reg-chart-grid" aria-hidden="true">
                                        {ticks.map((tick) => (
                                            <i key={tick} style={{ left: `${(tick / max) * 100}%` }} />
                                        ))}
                                    </span>
                                    {event.capacity && <span className="reg-chart-track" style={{ width: `${(event.capacity / max) * 100}%` }} />}
                                    <span className="reg-chart-bar" style={{ width: `${(event.registered / max) * 100}%` }} />
                                    <span className="reg-chart-value" style={{ left: `${(Math.max(event.registered, event.capacity || 0) / max) * 100}%` }}>
                                        {event.registered}
                                        {event.capacity ? <span className="subtle"> / {event.capacity}</span> : null}
                                        {event.waitlist > 0 && <span className="reg-chart-wait"> +{event.waitlist} waiting</span>}
                                    </span>
                                    {isActive && (
                                        <span className="chart-tooltip" role="tooltip">
                                            <strong>{event.title}</strong>
                                            <span>{stateLabel(event)} · {formatDate(event.startAt)}</span>
                                            <span>
                                                {plural(event.registered, "registration")}
                                                {event.capacity ? ` of ${event.capacity} seats (${fill}%)` : " · no seat limit"}
                                            </span>
                                            {event.waitlist > 0 && <span>{event.waitlist} on the waitlist</span>}
                                        </span>
                                    )}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

const RegistrationsTable = ({ events }) => (
    <div className="table-wrap">
        <table className="table">
            <thead>
                <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="num">Registered</th>
                    <th className="num">Capacity</th>
                    <th className="num">Filled</th>
                    <th className="num">Waitlist</th>
                </tr>
            </thead>
            <tbody>
                {events.map((event) => (
                    <tr key={event._id}>
                        <td>
                            <Link to={`/events/${event._id}/participants`}>{event.title}</Link>
                        </td>
                        <td className="nowrap">{formatDate(event.startAt)}</td>
                        <td>{stateLabel(event)}</td>
                        <td className="num">{event.registered}</td>
                        <td className="num">{event.capacity ?? "—"}</td>
                        <td className="num">{event.capacity ? `${Math.round((event.registered / event.capacity) * 100)}%` : "—"}</td>
                        <td className="num">{event.waitlist || "—"}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// The president's view of how the club is doing.
export const ClubInsights = ({ insights, clubId }) => {
    const [view, setView] = useState("chart");
    const events = insights.eventWise;

    return (
        <section className="club-insights" aria-label="Club insights">
            <div className="row-between" style={{ padding: "4px 20px 0" }}>
                <div className="section-title" style={{ margin: 0 }}>
                    Club insights
                </div>
                <span className="subtle small">Published and completed events</span>
            </div>
            <div className="insight-tiles">
                <Link to={`/clubs/${clubId}/members`} className="stat-link">
                    <StatTile label="Total members" value={compact(insights.totalMembers)} icon={Users} />
                </Link>
                <StatTile
                    label="Total events"
                    value={compact(insights.totalEvents)}
                    icon={CalendarDays}
                    hint={insights.eventsInPipeline ? `+${insights.eventsInPipeline} in the pipeline` : null}
                />
                <StatTile
                    label="Total registrations"
                    value={compact(insights.totalRegistrations)}
                    icon={Ticket}
                    hint={insights.waitlisted ? `+${insights.waitlisted} on waitlists` : null}
                />
                <StatTile label="Upcoming events" value={insights.upcomingEvents} icon={CalendarClock} />
                <StatTile label="Completed events" value={insights.completedEvents} icon={CalendarCheck2} />
                <StatTile
                    label="Average participation"
                    value={insights.averageParticipation}
                    icon={Gauge}
                    hint={insights.seatFillRate !== null ? `per event · ${insights.seatFillRate}% of seats filled` : "registrations per event"}
                />
            </div>

            <div className="insight-chart">
                <div className="row-between">
                    <div>
                        <h3 className="row" style={{ margin: 0, gap: 8 }}>
                            <BarChart3 size={16} /> Event-wise registrations
                        </h3>
                        <p className="subtle small" style={{ margin: "2px 0 0" }}>
                            Filled bar: registered · light bar: seats available
                            {events.length < insights.totalEvents ? ` · latest ${events.length} events` : ""}
                        </p>
                    </div>
                    {events.length > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView(view === "chart" ? "table" : "chart")} aria-pressed={view === "table"}>
                            {view === "chart" ? <Table2 size={14} /> : <BarChart3 size={14} />} {view === "chart" ? "Table" : "Chart"}
                        </button>
                    )}
                </div>
                {events.length === 0 ? (
                    <p className="subtle" style={{ margin: "12px 0 0" }}>
                        Registrations per event appear here once your first event is published.
                    </p>
                ) : view === "chart" ? (
                    <RegistrationsChart events={events} />
                ) : (
                    <RegistrationsTable events={events} />
                )}
            </div>
        </section>
    );
};
