import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    CalendarCheck2,
    CalendarDays,
    CalendarPlus,
    CheckCircle2,
    ChevronRight,
    Clock,
    Flame,
    Hourglass,
    ListPlus,
    MapPin,
    Share2,
    Trophy,
    Users
} from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useReveal } from "../../hooks/useReveal";
import { Avatar, Badge, Button, MediaFill } from "../ui";
import { Podium } from "../feed/FeedCard";
import { dateParts, formatDate, formatDateTime, formatTimeRange, humanize, timeAgo } from "../../lib/format";
import { eligibilityProblem, isLive, isPast } from "../../lib/eligibility";
import { categoryStyle, categoryVars, startsInLabel } from "../../lib/eventVisuals";
import { downloadIcs } from "../../lib/calendar";

// Pill over the poster: live pulse, a countdown, or where the results stand.
const PosterStatus = ({ event, live, past }) => {
    if (live) {
        return (
            <span className="poster-pill poster-pill-live">
                <span className="live-dot" /> Live now
            </span>
        );
    }
    if (past) {
        return (
            <span className="poster-pill">
                {event.result || event.resultStage ? <Trophy size={13} /> : <CheckCircle2 size={13} />}
                {event.result ? "Results out" : event.resultStage === "rounds" ? "Round results out" : "Completed"}
            </span>
        );
    }
    const label = startsInLabel(event.startAt);
    return label ? (
        <span className="poster-pill">
            <Clock size={13} /> {label}
        </span>
    ) : null;
};

// A short celebratory burst around the "You're going" pill.
const Burst = () => (
    <span className="burst" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
            <i key={index} style={{ "--angle": `${index * 30}deg` }} className={`burst-${index % 3}`} />
        ))}
    </span>
);

const Capacity = ({ event }) => {
    const { registeredCount: going, maxParticipants: max, waitlistCount: waiting = 0 } = event;
    const unit = event.participationMode === "TEAM" ? "teams" : "going";
    const fill = max ? Math.min(100, Math.round((going / max) * 100)) : null;
    const left = max ? Math.max(0, max - going) : null;

    return (
        <div className="post-capacity">
            <div className="post-capacity-top">
                <span className="post-going">
                    <Users size={14} /> {max ? `${going} / ${max} ${unit}` : `${going} ${unit}`}
                </span>
                {max && left === 0 ? (
                    <span className="post-capacity-flag is-full">
                        <Hourglass size={12} /> Full{waiting ? ` · ${waiting} waiting` : " · join the waitlist"}
                    </span>
                ) : fill !== null && fill >= 75 ? (
                    <span className="post-capacity-flag">
                        <Flame size={12} /> Filling fast · {left} left
                    </span>
                ) : left !== null ? (
                    <span className="subtle">{left} spots left</span>
                ) : null}
            </div>
            {fill !== null && (
                <span className="post-capacity-bar" aria-hidden="true">
                    <span style={{ "--fill": `${fill}%` }} className={fill >= 100 ? "is-full" : fill >= 75 ? "is-hot" : ""} />
                </span>
            )}
        </div>
    );
};

// Instagram-style event post: club header, poster with date and status, actions, capacity, caption and results.
export const EventPost = ({ event: initial, onRegistered, index = 0 }) => {
    const { user, isStudent } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [ref, revealed] = useReveal();
    const [event, setEvent] = useState(initial);
    const [pending, setPending] = useState(false);
    const [celebrate, setCelebrate] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!celebrate) {
            return undefined;
        }
        const timer = setTimeout(() => setCelebrate(false), 900);
        return () => clearTimeout(timer);
    }, [celebrate]);

    const link = `/events/${event._id}`;
    const past = isPast(event);
    const live = isLive(event);
    const registered = event.myRegistration === "REGISTERED";
    const waitlisted = event.myRegistration === "WAITLISTED";
    const problem = isStudent ? eligibilityProblem(user, event) : null;
    const full = event.registrationState === "FULL";
    // A full event still takes sign-ups: they go on the waitlist.
    const canRegister = isStudent && !registered && !waitlisted && !past && !live && ["OPEN", "FULL"].includes(event.registrationState) && !problem;
    const CategoryIcon = categoryStyle(event.category).icon;
    const { month, day } = dateParts(event.startAt);

    const register = async () => {
        setPending(true);
        try {
            const response = await eventApi.register(event._id);
            const joinedWaitlist = Boolean(response.data.waitlisted);
            setEvent((prev) => ({
                ...prev,
                myRegistration: joinedWaitlist ? "WAITLISTED" : "REGISTERED",
                registeredCount: response.data.registeredCount ?? prev.registeredCount,
                waitlistCount: response.data.waitlistCount ?? prev.waitlistCount
            }));
            if (joinedWaitlist) {
                toast.info(`${event.title} is full — you're #${response.data.waitlistPosition} on the waitlist`);
            } else {
                setCelebrate(true);
                toast.success(`You're registered for ${event.title}`);
                onRegistered?.(event);
            }
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const share = async () => {
        const url = `${window.location.origin}${link}`;
        try {
            // Phones get the native share sheet; desktops copy the link, which is what people expect there.
            const touch = window.matchMedia?.("(pointer: coarse)").matches;
            if (touch && navigator.share) {
                await navigator.share({ title: event.title, text: event.shortDescription, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            toast.success("Link copied — share it with your friends");
        } catch (error) {
            if (error?.name !== "AbortError") {
                toast.error("Couldn't share this event");
            }
        }
    };

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
            <span className={`going-pill ${celebrate ? "just-joined" : ""}`}>
                <CheckCircle2 size={15} /> You're going
                {celebrate && <Burst />}
            </span>
        );
    } else if (waitlisted) {
        action = (
            <Badge tone="warning">
                <Hourglass size={13} /> On the waitlist
            </Badge>
        );
    } else if (canRegister && event.participationMode === "TEAM") {
        // Teams are registered on the event page, where the leader names the team and invites teammates.
        action = (
            <Button size="sm" variant={full ? "secondary" : "primary"} onClick={() => navigate(`${link}?register=team`)} className="register-btn">
                <Users size={15} /> {full ? "Join waitlist as a team" : "Register team"}
            </Button>
        );
    } else if (canRegister) {
        action = (
            <Button size="sm" variant={full ? "secondary" : "primary"} onClick={register} loading={pending} className="register-btn">
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

    const note =
        !past && !registered && !waitlisted && isStudent
            ? problem ||
              (live
                  ? "Happening right now"
                  : {
                        NOT_OPEN: `Registration opens ${formatDateTime(event.registrationStart)}`,
                        CLOSED: "Registration closed"
                    }[event.registrationState])
            : null;

    const longDescription = (event.shortDescription || "").length > 120;

    return (
        <article
            ref={ref}
            className={`card event-post ${live ? "is-live" : ""} ${revealed ? "is-revealed" : ""}`}
            style={{ ...categoryVars(event.category), "--reveal-delay": `${Math.min(index % 4, 3) * 70}ms` }}
        >
            <header className="event-post-head">
                <Link to={`/clubs/${event.club?._id}`} className="event-post-club">
                    <span className="post-avatar-ring">
                        <Avatar name={event.club?.name} src={event.club?.logo} />
                    </span>
                    <span>
                        <strong>{event.club?.name}</strong>
                        <span className="subtle">{event.publishedAt ? `Posted ${timeAgo(event.publishedAt)}` : humanize(event.category)}</span>
                    </span>
                </Link>
                <span className="category-chip">
                    <CategoryIcon size={13} /> {humanize(event.category)}
                </span>
            </header>

            <Link to={link} className="event-post-media" aria-label={`Open ${event.title}`}>
                {event.poster ? (
                    <MediaFill src={event.poster} alt={`${event.title} poster`} />
                ) : (
                    <div className="event-post-fallback">
                        <CategoryIcon className="fallback-art" size={200} strokeWidth={1} aria-hidden="true" />
                        <span>{humanize(event.category)}</span>
                        <strong>{event.title}</strong>
                        <span>
                            {formatDate(event.startAt)} · {formatTimeRange(event.startAt, event.endAt)}
                        </span>
                    </div>
                )}
                <span className="poster-shade" aria-hidden="true" />
                <span className="poster-date" aria-hidden="true">
                    <small>{month}</small>
                    <b>{day}</b>
                </span>
                <span className="poster-status">
                    <PosterStatus event={event} live={live} past={past} />
                </span>
            </Link>

            <div className="event-post-actions">
                <div className="post-primary">{action}</div>
                <div className="post-tools">
                    {!past && (
                        <button type="button" className="tool-btn" onClick={() => downloadIcs(event)} aria-label="Add to calendar" title="Add to calendar">
                            <CalendarPlus size={18} />
                        </button>
                    )}
                    <button type="button" className="tool-btn" onClick={share} aria-label="Share event" title="Share">
                        <Share2 size={18} />
                    </button>
                </div>
            </div>

            {!past && <Capacity event={event} />}

            <div className="event-post-body">
                <Link to={link} className="event-post-title">
                    {event.title}
                </Link>
                {event.shortDescription && (
                    <p className={`muted post-description ${expanded || !longDescription ? "" : "is-clamped"}`}>
                        {event.shortDescription}
                        {longDescription && !expanded && (
                            <button type="button" className="more-btn" onClick={() => setExpanded(true)}>
                                more
                            </button>
                        )}
                    </p>
                )}
                <div className="event-post-meta">
                    {event.participationMode === "TEAM" && (
                        <span>
                            <Users size={14} /> Teams of {event.minTeamSize === event.maxTeamSize ? event.maxTeamSize : `${event.minTeamSize}–${event.maxTeamSize}`}
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
