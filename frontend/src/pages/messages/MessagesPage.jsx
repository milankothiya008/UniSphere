import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { BellRing, MessageCircle, X } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { ConversationList } from "../../components/chat/ConversationList";
import { ChatThread } from "../../components/chat/ChatThread";
import { NewChatDialog } from "../../components/chat/NewChatDialog";
import { Button } from "../../components/ui";
import { ChatOptionsSheet } from "../../components/chat/ChatOptionsSheet";
import { useToast } from "../../context/ToastContext";
import { currentSubscription, enablePush, permission, pushSupported } from "../../lib/push";

const PROMPT_KEY = "cc.chatPushPrompt";

/** "Turn on notifications" above the chat list, until this device has them (or the person says no). */
const NotificationPrompt = () => {
    const toast = useToast();
    const [show, setShow] = useState(false);
    useEffect(() => {
        let alive = true;
        const dismissed = (() => {
            try {
                return localStorage.getItem(PROMPT_KEY) === "dismissed";
            } catch {
                return false;
            }
        })();
        if (!pushSupported() || dismissed || permission() === "denied") return undefined;
        currentSubscription()
            .then((subscription) => alive && setShow(!subscription))
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);
    if (!show) return null;
    const dismiss = () => {
        setShow(false);
        try {
            localStorage.setItem(PROMPT_KEY, "dismissed");
        } catch {
            // ignore
        }
    };
    return (
        <div className="chat-notice">
            <BellRing size={20} />
            <span>
                <strong>Turn on notifications</strong>
                <span>Know when you get a message, even when CampusConnect is closed.</span>
            </span>
            <Button
                size="sm"
                onClick={async () => {
                    try {
                        await enablePush();
                        toast.success("Notifications are on");
                        setShow(false);
                    } catch (error) {
                        toast.error(error.message || error);
                    }
                }}
            >
                Turn on
            </Button>
            <button type="button" className="icon-button" onClick={dismiss} aria-label="Not now">
                <X size={16} />
            </button>
        </div>
    );
};

/**
 * Messages, like Instagram: chats on the left and the open chat on the right (on phones, one at a time).
 * The list keeps itself up to date from the live connection.
 */
const MessagesPage = () => {
    const { id } = useParams();
    const { user } = useAuth();
    const { on, refreshUnread } = useChat();
    const toast = useToast();
    const [options, setOptions] = useState(null);
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
            on("conversation:muted", ({ conversationId, mutedUntil }) =>
                setRows((current) =>
                    current.map((row) => (String(row._id) === String(conversationId) ? { ...row, muted: Boolean(mutedUntil), mutedUntil } : row))
                )
            ),
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

    const patchRow = (id, patch) => setRows((current) => current.map((row) => (String(row._id) === String(id) ? { ...row, ...patch } : row)));

    const muteRow = async (row, duration) => {
        try {
            const response = await chatApi.mute(row._id, duration);
            patchRow(row._id, { muted: response.data.muted, mutedUntil: response.data.mutedUntil });
            refreshUnread();
            toast.success(duration ? `${row.title} is muted` : `${row.title} is unmuted`);
        } catch (error) {
            toast.error(error);
        }
    };

    const readRow = async (row) => {
        await chatApi.read(row._id).catch(() => {});
        patchRow(row._id, { unread: 0 });
        refreshUnread();
    };

    const clearRow = async (row) => {
        try {
            await chatApi.clear(row._id);
            if (row.type === "DIRECT") setRows((current) => current.filter((item) => item._id !== row._id));
            else patchRow(row._id, { lastMessage: null, unread: 0 });
            refreshUnread();
        } catch (error) {
            toast.error(error);
        }
    };

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
                onOptions={setOptions}
                notice={<NotificationPrompt />}
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
            <ChatOptionsSheet row={options} onClose={() => setOptions(null)} onMute={muteRow} onRead={readRow} onClear={clearRow} />
        </div>
    );
};

export default MessagesPage;
