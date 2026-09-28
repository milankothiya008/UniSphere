import { useState } from "react";
import { Link } from "react-router-dom";
import {
    ArrowUpRight,
    CalendarClock,
    CalendarDays,
    CheckCircle2,
    ClipboardCheck,
    FilePen,
    Flag,
    Gauge,
    Hourglass,
    Images,
    Megaphone,
    PencilLine,
    Plus,
    Settings2,
    Ticket,
    Trophy,
    UserPlus,
    Users
} from "lucide-react";
import { Avatar, ButtonLink, RoleBadge, StatTile } from "../ui";
import { EventRegistrations, compact } from "./ClubInsights";
import { dateParts, formatTimeRange, humanize, plural } from "../../lib/format";
import { PERMISSIONS } from "../../lib/constants";

const StatLink = ({ to, ...props }) =>
    to ? (
        <Link to={to} className="stat-link">
            <StatTile {...props} />
        </Link>
    ) : (
        <StatTile {...props} />
    );

// One set of numbers per role: the president sees the club's performance, other officers their workload.
const HqTiles = ({ workspace }) => {
    const clubId = workspace.club._id;
    const insights = workspace.insights;

    if (insights) {
        return (
            <div className="hq-tiles">
                <StatLink to={`/clubs/${clubId}/members`} label="Members" value={compact(insights.totalMembers)} icon={Users} />
                <StatTile
                    label="Events hosted"
                    value={compact(insights.totalEvents)}
                    icon={CalendarDays}
                    tone="violet"
                    hint={`${insights.upcomingEvents} upcoming · ${insights.completedEvents} completed`}
                />
                <StatTile
                    label="Registrations"
                    value={compact(insights.totalRegistrations)}
                    icon={Ticket}
                    tone="success"
                    hint={
                        insights.totalAttended
                            ? `${insights.totalAttended} checked in${insights.attendanceRate !== null ? ` · ${insights.attendanceRate}% turnout` : ""}`
                            : insights.waitlisted
                              ? `+${insights.waitlisted} on waitlists`
                              : "across all events"
                    }
                />
                <StatTile
                    label="Avg. participation"
                    value={insights.averageParticipation}
                    icon={Gauge}
                    tone="gold"
                    hint={insights.seatFillRate !== null ? `per event · ${insights.seatFillRate}% of seats filled` : "registrations per event"}
                />
            </div>
        );
    }

    return (
        <div className="hq-tiles">
            <StatLink to={`/clubs/${clubId}/members`} label="Members" value={workspace.memberCount} icon={Users} />
            <StatLink to="/events/manage" label="With mentor" value={workspace.pendingApproval.length} icon={ClipboardCheck} tone="violet" hint="awaiting approval" />
            <StatTile label="Upcoming events" value={workspace.upcoming.length} icon={CalendarClock} tone="success" />
        </div>
    );
};

// Everything that needs someone in the club to act, most urgent first.
const actionItems = (workspace) => {
    const items = [];
    const drive = workspace.recruitment;

    // Recruitment: the one next step for the drive in progress.
    if (drive) {
        const to = `/recruitment/${drive._id}`;
        const step = {
            DRAFT: ["Recruitment draft — send it for approval", PencilLine, "neutral", to],
            NEEDS_CHANGES: ["Mentor asked for changes to your recruitment", PencilLine, "violet", to],
            PENDING_APPROVAL: ["Recruitment with your faculty mentor", Hourglass, "neutral", to],
            APPROVED: ["Recruitment approved — publish it", Megaphone, "success", to],
            UPCOMING: [`Recruitment opens soon`, Megaphone, "info", to],
            OPEN: [`${plural(drive.applications, "application")} so far — applications open`, UserPlus, "gold", `${to}?tab=applications`],
            CLOSED: [`Applications closed — ${drive.applications ? "start round 1" : "no applicants yet"}`, Flag, "warning", `${to}?tab=rounds`]
        }[drive.phase];
        if (step) {
            items.push({ key: `rc-${drive._id}`, icon: step[1], tone: step[2], title: drive.title, detail: step[0], to: step[3] });
        } else if (drive.phase === "ROUNDS" && drive.round) {
            const detail =
                drive.round.status === "RESULTS_PUBLISHED"
                    ? `${drive.round.name} done — add the next round or finalise`
                    : drive.round.status === "DRAFT" && drive.round.mode !== "SCREENING"
                      ? `Schedule ${drive.round.name}`
                      : drive.round.undecided
                        ? `${drive.round.name}: ${plural(drive.round.undecided, "candidate")} to decide`
                        : `${drive.round.name}: publish the results`;
            items.push({ key: `rc-${drive._id}`, icon: UserPlus, tone: "gold", title: drive.title, detail, to: `/recruitment/${drive._id}?tab=rounds` });
        }
    }
    workspace.needsChanges.forEach((event) =>
        items.push({ key: `nc-${event._id}`, icon: PencilLine, tone: "violet", title: event.title, detail: "Mentor requested changes", to: `/events/${event._id}` })
    );
    // Edits to published events: the mentor's answer needs the club's next step.
    (workspace.changesInReview || []).forEach((event) => {
        const status = event.revision?.status;
        if (status === "APPROVED") {
            items.push({ key: `cp-${event._id}`, icon: Megaphone, tone: "success", title: event.title, detail: "Changes approved — publish them", to: `/events/${event._id}` });
        } else if (status === "NEEDS_CHANGES" || status === "REJECTED") {
            items.push({ key: `cn-${event._id}`, icon: PencilLine, tone: "violet", title: event.title, detail: status === "REJECTED" ? "Mentor rejected your changes" : "Mentor asked for changes to your edit", to: `/events/${event._id}` });
        } else if (status === "PENDING_APPROVAL") {
            items.push({ key: `cw-${event._id}`, icon: Hourglass, tone: "neutral", title: event.title, detail: "Edit waiting for mentor approval", to: `/events/${event._id}` });
        }
    });
    (workspace.galleryReview || []).forEach((event) =>
        items.push({
            key: `gr-${event._id}`,
            icon: Images,
            tone: "info",
            title: `${plural(event.pending, "gallery upload")} to review`,
            detail: event.title,
            to: `/gallery/${event._id}?review=1`
        })
    );
    workspace.readyToPublish.forEach((event) =>
        items.push({ key: `rp-${event._id}`, icon: Megaphone, tone: "info", title: event.title, detail: "Approved — ready to publish", to: `/events/${event._id}` })
    );
    workspace.awaitingCompletion.forEach((event) =>
        items.push({ key: `ac-${event._id}`, icon: Flag, tone: "warning", title: event.title, detail: "Event ended — mark it completed", to: `/events/${event._id}` })
    );
    workspace.resultsPending.forEach((event) =>
        items.push({
            key: `rs-${event._id}`,
            icon: Trophy,
            tone: "gold",
            title: event.title,
            detail: event.resultStatus === "DRAFT" ? "Results drafted — publish them" : "Add results",
            to: `/events/${event._id}/results/edit`
        })
    );
    workspace.pendingApproval.forEach((event) =>
        items.push({ key: `pa-${event._id}`, icon: Hourglass, tone: "neutral", title: event.title, detail: "With your faculty mentor for review", to: `/events/${event._id}` })
    );
    if (workspace.drafts.length) {
        items.push({ key: "drafts", icon: FilePen, tone: "neutral", title: `${plural(workspace.drafts.length, "draft")} not submitted`, detail: "Finish and send for approval", to: "/events/manage" });
    }
    return items;
};

const ActionCenter = ({ workspace }) => {
    const items = actionItems(workspace);

    return (
        <div className="hq-panel">
            <div className="hq-panel-head">
                <h3>Action center</h3>
                {items.length > 0 && <span className="count-pill">{items.length}</span>}
            </div>
            {items.length ? (
                <ul className="action-list">
                    {items.map(({ key, icon: Icon, tone, title, detail, to }) => (
                        <li key={key}>
                            <Link to={to} className="action-item">
                                <span className={`action-icon tone-${tone}`}>
                                    <Icon size={15} />
                                </span>
                                <span className="action-text">
                                    <strong>{title}</strong>
                                    <small>{detail}</small>
                                </span>
                                <ArrowUpRight size={15} className="action-go" />
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="all-clear">
                    <CheckCircle2 size={22} />
                    <div>
                        <strong>All caught up</strong>
                        <small>Nothing needs your attention right now.</small>
                    </div>
                </div>
            )}
        </div>
    );
};

const ClubUpcoming = ({ events }) => (
    <div className="hq-panel">
        <div className="hq-panel-head">
            <h3>Upcoming events</h3>
            <Link to="/events/manage" className="small">
                Manage
            </Link>
        </div>
        {events.length ? (
            <ul className="club-upcoming">
                {events.map((event) => {
                    const { month, day } = dateParts(event.startAt);
                    const fill = event.maxParticipants ? Math.min(100, Math.round((event.registeredCount / event.maxParticipants) * 100)) : null;
                    return (
                        <li key={event._id}>
                            <Link to={`/events/${event._id}`} className="club-upcoming-row">
                                <span className="hq-date">
                                    <small>{month}</small>
                                    <b>{day}</b>
                                </span>
                                <span className="club-upcoming-main">
                                    <strong>{event.title}</strong>
                                    <small>
                                        {formatTimeRange(event.startAt, event.endAt)}
                                        {event.venue?.name ? ` · ${event.venue.name}` : ""}
                                    </small>
                                    {fill !== null && (
                                        <span className="mini-meter" aria-hidden="true">
                                            <span style={{ width: `${fill}%` }} className={fill >= 90 ? "full" : ""} />
                                        </span>
                                    )}
                                </span>
                                <span className="club-upcoming-count">
                                    <b>{event.registeredCount}</b>
                                    {event.maxParticipants ? <small>/ {event.maxParticipants}</small> : <small>going</small>}
                                    {event.waitlistCount > 0 && <em>+{event.waitlistCount} waiting</em>}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        ) : (
            <p className="subtle hq-empty">No upcoming events. Plan the next one — members are notified when it's published.</p>
        )}
    </div>
);

const WorkspaceBody = ({ workspace }) => {
    const insights = workspace.insights;
    return (
        <div className="hq-body">
            <HqTiles workspace={workspace} />
            <div className="hq-grid">
                <ActionCenter workspace={workspace} />
                <ClubUpcoming events={workspace.upcoming} />
            </div>
            {insights && <EventRegistrations insights={insights} />}
        </div>
    );
};

// The club officer's command centre. One panel, with a tab per club when they help run several.
export const ClubHQ = ({ workspaces }) => {
    const [activeId, setActiveId] = useState(workspaces[0]?.club._id);
    const workspace = workspaces.find((item) => item.club._id === activeId) || workspaces[0];

    if (!workspace) {
        return null;
    }

    const club = workspace.club;
    const can = (permission) => workspace.permissions.includes(permission);

    return (
        <section className="card club-hq" aria-label="Club HQ">
            <header className="hq-head">
                <div className="hq-identity">
                    <Avatar name={club.name} src={club.logo} size="lg" square />
                    <div className="stack-sm" style={{ gap: 4 }}>
                        <span className="hq-eyebrow">Club HQ</span>
                        <h2>
                            <Link to={`/clubs/${club._id}`}>{club.name}</Link>
                        </h2>
                        <div className="row" style={{ gap: 8 }}>
                            <RoleBadge role={workspace.role} />
                            <span className="subtle">
                                {humanize(club.category)} · {plural(workspace.memberCount, "member")}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="hq-actions">
                    {can(PERMISSIONS.MANAGE_EVENTS) && (
                        <ButtonLink to={`/events/create?club=${club._id}`} size="sm">
                            <Plus size={15} /> New event
                        </ButtonLink>
                    )}
                    <ButtonLink to={`/clubs/${club._id}${can(PERMISSIONS.MANAGE_CLUB) ? "/settings" : ""}`} size="sm" variant="secondary">
                        <Settings2 size={15} /> {can(PERMISSIONS.MANAGE_CLUB) ? "Manage club" : "Club page"}
                    </ButtonLink>
                </div>
            </header>

            {workspaces.length > 1 && (
                <div className="hq-tabs" role="tablist" aria-label="Your clubs">
                    {workspaces.map((item) => (
                        <button
                            key={item.club._id}
                            type="button"
                            role="tab"
                            aria-selected={item.club._id === workspace.club._id}
                            className={`hq-tab ${item.club._id === workspace.club._id ? "active" : ""}`}
                            onClick={() => setActiveId(item.club._id)}
                        >
                            <Avatar name={item.club.name} src={item.club.logo} size="sm" square />
                            {item.club.name}
                        </button>
                    ))}
                </div>
            )}

            <WorkspaceBody key={workspace.club._id} workspace={workspace} />
        </section>
    );
};
