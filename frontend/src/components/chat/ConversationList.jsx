import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BellOff, MessageCirclePlus, Megaphone, Search, Users } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import { Avatar, EmptyState, Skeleton } from "../ui";
import { listTime } from "../../lib/chat";

const FILTERS = [
    ["all", "All"],
    ["unread", "Unread"],
    ["groups", "Groups"],
    ["clubs", "Clubs"]
];

/** One row: avatar (with an online dot), name, last message, time and unread badge. */
const Row = ({ row, active, presence }) => {
    const online = row.type === "DIRECT" && presence?.[row.other?._id]?.online;
    const typing = row.typing;
    const preview = typing
        ? `${row.type === "DIRECT" ? "" : `${typing} `}typing…`
        : row.lastMessage
          ? `${row.lastMessage.mine ? "You: " : ""}${row.lastMessage.preview}`
          : row.type === "CLUB"
            ? "Club group · say hi to everyone"
            : "No messages yet";
    return (
        <Link
            to={`/messages/${row._id}`}
            className={`chat-row ${active ? "is-active" : ""} ${row.unread ? "is-unread" : ""}`}
            aria-current={active ? "page" : undefined}
        >
            <span className="chat-row-avatar">
                <Avatar name={row.title} src={row.avatar} size="lg" square={row.type === "CLUB"} />
                {row.type !== "DIRECT" && <span className="chat-row-kind">{row.type === "CLUB" ? <Megaphone size={11} /> : <Users size={11} />}</span>}
                {online && <span className="online-dot" aria-label="Active now" />}
            </span>
            <span className="chat-row-body">
                <strong>{row.title}</strong>
                <span className={`chat-row-preview ${typing ? "is-typing" : ""}`}>
                    <span className="chat-row-text">{preview}</span>
                    {row.lastMessageAt && !typing && <span className="chat-row-time"> · {listTime(row.lastMessageAt)}</span>}
                </span>
            </span>
            <span className="chat-row-meta">
                {row.muted && <BellOff size={14} aria-label="Muted" />}
                {row.unread > 0 && <span className={`chat-badge ${row.muted ? "is-muted" : ""}`}>{row.unread > 99 ? "99+" : row.unread}</span>}
            </span>
        </Link>
    );
};

export const ConversationList = ({ rows, loading, activeId, filter, onFilter, onNew, typingByChat }) => {
    const { presence, watchPresence } = useChat();
    const [search, setSearch] = useState("");

    const directIds = useMemo(() => rows.filter((row) => row.type === "DIRECT" && row.other).map((row) => row.other._id), [rows]);
    useEffect(() => {
        watchPresence(directIds);
    }, [directIds, watchPresence]);

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        return rows.filter((row) => !term || row.title.toLowerCase().includes(term)).map((row) => ({ ...row, typing: typingByChat?.[row._id] }));
    }, [rows, search, typingByChat]);

    return (
        <aside className="chat-list" aria-label="Chats">
            <header className="chat-list-head">
                <h1>Messages</h1>
                <button type="button" className="icon-button" onClick={onNew} aria-label="New message" title="New message">
                    <MessageCirclePlus size={24} strokeWidth={1.8} />
                </button>
            </header>
            <label className="chat-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" aria-label="Search chats" />
            </label>
            <div className="chat-filters" role="tablist" aria-label="Show">
                {FILTERS.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={filter === value}
                        className={`chat-filter ${filter === value ? "active" : ""}`}
                        onClick={() => onFilter(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="chat-rows">
                {loading && !rows.length ? (
                    Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className="chat-row is-skeleton">
                            <Skeleton width={56} height={56} style={{ borderRadius: "50%" }} />
                            <span className="chat-row-body">
                                <Skeleton width="50%" height={12} />
                                <Skeleton width="80%" height={10} />
                            </span>
                        </div>
                    ))
                ) : visible.length ? (
                    visible.map((row) => <Row key={row._id} row={row} active={String(row._id) === String(activeId)} presence={presence} />)
                ) : (
                    <EmptyState
                        icon={MessageCirclePlus}
                        title={search ? "No chats match" : filter === "unread" ? "You're all caught up" : "No messages yet"}
                        description={search || filter !== "all" ? null : "Message a friend, a club member or a faculty member."}
                        action={
                            !search && filter === "all" ? (
                                <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
                                    Send message
                                </button>
                            ) : null
                        }
                    />
                )}
            </div>
        </aside>
    );
};
