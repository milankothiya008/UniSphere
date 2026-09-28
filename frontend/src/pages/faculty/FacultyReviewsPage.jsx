import { Link } from "react-router-dom";
import { ClipboardCheck, FileText, Megaphone } from "lucide-react";
import { clubRequestApi, eventApi, recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { EventRow } from "../../components/events/EventCard";
import { AsyncContent, Avatar, Badge, Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { departmentsLabel, humanize, timeAgo } from "../../lib/format";

const FacultyReviewsPage = () => {
    const events = useApi(() => eventApi.manage({ status: "PENDING_APPROVAL", limit: 50 }), []);
    const requests = useApi(() => clubRequestApi.list({ status: "PENDING_FACULTY_REVIEW", limit: 50 }), []);
    const drives = useApi(() => recruitmentApi.toReview(), []);

    return (
        <>
            <PageHeader
                eyebrow={<><ClipboardCheck size={14} /> Faculty</>}
                title="Reviews"
                description="New events, edits and recruitment drives from the clubs you mentor, plus club proposals waiting for a faculty decision."
            />
            <div className="grid-2" style={{ alignItems: "start" }}>
                <Card title={`Events awaiting approval${events.data ? ` (${events.data.length})` : ""}`} padded={false}>
                    <AsyncContent
                        loading={events.loading}
                        error={events.error}
                        onRetry={events.reload}
                        isEmpty={!events.data?.length}
                        empty={<EmptyState icon={ClipboardCheck} title="No events to review" description="Submitted events from clubs you mentor appear here." />}
                    >
                        <div className="list-rows">
                            {events.data?.map((event) => (
                                <EventRow
                                    key={event._id}
                                    event={event}
                                    right={
                                        event.revisionStatus === "PENDING_APPROVAL" ? (
                                            <Badge tone="violet">Edit to review</Badge>
                                        ) : (
                                            <span className="subtle nowrap">{timeAgo(event.submittedAt || event.updatedAt)}</span>
                                        )
                                    }
                                />
                            ))}
                        </div>
                    </AsyncContent>
                </Card>

                <Card title={`Recruitment drives${drives.data ? ` (${drives.data.length})` : ""}`} padded={false}>
                    <AsyncContent
                        loading={drives.loading}
                        error={drives.error}
                        onRetry={drives.reload}
                        isEmpty={!drives.data?.length}
                        empty={<EmptyState icon={Megaphone} title="No recruitment to review" description="When a president sends a recruitment drive for approval, it appears here." />}
                    >
                        <div className="list-rows">
                            {drives.data?.map((drive) => (
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
                    </AsyncContent>
                </Card>

                <Card title={`Club requests${requests.data ? ` (${requests.data.length})` : ""}`} padded={false}>
                    <AsyncContent
                        loading={requests.loading}
                        error={requests.error}
                        onRetry={requests.reload}
                        isEmpty={!requests.data?.length}
                        empty={<EmptyState icon={FileText} title="No club requests" description="New club proposals that name you, or that anyone can review, appear here." />}
                    >
                        <div className="list-rows">
                            {requests.data?.map((request) => (
                                <Link key={request._id} to={`/club-requests/${request._id}`} className="list-row">
                                    <Avatar name={request.name} size="sm" square />
                                    <div className="grow">
                                        <div className="title">{request.name}</div>
                                        <div className="subtle">
                                            {humanize(request.category)} · {departmentsLabel(request)} · {request.requester?.name} · {timeAgo(request.updatedAt)}
                                        </div>
                                    </div>
                                    <StatusBadge status={request.status} />
                                </Link>
                            ))}
                        </div>
                    </AsyncContent>
                </Card>
            </div>
        </>
    );
};

export default FacultyReviewsPage;
