import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { notificationApi } from "../../api/endpoints";
import { timeAgo } from "../../lib/format";
import { NotificationIcon } from "../notifications/NotificationIcon";

const POLL_MS = 60_000;

export const NotificationBell = () => {
    const [count, setCount] = useState(0);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const boxRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();

    const refreshCount = useCallback(() => {
        notificationApi
            .unreadCount()
            .then((response) => setCount(response.data.count))
            .catch(() => {});
    }, []);

    useEffect(() => {
        refreshCount();
        const timer = setInterval(refreshCount, POLL_MS);
        return () => clearInterval(timer);
    }, [refreshCount, location.pathname]);

    useEffect(() => {
        const close = (event) => !boxRef.current?.contains(event.target) && setOpen(false);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, []);

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (next) {
            setLoading(true);
            try {
                const response = await notificationApi.list({ limit: 6 });
                setItems(response.data);
                setCount(response.meta.unread);
            } catch {
                setItems([]);
            } finally {
                setLoading(false);
            }
        }
    };

    const openItem = async (item) => {
        setOpen(false);
        if (!item.readAt) {
            notificationApi.markRead(item._id).then(refreshCount).catch(() => {});
        }
        if (item.link) {
            navigate(item.link);
        }
    };

    const markAll = async () => {
        await notificationApi.markAllRead().catch(() => {});
        setItems((list) => list.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
        setCount(0);
    };

    return (
        <div style={{ position: "relative" }} ref={boxRef}>
            <button type="button" className="icon-button" onClick={toggle} aria-label={`Notifications (${count} unread)`} aria-expanded={open}>
                <Bell size={19} />
                {count > 0 && <span className="dot">{count > 99 ? "99+" : count}</span>}
            </button>
            {open && (
                <div className="popover" style={{ width: 360, maxWidth: "calc(100vw - 24px)" }}>
                    <div className="row-between" style={{ padding: "6px 8px 8px" }}>
                        <strong>Notifications</strong>
                        {count > 0 && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={markAll}>
                                <CheckCheck size={14} /> Mark all read
                            </button>
                        )}
                    </div>
                    {loading && <div className="subtle" style={{ padding: 12 }}>Loading…</div>}
                    {!loading && items.length === 0 && <div className="subtle" style={{ padding: 12 }}>You're all caught up.</div>}
                    {!loading &&
                        items.map((item) => (
                            <button key={item._id} type="button" className="menu-item" style={{ alignItems: "flex-start" }} onClick={() => openItem(item)}>
                                <NotificationIcon type={item.type} />
                                <span style={{ minWidth: 0 }}>
                                    <strong style={{ display: "block", fontSize: "0.87rem", fontWeight: item.readAt ? 500 : 650 }}>{item.title}</strong>
                                    {item.message && (
                                        <span className="subtle" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 290 }}>
                                            {item.message}
                                        </span>
                                    )}
                                    <span className="subtle">{timeAgo(item.createdAt)}</span>
                                </span>
                            </button>
                        ))}
                    <div className="menu-divider" />
                    <Link to="/notifications" className="menu-item" onClick={() => setOpen(false)} style={{ justifyContent: "center", fontWeight: 600 }}>
                        View all notifications
                    </Link>
                </div>
            )}
        </div>
    );
};
