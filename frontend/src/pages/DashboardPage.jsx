import { Link } from "react-router-dom";
import {
    Building2,
    CalendarDays,
    ClipboardCheck,
    Crown,
    FileText,
    GraduationCap,
    MapPin,
    Newspaper,
    ShieldCheck,
    UserPlus,
    Users
} from "lucide-react";
import { dashboardApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { EventCard, EventRow } from "../components/events/EventCard";
import { AsyncContent, Avatar, ButtonLink, Card, EmptyState, Skeleton, StatTile, StatusBadge } from "../components/ui";
import { departmentsLabel, plural, timeAgo } from "../lib/format";
import { Hero, greeting, todayLabel } from "../components/dashboard/DashboardHero";
import { StudentDashboard } from "../components/dashboard/StudentDashboard";

const Section = ({ title, action, children, padded = false }) => (
    <Card title={title} actions={action} padded={padded}>
        {children}
    </Card>
);

const CampusEvents = ({ events = [] }) => (
    <div className="stack">
        <div className="row-between">
            <h2 className="row">
                <Newspaper size={18} /> Coming up on campus
            </h2>
            <Link to="/feed" className="small">
                Open campus feed →
            </Link>
        </div>
        {events.length ? (
            <div className="grid-3">
                {events.slice(0, 3).map((event) => (
                    <EventCard key={event._id} event={event} />
                ))}
            </div>
        ) : (
            <Card>
                <EmptyState icon={Newspaper} title="No upcoming events yet" description="Published club events will appear here and in the campus feed." />
            </Card>
        )}
    </div>
);

const FacultyDashboard = ({ user, data }) => {
    const { faculty } = data;

    return (
        <div className="stack-lg dashboard stagger">
            <Hero
                eyebrow={todayLabel()}
                title={`${greeting()}, ${user.name}`}
                subtitle={
                    faculty.eventsToReview.length || faculty.requestsToReview.length
                        ? `${plural(faculty.eventsToReview.length, "event")} and ${plural(faculty.requestsToReview.length, "club request")} are waiting for your review.`
                        : "You're all caught up on reviews."
                }
                stats={[
                    { label: "events to review", value: faculty.eventsToReview.length, to: "/faculty", icon: ClipboardCheck },
                    { label: "club requests", value: faculty.requestsToReview.length, to: "/faculty", icon: FileText },
                    { label: faculty.mentoredClubs.length === 1 ? "mentored club" : "mentored clubs", value: faculty.mentoredClubs.length, to: "/faculty/clubs", icon: GraduationCap }
                ]}
                actions={
                    <ButtonLink to="/faculty" variant="accent">
                        <ClipboardCheck size={16} /> Open reviews
                    </ButtonLink>
                }
            />

            {faculty.clubsAwaitingPresident.map((club) => (
                <Card key={club._id}>
                    <div className="row-between">
                        <span className="row">
                            <Crown size={18} color="var(--gold-600)" /> <strong>{club.name}</strong> was approved and needs a president.
                        </span>
                        <ButtonLink to={`/clubs/${club._id}/settings`} size="sm">
                            Appoint president
                        </ButtonLink>
                    </div>
                </Card>
            ))}

            <div className="grid-2" style={{ alignItems: "start" }}>
                <Section title="Events awaiting your approval" action={<Link to="/events/manage?group=review" className="small">All</Link>}>
                    {faculty.eventsToReview.length ? (
                        <div className="list-rows">
                            {faculty.eventsToReview.map((event) => (
                                <EventRow key={event._id} event={event} right={<span className="subtle nowrap">{timeAgo(event.submittedAt)}</span>} />
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={ClipboardCheck} title="No events waiting" />
                    )}
                </Section>

                <Section title="Club requests" action={<Link to="/club-requests" className="small">All</Link>}>
                    {faculty.requestsToReview.length ? (
                        <div className="list-rows">
                            {faculty.requestsToReview.map((request) => (
                                <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                                    <Avatar name={request.name} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{request.name}</div>
                                        <div className="subtle">
                                            {request.requester?.name} · {departmentsLabel(request)} · {timeAgo(request.createdAt)}
                                        </div>
                                    </div>
                                    <StatusBadge status={request.status} />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={FileText} title="No requests waiting" />
                    )}
                </Section>
            </div>

            <div className="detail-layout">
                <Section title="Upcoming events in your clubs">
                    {faculty.upcomingEvents.length ? (
                        <div className="list-rows">
                            {faculty.upcomingEvents.map((event) => (
                                <EventRow key={event._id} event={event} right={<span className="subtle nowrap">{event.registeredCount} registered</span>} />
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={CalendarDays} title="No upcoming events" />
                    )}
                </Section>
                <Section title="Mentored clubs" action={<Link to="/faculty/clubs" className="small">Details</Link>}>
                    {faculty.mentoredClubs.length ? (
                        <div className="list-rows">
                            {faculty.mentoredClubs.map((club) => (
                                <Link key={club._id} to={`/clubs/${club._id}`} className="list-row">
                                    <Avatar name={club.name} src={club.logo} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{club.name}</div>
                                        <div className="subtle">{plural(club.memberCount, "member")}</div>
                                    </div>
                                    <StatusBadge status={club.status} />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <p className="subtle card-body">Verify a club request to become its mentor once approved.</p>
                    )}
                </Section>
            </div>

            <CampusEvents events={data.campusEvents} />
        </div>
    );
};

const AdminDashboard = ({ data }) => {
    const { stats, awaitingApproval, recentClubs } = data.admin;

    return (
        <div className="stack-lg dashboard stagger">
            <Hero
                eyebrow={todayLabel()}
                title="University administration"
                subtitle={awaitingApproval.length ? `${plural(awaitingApproval.length, "club request")} awaiting your approval.` : "No club approvals pending."}
                stats={[
                    { label: "users", value: stats.users.total, to: "/admin/users", icon: Users },
                    { label: "active clubs", value: stats.clubs.byStatus.ACTIVE || 0, to: "/admin/clubs", icon: Building2 },
                    { label: "upcoming events", value: stats.events.upcoming, to: "/feed", icon: CalendarDays }
                ]}
                actions={
                    <ButtonLink to="/admin/club-requests" variant="accent">
                        <ShieldCheck size={16} /> Club approvals
                    </ButtonLink>
                }
            />
            <div className="grid-2" style={{ alignItems: "start" }}>
                <Section title="Awaiting final approval" action={<Link to="/admin/club-requests" className="small">All</Link>}>
                    {awaitingApproval.length ? (
                        <div className="list-rows">
                            {awaitingApproval.map((request) => (
                                <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                                    <Avatar name={request.name} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{request.name}</div>
                                        <div className="subtle">Verified by {request.verifiedBy?.name}</div>
                                    </div>
                                    <StatusBadge status={request.status} />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={ShieldCheck} title="Nothing to approve" />
                    )}
                </Section>
                <Section title="Recently created clubs" action={<Link to="/admin/clubs" className="small">All clubs</Link>}>
                    {recentClubs.length ? (
                        <div className="list-rows">
                            {recentClubs.map((club) => (
                                <Link key={club._id} to={`/clubs/${club._id}`} className="list-row">
                                    <Avatar name={club.name} src={club.logo} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{club.name}</div>
                                        <div className="subtle">
                                            Mentor: {club.mentor?.name || "—"} · President: {club.president?.name || "—"}
                                        </div>
                                    </div>
                                    <StatusBadge status={club.status} />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={Building2} title="No clubs yet" />
                    )}
                </Section>
            </div>
            <div className="grid-3">
                <StatTile label="Faculty review queue" value={stats.clubRequests.pendingFacultyReview} icon={FileText} tone="violet" />
                <StatTile label="Club memberships" value={stats.memberships} icon={UserPlus} tone="success" hint={`${stats.registrations} active registrations`} />
                <StatTile label="Venues" value={stats.venues} icon={MapPin} tone="gold" />
            </div>
            <CampusEvents events={data.campusEvents} />
        </div>
    );
};

const DashboardSkeleton = () => (
    <div className="stack-lg">
        <Skeleton height={140} style={{ borderRadius: 20 }} />
        <div className="grid-3">
            {[1, 2, 3].map((key) => (
                <Skeleton key={key} height={96} style={{ borderRadius: 14 }} />
            ))}
        </div>
        <Skeleton height={260} style={{ borderRadius: 14 }} />
    </div>
);

const DashboardPage = () => {
    const { user } = useAuth();
    const { data, loading, error, reload } = useApi(() => dashboardApi.get(), []);

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<DashboardSkeleton />}>
            {data?.student && <StudentDashboard user={user} data={data} />}
            {data?.faculty && <FacultyDashboard user={user} data={data} />}
            {data?.admin && <AdminDashboard data={data} />}
        </AsyncContent>
    );
};

export default DashboardPage;

