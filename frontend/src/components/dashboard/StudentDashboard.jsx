import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Bell,
    Building2,
    CalendarCheck2,
    CalendarDays,
    ChevronRight,
    ClipboardCheck,
    Clock,
    Compass,
    FileText,
    History,
    Hourglass,
    MapPin,
    Plus,
    Sparkles,
    Trophy,
    UserPlus,
    Users
} from "lucide-react";
import { eventApi, notificationApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { EventRow } from "../events/EventCard";
import { Avatar, Badge, Button, ButtonLink, Card, EmptyState, RoleBadge, StatTile, StatusBadge } from "../ui";
import { ClubInsights } from "./ClubInsights";
import { countdownParts, daysUntil, formatDate, formatDateLong, formatTimeRange, humanize, plural, timeAgo } from "../../lib/format";
import { PERMISSIONS } from "../../lib/constants";
import { Hero, greeting } from "./DashboardHero";

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
            <div className="next-up next-up-empty">
                <span className="next-up-label">
                    <CalendarDays size={14} /> Your calendar is clear
                </span>
                <strong>Find something to go to</strong>
                <span>Register for an event and a countdown to it appears here.</span>
            </div>
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

const StatLink = ({ to, ...props }) => (
    <Link to={to} className="stat-link">
        <StatTile {...props} />
    </Link>
);

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

// `pinnedId` is the event already shown in the "Next up" banner; it is left out here so nothing repeats.
const Schedule = ({ upcoming: all, past, now, pinnedId }) => {
    const [tab, setTab] = useState("upcoming");
    const upcoming = all.filter((registration) => registration.event._id !== pinnedId);
    const items = tab === "upcoming" ? upcoming : past;

    return (
        <Card
            title={
                <h2 className="row">
                    <CalendarCheck2 size={18} /> My schedule
                </h2>
            }
            actions={
                <Link to={`/my-registrations${tab === "past" ? "?timeframe=past" : ""}`} className="small">
                    View all
                </Link>
            }
            padded={false}
        >
            <div className="feed-tabs schedule-tabs" role="tablist">
                {[
                    ["upcoming", "Upcoming", CalendarDays, upcoming.length],
                    ["past", "Past", History, past.length]
                ].map(([value, label, Icon, count]) => (
                    <button key={value} type="button" role="tab" aria-selected={tab === value} className={`feed-tab ${tab === value ? "active" : ""}`} onClick={() => setTab(value)}>
                        <Icon size={15} /> {label} <span className="count">{count}</span>
                    </button>
                ))}
            </div>

            {items.length === 0 ? (
                tab === "upcoming" ? (
                    <EmptyState
                        icon={CalendarCheck2}
                        title={pinnedId ? "Nothing else scheduled" : "Nothing on your schedule"}
                        description={pinnedId ? "Your next event is pinned at the top. Register for more from the recommendations below." : "Pick an event from the recommendations below and register in one click."}
                    />
                ) : (
                    <EmptyState icon={History} title="No past events yet" description="Events you attended appear here with their results." />
                )
            ) : (
                <div className="list-rows">
                    {items.map((registration) =>
                        tab === "upcoming" ? (
                            <EventRow key={registration._id} event={registration.event} right={<DayBadge event={registration.event} now={now} />} />
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
            toast.success(`You're registered for ${event.title}`);
            onRegistered(event, response.data);
        } catch (error) {
            toast.error(error);
            setPending(false);
        }
    };

    return (
        <article className="card rec-card">
            <Link to={`/events/${event._id}`} className="rec-media" aria-label={`Open ${event.title}`}>
                {event.poster ? (
                    <img src={event.poster} alt="" loading="lazy" />
                ) : (
                    <span className="rec-fallback">{humanize(event.category)}</span>
                )}
                <span className="rec-date">
                    {formatDate(event.startAt).replace(/ \d{4}$/, "")}
                </span>
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
                        <span className="subtle">
                            {event.maxParticipants - event.registeredCount} spots left
                        </span>
                    </div>
                )}
                <div className="row-between rec-actions">
                    <Button size="sm" onClick={register} loading={pending}>
                        <CalendarCheck2 size={15} /> Register
                    </Button>
                    <Link to={`/events/${event._id}`} className="small row" style={{ gap: 2 }}>
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

    return (
        <section className="stack">
            <div className="row-between">
                <div className="stack-sm" style={{ gap: 2 }}>
                    <h2 className="row">
                        <Sparkles size={18} /> Recommended for you
                    </h2>
                    <span className="subtle">Open for registration and eligible for you.</span>
                </div>
                <Link to="/feed" className="small nowrap">
                    Campus feed →
                </Link>
            </div>

            {events.length > 0 && (
                <div className="chip-filters" role="tablist" aria-label="Filter recommendations">
                    {FILTERS.filter((f) => !f.test || counts[f.value] > 0).map((f) => (
                        <button key={f.value} type="button" role="tab" aria-selected={active.value === f.value} className={`chip-filter ${active.value === f.value ? "active" : ""}`} onClick={() => setFilter(f.value)}>
                            {f.label} <span>{counts[f.value]}</span>
                        </button>
                    ))}
                </div>
            )}

            {shown.length ? (
                <div className="rec-grid">
                    {shown.map((event) => (
                        <RecommendCard key={event._id} event={event} now={now} onRegistered={onRegistered} />
                    ))}
                </div>
            ) : (
                <Card>
                    <EmptyState
                        icon={Compass}
                        title="You're all caught up"
                        description="There's nothing new you can register for right now. Browse the campus feed for live and past events."
                        action={
                            <ButtonLink to="/feed" size="sm" variant="secondary">
                                Open campus feed
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
            title={
                <h2 className="row">
                    <Bell size={16} /> Recent activity
                </h2>
            }
            actions={
                <Link to="/notifications" className="small">
                    View all
                </Link>
            }
            padded={false}
        >
            {items.length ? (
                <div className="list-rows">
                    {items.map((item) => (
                        <button key={item._id} type="button" className={`list-row activity-row ${item.readAt ? "" : "unread"}`} onClick={() => open(item)}>
                            <span className="activity-dot" />
                            <span className="grow" style={{ minWidth: 0 }}>
                                <span className="title activity-title">{item.title}</span>
                                <span className="subtle">{timeAgo(item.createdAt)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            ) : (
                <p className="subtle card-body">New events, results and announcements show up here.</p>
            )}
        </Card>
    );
};

const ClubWorkspace = ({ workspace }) => {
    const has = (permission) => workspace.permissions.includes(permission);
    const attention = [
        ...workspace.needsChanges.map((event) => ({ event, label: "Changes requested", tone: "violet" })),
        ...workspace.readyToPublish.map((event) => ({ event, label: "Ready to publish", tone: "info" })),
        ...workspace.awaitingCompletion.map((event) => ({ event, label: "Mark completed", tone: "warning" })),
        ...workspace.resultsPending.map((event) => ({ event, label: event.resultStatus === "DRAFT" ? "Publish results" : "Add results", tone: "gold", to: `/events/${event._id}/results/edit` }))
    ];

    return (
        <Card
            title={
                <div className="row">
                    <Avatar name={workspace.club.name} src={workspace.club.logo} size="sm" square />
                    <Link to={`/clubs/${workspace.club._id}`} style={{ color: "inherit", fontWeight: 650 }}>
                        {workspace.club.name}
                    </Link>
                    <RoleBadge role={workspace.role} />
                </div>
            }
            actions={
                has(PERMISSIONS.MANAGE_EVENTS) && (
                    <ButtonLink to={`/events/create?club=${workspace.club._id}`} size="sm">
                        <Plus size={14} /> New event
                    </ButtonLink>
                )
            }
            padded={false}
        >
            <div className="grid-3" style={{ padding: 16, gap: 12 }}>
                <StatLink to={`/clubs/${workspace.club._id}/members`} label="Members" value={workspace.memberCount} icon={Users} />
                <StatLink
                    to={`/clubs/${workspace.club._id}/members`}
                    label="Join requests"
                    value={workspace.pendingMembershipRequests ?? "—"}
                    icon={UserPlus}
                    hint={workspace.pendingMembershipRequests ? "Review requests →" : null}
                />
                <StatLink to="/events/manage" label="Awaiting approval" value={workspace.pendingApproval.length} icon={ClipboardCheck} />
            </div>
            {workspace.insights && <ClubInsights insights={workspace.insights} clubId={workspace.club._id} />}
            {attention.length > 0 && (
                <>
                    <div className="section-title" style={{ padding: "4px 20px 0" }}>
                        Needs your attention
                    </div>
                    <div className="list-rows">
                        {attention.map(({ event, label, tone, to }) => (
                            <EventRow key={`${event._id}-${label}`} event={{ ...event, club: null }} to={to} right={<Badge tone={tone}>{label}</Badge>} />
                        ))}
                    </div>
                </>
            )}
            {workspace.upcoming.length > 0 && (
                <>
                    <div className="section-title" style={{ padding: "12px 20px 0" }}>
                        Your club's upcoming events
                    </div>
                    <div className="list-rows">
                        {workspace.upcoming.map((event) => (
                            <EventRow
                                key={event._id}
                                event={{ ...event, club: null }}
                                right={
                                    <span className="subtle nowrap">
                                        {event.registeredCount}
                                        {event.maxParticipants ? ` / ${event.maxParticipants}` : ""} registered
                                    </span>
                                }
                            />
                        ))}
                    </div>
                </>
            )}
            {workspace.drafts.length > 0 && (
                <div className="card-footer subtle">
                    {plural(workspace.drafts.length, "draft")} not yet submitted · <Link to="/events/manage">Manage events</Link>
                </div>
            )}
        </Card>
    );
};

const MyClubs = ({ memberships }) => {
    const approved = memberships.filter((m) => m.status === "APPROVED");
    const pending = memberships.filter((m) => m.status === "PENDING");

    return (
        <Card
            title={
                <h2 className="row">
                    <Building2 size={16} /> My clubs
                </h2>
            }
            actions={
                <Link to="/clubs?view=mine" className="small">
                    View all
                </Link>
            }
            padded={false}
        >
            {approved.length || pending.length ? (
                <div className="list-rows">
                    {approved.map((m) => (
                        <Link key={m._id} to={`/clubs/${m.club._id}`} className="list-row">
                            <Avatar name={m.club.name} src={m.club.logo} size="sm" square />
                            <span className="grow title">{m.club.name}</span>
                            <RoleBadge role={m.role} />
                        </Link>
                    ))}
                    {pending.map((m) => (
                        <Link key={m._id} to={`/clubs/${m.club._id}`} className="list-row">
                            <Avatar name={m.club.name} src={m.club.logo} size="sm" square />
                            <span className="grow title">{m.club.name}</span>
                            <Badge tone="warning">Pending</Badge>
                        </Link>
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={Building2}
                    title="No clubs yet"
                    description="Clubs for your department are waiting for you."
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

const Proposals = ({ requests }) => (
    <Card
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
        {requests.length ? (
            <div className="list-rows">
                {requests.map((request) => (
                    <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                        <span className="grow title">{request.name}</span>
                        <StatusBadge status={request.status} />
                    </Link>
                ))}
            </div>
        ) : (
            <p className="subtle card-body">Have an idea for a new club? Propose it with your friends.</p>
        )}
    </Card>
);

export const StudentDashboard = ({ user, data }) => {
    const { student } = data;
    const now = useNow();
    const [schedule, setSchedule] = useState(student.upcomingRegistrations);
    const [recommended, setRecommended] = useState(student.recommended);
    const [upcomingCount, setUpcomingCount] = useState(student.stats.upcoming);

    // Registering from a recommendation moves the event into the schedule, so it is never shown twice.
    const handleRegistered = (event, result) => {
        setRecommended((list) => list.filter((e) => e._id !== event._id));
        setSchedule((list) =>
            [...list, { _id: `new-${event._id}`, event: { ...event, registeredCount: result?.registeredCount ?? event.registeredCount + 1 } }].sort(
                (a, b) => new Date(a.event.startAt) - new Date(b.event.startAt)
            )
        );
        setUpcomingCount((count) => count + 1);
    };

    const next = useMemo(() => schedule.find((r) => new Date(r.event.endAt).getTime() > now), [schedule, now]);
    const firstName = user.name.split(" ")[0];

    return (
        <div className="stack-lg">
            <Hero
                title={`${greeting()}, ${firstName}`}
                subtitle={
                    upcomingCount
                        ? `You're going to ${plural(upcomingCount, "event")}${recommended.length ? ` · ${plural(recommended.length, "new event")} you can still join` : ""}.`
                        : recommended.length
                          ? `${plural(recommended.length, "event")} ${recommended.length === 1 ? "is" : "are"} open for you to join.`
                          : "Discover what's happening on campus and join the clubs you care about."
                }
                actions={
                    <>
                        <ButtonLink to="/feed" variant="accent">
                            <Compass size={16} /> Explore events
                        </ButtonLink>
                        <ButtonLink to="/clubs" variant="secondary">
                            <Building2 size={16} /> Browse clubs
                        </ButtonLink>
                    </>
                }
                aside={<NextUp registration={next} now={now} />}
            />

            <div className="dash-stats">
                <StatLink to="/my-registrations" label="Going to" value={upcomingCount} icon={CalendarCheck2} hint="upcoming events" />
                <StatLink to="/my-registrations?timeframe=past" label="Attended" value={student.stats.attended} icon={Trophy} hint="completed events" />
                <StatLink
                    to="/clubs?view=mine"
                    label="My clubs"
                    value={student.stats.clubs}
                    icon={Building2}
                    hint={student.stats.pendingClubs ? `${student.stats.pendingClubs} request pending` : "clubs joined"}
                />
                <StatLink to="/notifications" label="Unread" value={data.unreadNotifications} icon={Bell} hint="notifications" />
            </div>

            {student.clubWorkspaces.map((workspace) => (
                <ClubWorkspace key={workspace.club._id} workspace={workspace} />
            ))}

            <div className="detail-layout">
                <div className="stack-lg">
                    <Schedule upcoming={schedule} past={student.pastRegistrations} now={now} pinnedId={next?.event._id} />
                    <Recommended events={recommended} now={now} onRegistered={handleRegistered} />
                </div>

                <aside className="stack">
                    <Activity items={student.recentNotifications} />
                    <MyClubs memberships={student.memberships} />
                    <Proposals requests={student.clubRequests} />
                </aside>
            </div>
        </div>
    );
};
