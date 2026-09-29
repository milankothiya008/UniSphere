import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    ArrowRight,
    Bell,
    Building2,
    CalendarCheck2,
    CalendarDays,
    ChevronRight,
    Clock,
    Compass,
    FileSignature,
    FileText,
    History,
    Hourglass,
    Lightbulb,
    MapPin,
    Plus,
    Sparkles,
    Trophy
} from "lucide-react";
import { eventApi, notificationApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { EventRow } from "../events/EventCard";
import { Avatar, Badge, Button, ButtonLink, Card, RoleBadge, StatusBadge } from "../ui";
import { ClubHQ } from "./ClubHQ";
import { ApplicationRow } from "../recruitment/ApplicationRow";
import { NotificationIcon } from "../notifications/NotificationIcon";
import { countdownParts, daysUntil, formatDate, formatDateLong, formatTimeRange, humanize, plural, timeAgo } from "../../lib/format";
import { Hero, greeting, todayLabel } from "./DashboardHero";

const HOUR = 3600000;

// Re-renders every `ms` so countdowns and "Live now" labels stay current.
const useNow = (ms = 30000) => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(timer);
    }, [ms]);
    return now;
};

const isLiveAt = (event, now) => new Date(event.startAt).getTime() <= now && new Date(event.endAt).getTime() > now;

const NextUp = ({ registration, now }) => {
    if (!registration) {
        return (
            <Link to="/feed" className="next-up next-up-empty">
                <span className="next-up-label">
                    <CalendarDays size={14} /> Your calendar is clear
                </span>
                <strong>Find something to go to</strong>
                <span>Register for an event and a live countdown to it appears here.</span>
                <span className="next-up-cta">
                    Explore events <ArrowRight size={14} />
                </span>
            </Link>
        );
    }

    const { event } = registration;
    const live = isLiveAt(event, now);

    return (
        <Link to={`/events/${event._id}`} className="next-up">
            <span className="next-up-label">
                {live ? (
                    <>
                        <span className="live-dot" /> Happening now
                    </>
                ) : (
                    <>
                        <Clock size={14} /> Next up
                    </>
                )}
            </span>
            <strong>{event.title}</strong>
            <span>
                {formatDateLong(event.startAt)} · {formatTimeRange(event.startAt, event.endAt)}
            </span>
            <span className="row" style={{ gap: 6 }}>
                <MapPin size={13} /> {[event.venue?.name, event.club?.name].filter(Boolean).join(" · ")}
            </span>
            {!live && (
                <div className="countdown" aria-label="Time until the event starts">
                    {countdownParts(new Date(event.startAt).getTime() - now).map(([value, unit]) => (
                        <span key={unit}>
                            <b>{value}</b>
                            {unit}
                        </span>
                    ))}
                </div>
            )}
        </Link>
    );
};

const DayBadge = ({ event, now }) => {
    if (isLiveAt(event, now)) {
        return (
            <span className="live-chip">
                <span className="live-dot" /> Live now
            </span>
        );
    }
    const days = daysUntil(event.startAt, now);
    if (days <= 0) {
        return <Badge tone="warning">Today</Badge>;
    }
    if (days === 1) {
        return <Badge tone="info">Tomorrow</Badge>;
    }
    return <Badge>In {days} days</Badge>;
};

const CompactEmpty = ({ icon: Icon, title, text, action }) => (
    <div className="compact-empty">
        <span className="compact-empty-icon">
            <Icon size={18} />
        </span>
        <div className="grow">
            <strong>{title}</strong>
            <small>{text}</small>
        </div>
        {action}
    </div>
);

// `pinnedId` is the event already shown in the "Next up" banner; it is left out here so nothing repeats.
const Schedule = ({ upcoming: all, waitlisted, past, now, pinnedId }) => {
    const [tab, setTab] = useState("upcoming");
    const upcoming = all.filter((registration) => registration.event._id !== pinnedId);
    const tabs = [
        ["upcoming", "Upcoming", CalendarDays, upcoming.length],
        ...(waitlisted.length ? [["waitlist", "Waitlist", Hourglass, waitlisted.length]] : []),
        ["past", "Past", History, past.length]
    ];
    const items = tab === "upcoming" ? upcoming : tab === "waitlist" ? waitlisted : past;

    return (
        <Card
            className="dash-card"
            title={
                <h2 className="row">
                    <CalendarCheck2 size={18} /> My schedule
                </h2>
            }
            actions={
                <Link to={`/my-registrations${tab === "past" ? "?timeframe=past" : ""}`} className="small link-arrow">
                    View all <ChevronRight size={14} />
                </Link>
            }
            padded={false}
        >
            <div className="pill-tabs" role="tablist" aria-label="Schedule">
                {tabs.map(([value, label, Icon, count]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} className={`pill-tab ${tab === value ? "active" : ""}`} onClick={() => setTab(value)}>
                        <Icon size={14} /> {label} <span className="count">{count}</span>
                    </button>
                ))}
            </div>

            {items.length === 0 ? (
                tab === "upcoming" ? (
                    <CompactEmpty
                        icon={CalendarCheck2}
                        title={pinnedId ? "Nothing else scheduled" : "Nothing on your schedule"}
                        text={pinnedId ? "Your next event is pinned at the top." : "Pick an event below and register in one click."}
                        action={
                            <ButtonLink to="/feed" size="sm" variant="secondary">
                                Browse
                            </ButtonLink>
                        }
                    />
                ) : (
                    <CompactEmpty icon={History} title="No past events yet" text="Events you attended appear here with their results." />
                )
            ) : (
                <div className="list-rows">
                    {items.map((registration) =>
                        tab === "upcoming" ? (
                            <EventRow key={registration._id} event={registration.event} right={<DayBadge event={registration.event} now={now} />} />
                        ) : tab === "waitlist" ? (
                            <EventRow
                                key={registration._id}
                                event={registration.event}
                                right={
                                    <Badge tone="warning">
                                        <Hourglass size={11} /> #{registration.waitlistPosition} in line
                                    </Badge>
                                }
                            />
                        ) : (
                            <EventRow
                                key={registration._id}
                                event={registration.event}
                                right={
                                    registration.hasResults ? (
                                        <Badge tone="gold">
                                            <Trophy size={12} /> Results out
                                        </Badge>
                                    ) : (
                                        <StatusBadge status={registration.event.status} />
                                    )
                                }
                            />
                        )
                    )}
                </div>
            )}
        </Card>
    );
};

const RecommendCard = ({ event, now, onRegistered }) => {
    const toast = useToast();
    const [pending, setPending] = useState(false);
    const closesIn = new Date(event.registrationEnd).getTime() - now;
    const taken = event.maxParticipants ? Math.min(100, Math.round((event.registeredCount / event.maxParticipants) * 100)) : null;

    const register = async () => {
        setPending(true);
        try {
            const response = await eventApi.register(event._id);
            if (response.data?.waitlisted) {
                toast.info(`${event.title} is full — you're #${response.data.waitlistPosition} on the waitlist`);
            } else {
                toast.success(`You're registered for ${event.title}`);
            }
            onRegistered(event, response.data);
        } catch (error) {
            toast.error(error);
            setPending(false);
        }
    };

    return (
        <article className="card rec-card">
            <Link to={`/events/${event._id}`} className="rec-media" aria-label={`Open ${event.title}`}>
                {event.poster ? <img src={event.poster} alt="" loading="lazy" /> : <span className="rec-fallback">{humanize(event.category)}</span>}
                <span className="rec-date">{formatDate(event.startAt).replace(/ \d{4}$/, "")}</span>
            </Link>
            <div className="rec-body">
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {event.fromMyClub && <Badge tone="ink">Your club</Badge>}
                    {closesIn < 48 * HOUR && (
                        <Badge tone="warning">
                            <Hourglass size={11} /> Closes {closesIn < HOUR ? "within the hour" : `in ${Math.round(closesIn / HOUR)}h`}
                        </Badge>
                    )}
                    {!event.fromMyClub && closesIn >= 48 * HOUR && <Badge>{humanize(event.category)}</Badge>}
                </div>
                <Link to={`/events/${event._id}`} className="rec-title">
                    {event.title}
                </Link>
                <span className="subtle">
                    {event.club?.name} · {formatTimeRange(event.startAt, event.endAt)}
                    {event.venue?.name ? ` · ${event.venue.name}` : ""}
                </span>
                {taken !== null && (
                    <div className="seat-meter" title={`${event.registeredCount} of ${event.maxParticipants} spots taken`}>
                        <span className="seat-bar">
                            <span style={{ width: `${taken}%` }} className={taken >= 80 ? "hot" : ""} />
                        </span>
                        <span className="subtle">{event.maxParticipants - event.registeredCount} spots left</span>
                    </div>
                )}
                <div className="row-between rec-actions">
                    <Button size="sm" onClick={register} loading={pending}>
                        <CalendarCheck2 size={15} /> Register
                    </Button>
                    <Link to={`/events/${event._id}`} className="small link-arrow">
                        Details <ChevronRight size={14} />
                    </Link>
                </div>
            </div>
        </article>
    );
};

const FILTERS = [
    { value: "all", label: "All" },
    { value: "clubs", label: "From my clubs", test: (event) => event.fromMyClub },
    { value: "closing", label: "Closing soon", test: (event, now) => new Date(event.registrationEnd).getTime() - now < 48 * HOUR }
];

const Recommended = ({ events, now, onRegistered }) => {
    const [filter, setFilter] = useState("all");
    const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.test ? events.filter((e) => f.test(e, now)).length : events.length]));
    const active = FILTERS.find((f) => f.value === filter && (!f.test || counts[f.value] > 0)) || FILTERS[0];
    const shown = active.test ? events.filter((e) => active.test(e, now)) : events;
    const filters = FILTERS.filter((f) => !f.test || counts[f.value] > 0);

    return (
        <section className="stack">
            <div className="section-head">
                <div>
                    <h2 className="row">
                        <Sparkles size={18} className="section-icon" /> Recommended for you
                    </h2>
                    <span className="subtle">Open for registration and eligible for you.</span>
                </div>
                <Link to="/feed" className="small link-arrow">
                    Campus feed <ChevronRight size={14} />
                </Link>
            </div>

            {events.length > 0 && filters.length > 1 && (
                <div className="chip-filters" role="tablist" aria-label="Filter recommendations">
                    {filters.map((f) => (
                        <button key={f.value} type="button" role="tab" aria-selected={active.value === f.value} className={`chip-filter ${active.value === f.value ? "active" : ""}`} onClick={() => setFilter(f.value)}>
                            {f.label} <span>{counts[f.value]}</span>
                        </button>
                    ))}
                </div>
            )}

            {shown.length ? (
                <div className="rec-grid stagger">
                    {shown.map((event) => (
                        <RecommendCard key={event._id} event={event} now={now} onRegistered={onRegistered} />
                    ))}
                </div>
            ) : (
                <Card>
                    <CompactEmpty
                        icon={Compass}
                        title="You're all caught up"
                        text="Nothing new you can register for right now."
                        action={
                            <ButtonLink to="/feed" size="sm" variant="secondary">
                                Open feed
                            </ButtonLink>
                        }
                    />
                </Card>
            )}
        </section>
    );
};

const Activity = ({ items: initial }) => {
    const navigate = useNavigate();
    const [items, setItems] = useState(initial);

    const open = async (item) => {
        if (!item.readAt) {
            await notificationApi.markRead(item._id).catch(() => {});
            setItems((list) => list.map((n) => (n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n)));
        }
        if (item.link) {
            navigate(item.link);
        }
    };

    return (
        <Card
            className="dash-card"
            title={
                <h2 className="row">
                    <Bell size={16} /> Recent activity
                </h2>
            }
            actions={
                <Link to="/notifications" className="small link-arrow">
                    View all <ChevronRight size={14} />
                </Link>
            }
            padded={false}
        >
            {items.length ? (
                <div className="activity-list">
                    {items.map((item) => {
                        return (
                            <button key={item._id} type="button" className={`activity-item ${item.readAt ? "" : "unread"}`} onClick={() => open(item)}>
                                <NotificationIcon type={item.type} />
                                <span className="grow" style={{ minWidth: 0 }}>
                                    <span className="activity-title">{item.title}</span>
                                    <span className="subtle">{timeAgo(item.createdAt)}</span>
                                </span>
                                {!item.readAt && <span className="unread-dot" aria-label="Unread" />}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <CompactEmpty icon={Bell} title="No activity yet" text="New events, results and announcements show up here." />
            )}
        </Card>
    );
};

// Clubs already shown in Club HQ are not listed again here.
const MyClubs = ({ memberships, hiddenClubIds }) => {
    const visible = memberships.filter((m) => !hiddenClubIds.has(m.club._id));
    if (!visible.length && hiddenClubIds.size) {
        return null;
    }

    return (
        <Card
            className="dash-card"
            title={
                <h2 className="row">
                    <Building2 size={16} /> {hiddenClubIds.size ? "Other clubs" : "My clubs"}
                </h2>
            }
            actions={
                <Link to="/clubs?view=mine" className="small link-arrow">
                    View all <ChevronRight size={14} />
                </Link>
            }
            padded={false}
        >
            {visible.length ? (
                <div className="list-rows">
                    {visible.map((m) => (
                        <Link key={m._id} to={`/clubs/${m.club._id}`} className="list-row">
                            <Avatar name={m.club.name} src={m.club.logo} size="sm" square />
                            <span className="grow title">{m.club.name}</span>
                            <RoleBadge role={m.role} label={m.roleName} />
                        </Link>
                    ))}
                </div>
            ) : (
                <CompactEmpty
                    icon={Building2}
                    title="No clubs yet"
                    text="Clubs for your department are waiting for you."
                    action={
                        <ButtonLink to="/clubs" size="sm" variant="secondary">
                            Find clubs
                        </ButtonLink>
                    }
                />
            )}
        </Card>
    );
};

// Recruitment the student applied to: status and the next interview.
const MyApplications = ({ applications }) =>
    applications?.length ? (
        <Card
            className="dash-card"
            title={
                <h2 className="row">
                    <FileSignature size={16} /> My applications
                </h2>
            }
            actions={
                <Link to="/my-applications" className="small link-arrow">
                    View all <ChevronRight size={14} />
                </Link>
            }
            padded={false}
        >
            <div className="recruit-dash-list">
                {applications.slice(0, 4).map((application) => (
                    <ApplicationRow key={application._id} application={application} compact />
                ))}
            </div>
        </Card>
    ) : null;

const Proposals = ({ requests }) =>
    requests.length ? (
        <Card
            className="dash-card"
            title={
                <h2 className="row">
                    <FileText size={16} /> Club proposals
                </h2>
            }
            actions={
                <ButtonLink to="/club-requests/new" size="sm" variant="ghost">
                    <Plus size={14} /> Propose
                </ButtonLink>
            }
            padded={false}
        >
            <div className="list-rows">
                {requests.map((request) => (
                    <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                        <span className="grow title">{request.name}</span>
                        <StatusBadge status={request.status} />
                    </Link>
                ))}
            </div>
        </Card>
    ) : (
        <Link to="/club-requests/new" className="card card-link propose-card">
            <span className="action-icon tone-gold">
                <Lightbulb size={16} />
            </span>
            <span className="grow">
                <strong>Start a new club</strong>
                <small>Have an idea? Propose it with your friends.</small>
            </span>
            <ChevronRight size={16} className="subtle" />
        </Link>
    );

export const StudentDashboard = ({ user, data }) => {
    const { student } = data;
    const now = useNow();
    const [schedule, setSchedule] = useState(student.upcomingRegistrations);
    const [waitlisted, setWaitlisted] = useState(student.waitlistedRegistrations || []);
    const [recommended, setRecommended] = useState(student.recommended);

    // Registering from a recommendation moves the event into the schedule (or the waitlist), so it is never shown twice.
    const handleRegistered = (event, result) => {
        setRecommended((list) => list.filter((e) => e._id !== event._id));
        if (result?.waitlisted) {
            setWaitlisted((list) => [...list, { _id: `wl-${event._id}`, status: "WAITLISTED", waitlistPosition: result.waitlistPosition, event }]);
            return;
        }
        setSchedule((list) =>
            [...list, { _id: `new-${event._id}`, event: { ...event, registeredCount: result?.registeredCount ?? event.registeredCount + 1 } }].sort(
                (a, b) => new Date(a.event.startAt) - new Date(b.event.startAt)
            )
        );
    };

    const next = useMemo(() => schedule.find((r) => new Date(r.event.endAt).getTime() > now), [schedule, now]);
    const firstName = user.name.split(" ")[0];
    const workspaces = student.clubWorkspaces;
    const workspaceClubIds = useMemo(() => new Set(workspaces.map((w) => w.club._id)), [workspaces]);

    const stats = [
        { label: "upcoming", value: schedule.length, to: "/my-registrations", icon: CalendarCheck2 },
        ...(waitlisted.length ? [{ label: "on waitlist", value: waitlisted.length, to: "/my-registrations", icon: Hourglass }] : []),
        { label: "attended", value: student.stats.attended, to: "/my-registrations?timeframe=past", icon: Trophy },
        { label: student.stats.clubs === 1 ? "club" : "clubs", value: student.stats.clubs, to: "/clubs?view=mine", icon: Building2 }
    ];

    return (
        <div className="stack-lg dashboard stagger">
            <Hero
                eyebrow={todayLabel()}
                title={`${greeting()}, ${firstName}`}
                subtitle={
                    recommended.length
                        ? `${plural(recommended.length, "event")} ${recommended.length === 1 ? "is" : "are"} open for you to join.`
                        : "Here's what's happening across your clubs and events."
                }
                stats={stats}
                actions={
                    <>
                        <ButtonLink to="/feed" variant="accent">
                            <Compass size={16} /> Explore events
                        </ButtonLink>
                        <ButtonLink to="/clubs" variant="secondary" className="btn-glass">
                            <Building2 size={16} /> Browse clubs
                        </ButtonLink>
                    </>
                }
                aside={<NextUp registration={next} now={now} />}
            />

            {workspaces.length > 0 && <ClubHQ workspaces={workspaces} />}

            <div className="dash-grid">
                <div className="stack-lg">
                    <Schedule upcoming={schedule} waitlisted={waitlisted} past={student.pastRegistrations} now={now} pinnedId={next?.event._id} />
                    <Recommended events={recommended} now={now} onRegistered={handleRegistered} />
                </div>

                <aside className="stack">
                    <Activity items={student.recentNotifications} />
                    <MyApplications applications={student.applications} />
                    <MyClubs memberships={student.memberships} hiddenClubIds={workspaceClubIds} />
                    <Proposals requests={student.clubRequests} />
                </aside>
            </div>
        </div>
    );
};
