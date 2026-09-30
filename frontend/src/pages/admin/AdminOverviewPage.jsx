import { Building2, CalendarDays, FileText, GraduationCap, Mail, MapPin, UserPlus, Users } from "lucide-react";
import { adminApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { AsyncContent, Card, PageHeader, StatTile, StatusBadge } from "../../components/ui";

const Breakdown = ({ title, counts }) => {
    const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);

    return (
        <Card title={title}>
            {entries.length === 0 ? (
                <p className="subtle">No data yet.</p>
            ) : (
                <div className="stack-sm">
                    {entries.map(([status, count]) => (
                        <div key={status} className="stack-sm" style={{ gap: 4 }}>
                            <div className="row-between">
                                <StatusBadge status={status} />
                                <strong>{count}</strong>
                            </div>
                            <div className="progress">
                                <span style={{ width: `${Math.round((count / total) * 100)}%` }} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
};

const AdminOverviewPage = () => {
    const { data: stats, loading, error, reload } = useApi(() => adminApi.stats(), []);

    return (
        <>
            <PageHeader title="Platform overview" />
            <AsyncContent loading={loading} error={error} onRetry={reload}>
                {stats && (
                    <div className="stack-lg">
                        <div className="grid-3">
                            <StatTile label="Students" value={stats.users.students} icon={Users} />
                            <StatTile label="Faculty" value={stats.users.faculty} icon={GraduationCap} tone="violet" />
                            <StatTile label="Club memberships" value={stats.memberships} icon={UserPlus} tone="success" />
                            <StatTile label="Clubs" value={stats.clubs.total} icon={Building2} />
                            <StatTile label="Events" value={stats.events.total} icon={CalendarDays} hint={`${stats.events.upcoming} upcoming`} tone="info" />
                            <StatTile label="Active registrations" value={stats.registrations} icon={CalendarDays} tone="success" />
                            <StatTile label="In faculty review" value={stats.clubRequests.pendingFacultyReview} icon={FileText} tone="violet" />
                            <StatTile label="Awaiting admin approval" value={stats.clubRequests.awaitingAdmin} icon={FileText} tone="gold" />
                            <StatTile label="Venues" value={stats.venues} icon={MapPin} tone="gold" />
                            {stats.emails && (
                                <StatTile
                                    label="Emails sent (24 h)"
                                    value={stats.emails.sentToday}
                                    icon={Mail}
                                    hint={`${stats.emails.pending} queued · ${stats.emails.failedToday} failed`}
                                />
                            )}
                        </div>
                        <div className="grid-2" style={{ alignItems: "start" }}>
                            <Breakdown title="Clubs by status" counts={stats.clubs.byStatus} />
                            <Breakdown title="Events by status" counts={stats.events.byStatus} />
                        </div>
                    </div>
                )}
            </AsyncContent>
        </>
    );
};

export default AdminOverviewPage;
