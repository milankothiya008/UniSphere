import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
    ArrowRight,
    Award,
    Building2,
    CalendarCheck2,
    CalendarDays,
    ChevronRight,
    Clock,
    FileSignature,
    FileText,
    Gauge,
    History,
    Hourglass,
    Lightbulb,
    MapPin,
    Plus,
    Trophy
} from "lucide-react";
import { EventRow } from "../events/EventCard";
import { Avatar, Badge, ButtonLink, Card, RoleBadge, StatusBadge, Tabs } from "../ui";
import { ClubHQ } from "../dashboard/ClubHQ";
import { Achievements } from "./Achievements";
import { ApplicationRow } from "../recruitment/ApplicationRow";
import { countdownParts, daysUntil, formatDateLong, formatTimeRange } from "../../lib/format";

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
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={tab === value}
                        className={`pill-tab ${tab === value ? "active" : ""}`}
                        onClick={() => setTab(value)}
                    >
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

const TABS = [
    { value: "schedule", label: "Schedule", icon: CalendarCheck2 },
    { value: "applications", label: "Applications", icon: FileSignature },
    { value: "clubs", label: "Clubs", icon: Building2 },
    { value: "achievements", label: "Achievements", icon: Award }
];

/** The student's side of the profile: what's next, their schedule, applications, clubs and (for officers) Club HQ. */
export const StudentProfile = ({ data }) => {
    const { student } = data;
    const now = useNow();
    const [params, setParams] = useSearchParams();
    const schedule = student.upcomingRegistrations;
    const waitlisted = student.waitlistedRegistrations || [];
    const next = useMemo(() => schedule.find((r) => new Date(r.event.endAt).getTime() > now), [schedule, now]);
    const workspaces = student.clubWorkspaces;
    const workspaceClubIds = useMemo(() => new Set(workspaces.map((w) => w.club._id)), [workspaces]);
    const tabs = [...(workspaces.length ? [{ value: "hq", label: "Club HQ", icon: Gauge }] : []), ...TABS];
    const tab = tabs.some((item) => item.value === params.get("tab")) ? params.get("tab") : tabs[0].value;

    return (
        <div className="stack-lg">
            <NextUp registration={next} now={now} />
            <Tabs
                tabs={tabs}
                value={tab}
                onChange={(value) => {
                    params.set("tab", value);
                    setParams(params, { replace: true });
                }}
            />
            {tab === "hq" && <ClubHQ workspaces={workspaces} />}
            {tab === "schedule" && (
                <Schedule upcoming={schedule} waitlisted={waitlisted} past={student.pastRegistrations} now={now} pinnedId={next?.event._id} />
            )}
            {tab === "applications" &&
                (student.applications?.length ? (
                    <MyApplications applications={student.applications} />
                ) : (
                    <Card>
                        <CompactEmpty icon={FileSignature} title="No applications yet" text="Apply when a club is recruiting." />
                    </Card>
                ))}
            {tab === "achievements" && <Achievements />}
            {tab === "clubs" && (
                <div className="stack">
                    <MyClubs memberships={student.memberships} hiddenClubIds={workspaceClubIds} />
                    <Proposals requests={student.clubRequests} />
                </div>
            )}
        </div>
    );
};
