import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { notificationApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { useToast } from "../context/ToastContext";
import { AsyncContent, Button, Card, EmptyState, PageHeader, Pagination, Segmented } from "../components/ui";
import { formatDateTime, timeAgo } from "../lib/format";

const NotificationsPage = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [filters, setFilters] = useQueryState({ view: "all", page: "1" });
    const { data, meta, loading, error, reload, setData } = useApi(
        () => notificationApi.list({ unread: filters.view === "unread" ? "true" : undefined, page: filters.page, limit: 20 }),
        [filters.view, filters.page]
    );

    const open = async (item) => {
        if (!item.readAt) {
            await notificationApi.markRead(item._id).catch(() => {});
            setData((list) => list.map((n) => (n._id === item._id ? { ...n, readAt: new Date().toISOString() } : n)));
        }
        if (item.link) {
            navigate(item.link);
        }
    };

    const markAll = async () => {
        await notificationApi.markAllRead();
        toast.success("All notifications marked as read");
        reload({ silent: true });
    };

    return (
        <>
            <PageHeader
                eyebrow={<><Bell size={14} /> Notifications</>}
                title="Notifications"
                description="Approvals, registrations, results and updates from your clubs."
                actions={
                    <>
                        {meta?.unread > 0 && (
                            <Button variant="secondary" onClick={markAll}>
                                <CheckCheck size={16} /> Mark all as read
                            </Button>
                        )}
                        <Link to="/settings/notifications" className="btn btn-secondary">
                            <Settings size={16} /> Email settings
                        </Link>
                    </>
                }
            />
            <div className="stack">
                <Segmented
                    label="Filter notifications"
                    value={filters.view}
                    onChange={(view) => setFilters({ view })}
                    options={[
                        { value: "all", label: "All" },
                        { value: "unread", label: `Unread${meta?.unread ? ` (${meta.unread})` : ""}` }
                    ]}
                />
                <Card padded={false}>
                    <AsyncContent
                        loading={loading}
                        error={error}
                        onRetry={reload}
                        isEmpty={!data?.length}
                        empty={<EmptyState icon={Bell} title={filters.view === "unread" ? "No unread notifications" : "No notifications yet"} description="You're all caught up." />}
                    >
                        <div className="list-rows">
                            {data?.map((item) => (
                                <button
                                    key={item._id}
                                    type="button"
                                    className="list-row"
                                    onClick={() => open(item)}
                                    style={{ width: "100%", border: "none", borderBottom: "1px solid var(--border)", background: item.readAt ? "transparent" : "var(--ink-50)", textAlign: "left", cursor: "pointer" }}
                                >
                                    <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: item.readAt ? "transparent" : "var(--ink-500)" }} />
                                    <div className="grow">
                                        <div className="title" style={{ fontWeight: item.readAt ? 500 : 650 }}>
                                            {item.title}
                                        </div>
                                        {item.message && <div className="small muted">{item.message}</div>}
                                    </div>
                                    <span className="subtle nowrap" title={formatDateTime(item.createdAt)}>
                                        {timeAgo(item.createdAt)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </AsyncContent>
                </Card>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </div>
        </>
    );
};

export default NotificationsPage;
