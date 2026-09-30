import { Link, useNavigate } from "react-router-dom";
import { Bell, Settings } from "lucide-react";
import { notificationApi, recruitmentApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { useAuth } from "../context/AuthContext";
import { refreshUnread, setUnread } from "../hooks/useUnreadCount";
import { AsyncContent, EmptyState, PageHeader, Pagination } from "../components/ui";
import { formatDateTime, shortAgo } from "../lib/format";
import { NotificationIcon } from "../components/notifications/NotificationIcon";
import { ApplicationRow } from "../components/recruitment/ApplicationRow";

const DAY = 86400000;

// Today / This week / Earlier, like Instagram's activity list.
const groupByAge = (items) => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const groups = [
        ["Today", (at) => at >= startOfToday],
        ["This week", (at) => at >= startOfToday - 6 * DAY],
        ["Earlier", () => true]
    ].map(([label, test]) => ({ label, test, items: [] }));
    items.forEach((item) => groups.find((group) => group.test(new Date(item.createdAt).getTime())).items.push(item));
    return groups.filter((group) => group.items.length);
};

// Recruitment offers wait for an answer, so they stay pinned above the list.
const Offers = () => {
    const { data } = useApi(() => recruitmentApi.mine(), []);
    const offers = (data || []).filter((application) => application.status === "OFFERED");
    if (!offers.length) {
        return null;
    }
    return (
        <section className="activity-section">
            <h2 className="activity-heading">Offers</h2>
            <div className="recruit-dash-list">
                {offers.map((application) => (
                    <ApplicationRow key={application._id} application={application} compact />
                ))}
            </div>
        </section>
    );
};

const NotificationsPage = () => {
    const navigate = useNavigate();
    const { isStudent } = useAuth();
    const [filters, setFilters] = useQueryState({ page: "1" });
    const { data, meta, loading, error, reload, setData } = useApi(() => notificationApi.list({ page: filters.page, limit: 30 }), [filters.page]);

    const open = async (item) => {
        if (!item.readAt) {
            setData((list) => list.map((n) => (n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n)));
            notificationApi.markRead(item._id).then(refreshUnread).catch(() => {});
        }
        if (item.link) {
            navigate(item.link);
        }
    };

    const markAll = async () => {
        await notificationApi.markAllRead().catch(() => {});
        setUnread(0);
        reload({ silent: true });
    };

    return (
        <div className="activity-page">
            <PageHeader
                title="Activity"
                actions={
                    <>
                        {meta?.unread > 0 && (
                            <button type="button" className="link-button" onClick={markAll}>
                                Mark all read
                            </button>
                        )}
                        <Link to="/settings/notifications" className="icon-button" aria-label="Email settings" title="Email settings">
                            <Settings size={20} />
                        </Link>
                    </>
                }
            />
            {isStudent && <Offers />}
            <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={Bell} title="No activity yet" />}>
                {groupByAge(data || []).map((group) => (
                    <section key={group.label} className="activity-section">
                        <h2 className="activity-heading">{group.label}</h2>
                        <div className="notification-list">
                            {group.items.map((item) => (
                                <button key={item._id} type="button" className={`notification-row ${item.readAt ? "" : "unread"}`} onClick={() => open(item)}>
                                    <NotificationIcon type={item.type} size={16} />
                                    <div className="grow" style={{ minWidth: 0 }}>
                                        <div className="notification-title">
                                            {item.title} <span className="subtle" title={formatDateTime(item.createdAt)}>{shortAgo(item.createdAt)}</span>
                                        </div>
                                        {item.message && <div className="small muted notification-message">{item.message}</div>}
                                    </div>
                                    {!item.readAt && <span className="unread-dot" aria-label="Unread" />}
                                </button>
                            ))}
                        </div>
                    </section>
                ))}
            </AsyncContent>
            <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
        </div>
    );
};

export default NotificationsPage;
