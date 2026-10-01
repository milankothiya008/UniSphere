import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Settings } from "lucide-react";
import { notificationApi, recruitmentApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { useAuth } from "../context/AuthContext";
import { setUnread, useUnreadCount } from "../hooks/useUnreadCount";
import { AsyncContent, EmptyState, PageHeader, Pagination } from "../components/ui";
import { formatDateTime, shortAgo } from "../lib/format";
import { NotificationIcon } from "../components/notifications/NotificationIcon";
import { ApplicationRow } from "../components/recruitment/ApplicationRow";

const DAY = 86400000;

// New (unseen when the page opened) / Today / This week / Earlier, like Instagram's activity list.
const groupByAge = (items, fresh) => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const groups = [
        ["New", (at, item) => fresh.has(item._id)],
        ["Today", (at) => at >= startOfToday],
        ["This week", (at) => at >= startOfToday - 6 * DAY],
        ["Earlier", () => true]
    ].map(([label, test]) => ({ label, test, items: [] }));
    items.forEach((item) => groups.find((group) => group.test(new Date(item.createdAt).getTime(), item)).items.push(item));
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
    const { data, meta, loading, error, reload } = useApi(() => notificationApi.list({ page: filters.page, limit: 30 }), [filters.page]);
    const unread = useUnreadCount();
    // What was unseen when the page opened stays highlighted under "New" while the student is here.
    const [fresh, setFresh] = useState(() => new Set());
    const marking = useRef(false);

    // Opening Activity marks everything as seen, like Instagram: the red dot clears right away.
    useEffect(() => {
        const unseen = (data || []).filter((item) => !item.readAt);
        if (!unseen.length || marking.current) return;
        marking.current = true;
        setFresh((current) => new Set([...current, ...unseen.map((item) => item._id)]));
        setUnread(0);
        notificationApi
            .markAllRead()
            .catch(() => {})
            .finally(() => {
                marking.current = false;
                setUnread(0);
            });
    }, [data]);

    // Something new arrived while the page is open: show it.
    useEffect(() => {
        if (unread > 0) reload({ silent: true });
    }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps

    const open = (item) => {
        if (item.link) {
            navigate(item.link);
        }
    };

    return (
        <div className="activity-page">
            <PageHeader
                title="Activity"
                actions={
                    <>
                        <Link to="/settings/notifications" className="icon-button" aria-label="Email settings" title="Email settings">
                            <Settings size={20} />
                        </Link>
                    </>
                }
            />
            {isStudent && <Offers />}
            <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={Bell} title="No activity yet" />}>
                {groupByAge(data || [], fresh).map((group) => (
                    <section key={group.label} className={`activity-section ${group.label === "New" ? "is-new" : ""}`}>
                        <h2 className="activity-heading">{group.label}</h2>
                        <div className="notification-list">
                            {group.items.map((item) => (
                                <button key={item._id} type="button" className={`notification-row ${fresh.has(item._id) ? "unread" : ""}`} onClick={() => open(item)}>
                                    <NotificationIcon type={item.type} size={16} />
                                    <div className="grow" style={{ minWidth: 0 }}>
                                        <div className="notification-title">
                                            {item.title} <span className="subtle" title={formatDateTime(item.createdAt)}>{shortAgo(item.createdAt)}</span>
                                        </div>
                                        {item.message && <div className="small muted notification-message">{item.message}</div>}
                                    </div>
                                    {fresh.has(item._id) && <span className="unread-dot" aria-label="New" />}
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
