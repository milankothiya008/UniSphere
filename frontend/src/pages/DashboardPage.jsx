import { Link, Navigate } from "react-router-dom";
import {
    Building2,
    CalendarDays,
    ClipboardCheck,
    Crown,
    FileText,
    MapPin,
    ShieldCheck,
    UserPlus
} from "lucide-react";
import { dashboardApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { EventRow } from "../components/events/EventCard";
import { AsyncContent, Avatar, Badge, ButtonLink, Card, EmptyState, PageHeader, Skeleton, StatStrip, StatTile, StatusBadge } from "../components/ui";
import { departmentsLabel, plural, timeAgo } from "../lib/format";

const Section = ({ title, action, children, padded = false }) => (
    <Card title={title} actions={action} padded={padded}>
        {children}
    </Card>
);

const FacultyDashboard = ({ data }) => {
    const { faculty } = data;

    return (
        <div className="stack-lg dashboard stagger">
            <PageHeader
                title="Reviews"
                actions={
                    <StatStrip
                        items={[
                            { label: "events", value: faculty.eventsToReview.length, to: "/faculty" },
                            { label: "requests", value: faculty.requestsToReview.length, to: "/faculty" },
                            { label: "clubs", value: faculty.mentoredClubs.length, to: "/faculty/clubs" }
                        ]}
                    />
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
                                <EventRow
                                    key={event._id}
                                    event={event}
                                    right={
                                        event.revision?.status === "PENDING_APPROVAL" ? (
                                            <span className="badge badge-violet">Edit to review</span>
                                        ) : (
                                            <span className="subtle nowrap">{timeAgo(event.submittedAt)}</span>
                                        )
                                    }
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={ClipboardCheck} title="No events waiting" />
                    )}
                </Section>

                {faculty.drivesToReview?.length > 0 && (
                    <Section title="Recruitment awaiting your approval" action={<Link to="/faculty" className="small">All</Link>}>
                        <div className="list-rows">
                            {faculty.drivesToReview.map((drive) => (
                                <Link key={drive._id} to={`/recruitment/${drive._id}`} className="list-row">
                                    <Avatar name={drive.club?.name} src={drive.club?.logo} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{drive.title}</div>
                                        <div className="subtle">
                                            {drive.club?.name} · {drive.positions.join(", ")} · {drive.questions} questions · {timeAgo(drive.submittedAt)}
                                        </div>
                                    </div>
                                    <Badge tone="violet">Recruitment</Badge>
                                </Link>
                            ))}
                        </div>
                    </Section>
                )}

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

        </div>
    );
};

const AdminDashboard = ({ data }) => {
    const { stats, awaitingApproval, recentClubs } = data.admin;

    return (
        <div className="stack-lg dashboard stagger">
            <PageHeader
                title="Admin"
                actions={
                    <StatStrip
                        items={[
                            { label: "users", value: stats.users.total, to: "/admin/users" },
                            { label: "clubs", value: stats.clubs.byStatus.ACTIVE || 0, to: "/admin/clubs" },
                            { label: "upcoming", value: stats.events.upcoming, to: "/explore" }
                        ]}
                    />
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

// Faculty reviews and the admin desk. Students have no dashboard: their plans live on the profile.
const DashboardPage = () => {
    const { isStudent } = useAuth();
    const { data, loading, error, reload } = useApi(() => dashboardApi.get(), [], { enabled: !isStudent });

    if (isStudent) {
        return <Navigate to="/profile" replace />;
    }
    return (
        <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<DashboardSkeleton />}>
            {data?.faculty && <FacultyDashboard data={data} />}
            {data?.admin && <AdminDashboard data={data} />}
        </AsyncContent>
    );
};

export default DashboardPage;

