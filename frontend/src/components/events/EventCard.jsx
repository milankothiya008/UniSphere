import { Link } from "react-router-dom";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { Badge, StatusBadge } from "../ui";
import { dateParts, formatDate, formatTimeRange, humanize } from "../../lib/format";
import { categoryStyle, categoryVars } from "../../lib/eventVisuals";

// Large faded category icon used as artwork on poster-less covers.
export const CategoryArt = ({ category, size = 180 }) => {
    const Icon = categoryStyle(category).icon;
    return <Icon className="category-art" size={size} strokeWidth={1} aria-hidden="true" />;
};

const registrationBadge = (event) => {
    if (event.myRegistration === "REGISTERED") {
        return <Badge tone="success" dot>You're registered</Badge>;
    }
    if (event.myRegistration === "WAITLISTED") {
        return <Badge tone="warning" dot>{event.waitlistPosition ? `Waitlist #${event.waitlistPosition}` : "On the waitlist"}</Badge>;
    }
    if (event.status === "PUBLISHED") {
        return <StatusBadge status={event.registrationState} />;
    }
    return <StatusBadge status={event.status} />;
};

export const EventCover = ({ event, showDate = true }) => {
    const { month, day } = dateParts(event.startAt);
    return (
        <div className="event-cover" style={categoryVars(event.category)}>
            {event.poster ? (
                <img src={event.poster} alt="" loading="lazy" />
            ) : (
                <div className="cover-fallback">
                    <CategoryArt category={event.category} size={130} />
                    <span>{event.club?.name || humanize(event.category)}</span>
                </div>
            )}
            {showDate && (
                <div className="date-chip">
                    <div className="mon">{month}</div>
                    <div className="day">{day}</div>
                </div>
            )}
            <Badge tone="ink">{humanize(event.category)}</Badge>
        </div>
    );
};

export const EventCard = ({ event, showStatus = false }) => (
    <Link to={`/events/${event._id}`} className="card card-link event-card">
        <EventCover event={event} />
        <div className="event-card-body">
            <div className="stack-sm" style={{ gap: 4 }}>
                <span className="subtle">{event.club?.name}</span>
                <h3>{event.title}</h3>
            </div>
            <div className="event-card-meta">
                {event.teamName && (
                    <span className="event-card-team">
                        <Users size={14} /> {event.teamName}
                        {event.teamRole === "LEADER" ? " · leader" : ""}
                    </span>
                )}
                <span>
                    <CalendarDays size={14} /> {formatDate(event.startAt)}
                </span>
                <span>
                    <Clock size={14} /> {formatTimeRange(event.startAt, event.endAt)}
                </span>
                {event.venue?.name && (
                    <span>
                        <MapPin size={14} /> {event.venue.name}
                    </span>
                )}
            </div>
            <div className="event-card-footer">
                {showStatus ? <StatusBadge status={event.status} /> : registrationBadge(event)}
                <span className="subtle row" style={{ gap: 5 }}>
                    <Users size={13} />
                    {event.registeredCount ?? 0}
                    {event.maxParticipants ? ` / ${event.maxParticipants}` : ""}
                    {event.participationMode === "TEAM" ? " teams" : ""}
                </span>
            </div>
        </div>
    </Link>
);

// Compact row used in dashboards and management lists.
export const EventRow = ({ event, to, right }) => (
    <Link to={to || `/events/${event._id}`} className="list-row">
        <div className="date-chip" style={{ position: "static", boxShadow: "none", border: "1px solid var(--border)" }}>
            <div className="mon">{dateParts(event.startAt).month}</div>
            <div className="day">{dateParts(event.startAt).day}</div>
        </div>
        <div className="grow">
            <div className="title">{event.title}</div>
            <div className="subtle">
                {[event.club?.name, formatTimeRange(event.startAt, event.endAt), event.venue?.name].filter(Boolean).join(" · ")}
            </div>
        </div>
        {right ?? <StatusBadge status={event.status} />}
    </Link>
);
