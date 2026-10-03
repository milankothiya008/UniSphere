import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { ConversationList } from "../../components/chat/ConversationList";
import { ChatThread } from "../../components/chat/ChatThread";
import { NewChatDialog } from "../../components/chat/NewChatDialog";
import { Button } from "../../components/ui";

/**
 * Messages, like Instagram: chats on the left and the open chat on the right (on phones, one at a time).
 * The list keeps itself up to date from the live connection.
 */
const MessagesPage = () => {
    const { id } = useParams();
    const { user } = useAuth();
    const { on } = useChat();
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [creating, setCreating] = useState(false);
    const [typingByChat, setTypingByChat] = useState({});
    const timers = useRef({});

    const load = useCallback(() => {
        chatApi
            .conversations()
            .then((response) => setRows(response.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const offs = [
            on("message:new", ({ conversationId, message }) => {
                const mine = String(message.sender?._id) === String(user._id);
                setRows((current) => {
                    const row = current.find((item) => String(item._id) === String(conversationId));
                    if (!row) {
                        load();
                        return current;
                    }
                    const preview =
                        message.type === "SYSTEM"
                            ? message.text
                            : message.text ||
                              (message.attachments?.[0]
                                  ? { IMAGE: "📷 Photo", VIDEO: "🎥 Video", AUDIO: "🎤 Voice message", DOCUMENT: "📄 File" }[message.attachments[0].kind]
                                  : "");
                    const updated = {
                        ...row,
                        lastMessage: {
                            preview,
                            at: message.createdAt,
                            mine: mine && message.type !== "SYSTEM",
                            system: message.type === "SYSTEM",
                            senderId: message.sender?._id
                        },
                        lastMessageAt: message.createdAt,
                        unread: mine || String(conversationId) === String(id) ? row.unread : row.unread + (message.type === "SYSTEM" ? 0 : 1)
                    };
                    return [updated, ...current.filter((item) => item !== row)];
                });
                setTypingByChat((current) => {
                    const next = { ...current };
                    delete next[conversationId];
                    return next;
                });
            }),
            on("typing", ({ conversationId, user: who }) => {
                setTypingByChat((current) => ({ ...current, [conversationId]: who.name.split(" ")[0] }));
                clearTimeout(timers.current[conversationId]);
                timers.current[conversationId] = setTimeout(
                    () =>
                        setTypingByChat((current) => {
                            const next = { ...current };
                            delete next[conversationId];
                            return next;
                        }),
                    4500
                );
            }),
            on("conversation:updated", load),
            on("conversation:removed", ({ conversationId }) => setRows((current) => current.filter((row) => String(row._id) !== String(conversationId)))),
            on("connect", load)
        ];
        return () => offs.forEach((off) => off());
    }, [on, user._id, id, load]);

    useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

    // The open chat tells the list when something changed (read, sent, renamed).
    const onChanged = useCallback(
        (patch) => {
            if (patch?._id) setRows((current) => current.map((row) => (String(row._id) === String(patch._id) ? { ...row, ...patch } : row)));
            else load();
        },
        [load]
    );

    const shown =
        filter === "all"
            ? rows
            : filter === "unread"
              ? rows.filter((row) => row.unread > 0)
              : filter === "groups"
                ? rows.filter((row) => row.type !== "DIRECT")
                : rows.filter((row) => row.type === "CLUB");

    return (
        <div className={`messages ${id ? "has-open" : ""}`}>
            <ConversationList
                rows={shown}
                loading={loading}
                activeId={id}
                filter={filter}
                onFilter={setFilter}
                onNew={() => setCreating(true)}
                typingByChat={typingByChat}
            />
            {id ? (
                <ChatThread key={id} conversationId={id} onChanged={onChanged} />
            ) : (
                <section className="chat-empty">
                    <span className="chat-empty-icon">
                        <MessageCircle size={44} strokeWidth={1.4} />
                    </span>
                    <h2>Your messages</h2>
                    <p className="subtle">Send photos, voice notes and files to friends, club members and faculty.</p>
                    <Button onClick={() => setCreating(true)}>Send message</Button>
                </section>
            )}
            <NewChatDialog open={creating} onClose={() => setCreating(false)} />
        </div>
    );
};

export default MessagesPage;
