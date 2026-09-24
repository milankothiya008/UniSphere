import { Plus, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { AsyncContent, ButtonLink, Card, EmptyState, PageHeader, Pagination, StatusBadge, Tabs } from "../../components/ui";
import { formatDate, formatTimeRange } from "../../lib/format";

const GROUPS = [
    { value: "attention", label: "Drafts & changes", statuses: "DRAFT,NEEDS_CHANGES" },
    { value: "review", label: "Awaiting approval", statuses: "PENDING_APPROVAL" },
    { value: "approved", label: "Ready to publish", statuses: "APPROVED" },
    { value: "live", label: "Published", statuses: "PUBLISHED" },
    { value: "past", label: "Completed & closed", statuses: "COMPLETED,CANCELLED,REJECTED" },
    { value: "all", label: "All", statuses: "" }
];

const ManageEventsPage = () => {
    const { isFaculty } = useAuth();
    const { eventClubs, officerClubs, mentoredClubs } = useWorkspace();
    const [filters, setFilters] = useQueryState({ group: isFaculty ? "review" : "attention", club: "", page: "1" });
    const group = GROUPS.find((g) => g.value === filters.group) || GROUPS[0];

    const clubOptions = isFaculty
        ? mentoredClubs.map((club) => ({ value: club._id, label: club.name }))
        : officerClubs.map((membership) => ({ value: membership.club._id, label: membership.club.name }));

    const { data, meta, loading, error, reload } = useApi(
        () => eventApi.manage({ status: group.statuses, club: filters.club, page: filters.page, limit: 20 }),
        [group.statuses, filters.club, filters.page]
    );

    return (
        <>
            <PageHeader
                eyebrow={<><Wrench size={14} /> Event management</>}
                title={isFaculty ? "Events in your mentored clubs" : "Your club events"}
                description={
                    isFaculty
                        ? "Review submissions, request changes and keep track of what your clubs are running."
                        : "Drafts, approvals, publishing and results for the clubs you help run."
                }
                actions={
                    eventClubs.length > 0 && (
                        <ButtonLink to="/events/create">
                            <Plus size={16} /> Create event
                        </ButtonLink>
                    )
                }
            />

            <div className="stack">
                <div className="row-between">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Tabs tabs={GROUPS} value={group.value} onChange={(value) => setFilters({ group: value })} />
                    </div>
                    {clubOptions.length > 1 && (
                        <select className="select" style={{ width: "auto" }} value={filters.club} onChange={(event) => setFilters({ club: event.target.value })} aria-label="Club">
                            <option value="">All my clubs</option>
                            {clubOptions.map((club) => (
                                <option key={club.value} value={club.value}>
                                    {club.label}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <Card padded={false}>
                    <AsyncContent
                        loading={loading}
                        error={error}
                        onRetry={reload}
                        isEmpty={!data?.length}
                        empty={<EmptyState icon={Wrench} title="No events here" description="Events in this stage will show up here." />}
                    >
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Event</th>
                                        <th>Club</th>
                                        <th>When</th>
                                        <th>Registrations</th>
                                        <th>Status</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.map((event) => (
                                        <tr key={event._id}>
                                            <td>
                                                <Link to={`/events/${event._id}`} style={{ fontWeight: 600 }}>
                                                    {event.title}
                                                </Link>
                                                <div className="subtle">{event.venue?.name}</div>
                                            </td>
                                            <td>{event.club?.name}</td>
                                            <td className="nowrap">
                                                {formatDate(event.startAt)}
                                                <div className="subtle">{formatTimeRange(event.startAt, event.endAt)}</div>
                                            </td>
                                            <td>
                                                {event.registeredCount}
                                                {event.maxParticipants ? ` / ${event.maxParticipants}` : ""}
                                            </td>
                                            <td>
                                                <StatusBadge status={event.status} />
                                            </td>
                                            <td className="actions">
                                                <Link to={`/events/${event._id}`} className="btn btn-secondary btn-sm">
                                                    {event.status === "PENDING_APPROVAL" && isFaculty ? "Review" : "Open"}
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </AsyncContent>
                </Card>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </div>
        </>
    );
};

export default ManageEventsPage;
