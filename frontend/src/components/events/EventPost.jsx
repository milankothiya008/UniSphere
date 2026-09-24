import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarCheck2, CalendarDays, CheckCircle2, ChevronRight, Clock, Hourglass, ListPlus, MapPin, Trophy, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Avatar, Badge, Button } from "../ui";
import { Podium } from "../feed/FeedCard";
import { formatDate, formatDateTime, formatTimeRange, humanize, timeAgo } from "../../lib/format";
import { eligibilityProblem, isLive, isPast } from "../../lib/eligibility";

const StatusChip = ({ event }) => {
    if (isLive(event)) {
        return (
            <span className="live-chip">
                <span className="live-dot" /> Live now
            </span>
        );
    }
    if (isPast(event)) {
        return <Badge tone="ink">{event.result ? "Results out" : event.resultStage === "rounds" ? "Round results out" : "Completed"}</Badge>;
    }
    return <Badge tone="info">{humanize(event.category)}</Badge>;
};

// Instagram-style event post: club header, poster, action row, caption and (for past events) results.
export const EventPost = ({ event: initial, onRegistered }) => {
    const { user, isStudent } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [event, setEvent] = useState(initial);
    const [pending, setPending] = useState(false);

    const link = `/events/${event._id}`;
    const past = isPast(event);
    const live = isLive(event);
    const registered = event.myRegistration === "REGISTERED";
    const waitlisted = event.myRegistration === "WAITLISTED";
    const problem = isStudent ? eligibilityProblem(user, event) : null;
    const full = event.registrationState === "FULL";
    // A full event still takes sign-ups: they go on the waitlist.
    const canRegister = isStudent && !registered && !waitlisted && !past && !live && ["OPEN", "FULL"].includes(event.registrationState) && !problem;

    const register = async () => {
        setPending(true);
        try {
            const response = await eventApi.register(event._id);
            const joinedWaitlist = Boolean(response.data.waitlisted);
            setEvent((prev) => ({
                ...prev,
                myRegistration: joinedWaitlist ? "WAITLISTED" : "REGISTERED",
                registeredCount: response.data.registeredCount,
                waitlistCount: response.data.waitlistCount
            }));
            if (joinedWaitlist) {
                toast.info(`${event.title} is full — you're #${response.data.waitlistPosition} on the waitlist`);
            } else {
                toast.success(`You're registered for ${event.title}`);
                onRegistered?.(event);
            }
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const seats = event.maxParticipants ? `${event.registeredCount} / ${event.maxParticipants} going` : `${event.registeredCount} going`;

    const hasResults = Boolean(event.resultStage || event.result);

    let action;
    if (past || (live && hasResults)) {
        action = (
            <Button variant={hasResults ? "accent" : "secondary"} size="sm" onClick={() => navigate(hasResults ? `/results/${event._id}` : link)}>
                {hasResults ? <Trophy size={15} /> : <ChevronRight size={15} />} {hasResults ? (event.result ? "View results" : "Live standings") : "View event"}
            </Button>
        );
    } else if (registered) {
        action = (
            <Badge tone="success">
                <CheckCircle2 size={13} /> You're going
            </Badge>
        );
    } else if (waitlisted) {
        action = (
            <Badge tone="warning">
                <Hourglass size={13} /> On the waitlist
            </Badge>
        );
    } else if (canRegister) {
        action = (
            <Button size="sm" variant={full ? "secondary" : "primary"} onClick={register} loading={pending}>
                {full ? <ListPlus size={15} /> : <CalendarCheck2 size={15} />} {full ? "Join waitlist" : "Register"}
            </Button>
        );
    } else {
        action = (
            <Button variant="secondary" size="sm" onClick={() => navigate(link)}>
                View details <ChevronRight size={15} />
            </Button>
        );
    }

    const note = !past && !registered && !waitlisted && isStudent
        ? problem ||
          (live
              ? "Happening right now"
              : {
                    NOT_OPEN: `Registration opens ${formatDateTime(event.registrationStart)}`,
                    CLOSED: "Registration closed",
                    FULL: event.waitlistCount ? `Full · ${event.waitlistCount} on the waitlist` : "Full · join the waitlist"
                }[event.registrationState])
        : null;

    return (
        <article className={`card event-post ${live ? "is-live" : ""}`}>
            <header className="event-post-head">
                <Link to={`/clubs/${event.club?._id}`} className="event-post-club">
                    <Avatar name={event.club?.name} src={event.club?.logo} square />
                    <span>
                        <strong>{event.club?.name}</strong>
                        <span className="subtle">{event.publishedAt ? `Posted ${timeAgo(event.publishedAt)}` : humanize(event.category)}</span>
                    </span>
                </Link>
                <StatusChip event={event} />
            </header>

            <Link to={link} className="event-post-media" aria-label={`Open ${event.title}`}>
                {event.poster ? (
                    <img src={event.poster} alt={`${event.title} poster`} loading="lazy" />
                ) : (
                    <div className="event-post-fallback">
                        <span>{humanize(event.category)}</span>
                        <strong>{event.title}</strong>
                        <span>
                            {formatDate(event.startAt)} · {formatTimeRange(event.startAt, event.endAt)}
                        </span>
                    </div>
                )}
            </Link>

            <div className="event-post-actions">
                {action}
                <span className="subtle row" style={{ gap: 5 }}>
                    <Users size={14} /> {seats}
                </span>
            </div>

            <div className="event-post-body">
                <Link to={link} className="event-post-title">
                    {event.title}
                </Link>
                <p className="muted">{event.shortDescription}</p>
                <div className="event-post-meta">
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
                    {!past && !live && (
                        <span>
                            <Hourglass size={14} /> Register by {formatDateTime(event.registrationEnd)}
                        </span>
                    )}
                </div>
                {note && <span className="event-post-note">{note}</span>}

                {past && event.result && (
                    <div className="event-post-results">
                        <div className="section-title" style={{ marginBottom: 6 }}>
                            <Trophy size={13} style={{ verticalAlign: "-2px" }} /> Results
                        </div>
                        <Podium awards={event.result.awards} />
                    </div>
                )}
            </div>
        </article>
    );
};
