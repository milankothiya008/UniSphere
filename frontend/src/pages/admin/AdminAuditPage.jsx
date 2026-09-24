import { ScrollText } from "lucide-react";
import { adminApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { AsyncContent, Avatar, Badge, Card, EmptyState, PageHeader, Pagination, StatusBadge } from "../../components/ui";
import { formatDateTime, humanize } from "../../lib/format";

const TARGETS = ["", "User", "ClubCreationRequest", "Club", "ClubMembership", "Event", "EventRegistration", "EventResult", "FeedPost"];

const AdminAuditPage = () => {
    const [filters, setFilters] = useQueryState({ targetType: "", page: "1" });
    const { data, meta, loading, error, reload } = useApi(
        () => adminApi.auditLogs({ targetType: filters.targetType, page: filters.page, limit: 25 }),
        [filters.targetType, filters.page]
    );

    return (
        <>
            <PageHeader
                eyebrow={<><ScrollText size={14} /> Administration</>}
                title="Audit log"
                description="Who did what, when, and to which record — every important state change on the platform."
            />
            <div className="stack">
                <div className="filter-bar">
                    <select className="select" value={filters.targetType} onChange={(e) => setFilters({ targetType: e.target.value })} aria-label="Record type">
                        {TARGETS.map((target) => (
                            <option key={target} value={target}>
                                {target ? humanize(target.replace(/([a-z])([A-Z])/g, "$1_$2")) : "All record types"}
                            </option>
                        ))}
                    </select>
                </div>
                <Card padded={false}>
                    <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={ScrollText} title="No audit entries" />}>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>When</th>
                                        <th>Who</th>
                                        <th>Action</th>
                                        <th>Record</th>
                                        <th>Change</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.map((entry) => (
                                        <tr key={entry._id}>
                                            <td className="nowrap subtle">{formatDateTime(entry.createdAt)}</td>
                                            <td>
                                                <div className="row" style={{ flexWrap: "nowrap" }}>
                                                    <Avatar name={entry.actor?.name} size="sm" />
                                                    <span>
                                                        {entry.actor?.name || "—"}
                                                        <div className="subtle">{entry.actor?.email}</div>
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <Badge tone="ink">{humanize(entry.action)}</Badge>
                                                {entry.reason && <div className="subtle" style={{ maxWidth: 260 }}>“{entry.reason}”</div>}
                                            </td>
                                            <td className="nowrap">
                                                {entry.targetType}
                                                <div className="subtle">…{String(entry.targetId).slice(-6)}</div>
                                            </td>
                                            <td className="nowrap">
                                                {entry.fromState || entry.toState ? (
                                                    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                                                        {entry.fromState ? <StatusBadge status={entry.fromState} dot={false} /> : <span className="subtle">—</span>}→
                                                        {entry.toState ? <StatusBadge status={entry.toState} dot={false} /> : <span className="subtle">removed</span>}
                                                    </span>
                                                ) : (
                                                    <span className="subtle">—</span>
                                                )}
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

export default AdminAuditPage;
