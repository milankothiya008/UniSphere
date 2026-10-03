import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, ChevronLeft, Info, Megaphone, Pin, Users } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useToast } from "../../context/ToastContext";
import { Avatar, Button, ConfirmDialog, ErrorState, Modal, Spinner, Textarea } from "../ui";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { ChatInfo } from "./ChatInfo";
import { ForwardDialog } from "./ForwardDialog";
import { dayLabel, newClientId, presenceText, sameDay } from "../../lib/chat";

const RUN_GAP = 5 * 60 * 1000;

/** The open chat: header, pinned messages, the conversation, and the message box. */
export const ChatThread = ({ conversationId, onChanged }) => {
    const { user } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const { on, emit, presence, watchPresence, setOpenConversation, refreshUnread } = useChat();
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState(null);
    const [messages, setMessages] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [replyTo, setReplyTo] = useState(null);
    const [editing, setEditing] = useState(null);
    const [typing, setTyping] = useState({});
    const [info, setInfo] = useState(false);
    const [forwarding, setForwarding] = useState(null);
    const [reporting, setReporting] = useState(null);
    const [reportReason, setReportReason] = useState("");
    const [unsending, setUnsending] = useState(null);
    const [reactionsOf, setReactionsOf] = useState(null);
    const [highlight, setHighlight] = useState(null);
    const [atBottom, setAtBottom] = useState(true);
    const [fresh, setFresh] = useState(0);
    const [dropped, setDropped] = useState(null);
    const [dragging, setDragging] = useState(false);
    const scroller = useRef(null);
    const keepScroll = useRef(null);

    const loadDetail = useCallback(
        () =>
            chatApi
                .get(conversationId)
                .then((response) => setDetail(response.data))
                .catch((err) => setError(err)),
        [conversationId]
    );

    const markRead = useCallback(() => {
        if (document.visibilityState !== "visible") return;
        chatApi
            .read(conversationId)
            .then(() => {
                refreshUnread();
                onChanged?.({ _id: conversationId, unread: 0 });
            })
            .catch(() => {});
    }, [conversationId, refreshUnread, onChanged]);

    // Open: load the chat and the latest messages, then mark them read.
    useEffect(() => {
        let alive = true;
        setDetail(null);
        setError(null);
        setMessages([]);
        setReplyTo(null);
        setEditing(null);
        setInfo(false);
        setOpenConversation(conversationId);
        Promise.all([chatApi.get(conversationId), chatApi.messages(conversationId)])
            .then(([conversation, page]) => {
                if (!alive) return;
                setDetail(conversation.data);
                setMessages(page.data.items);
                setHasMore(page.data.hasMore);
                markRead();
            })
            .catch((err) => alive && setError(err));
        return () => {
            alive = false;
            setOpenConversation(null);
        };
    }, [conversationId, setOpenConversation, markRead]);

    useEffect(() => {
        if (detail?.type === "DIRECT" && detail.other) watchPresence([detail.other._id]);
    }, [detail?.type, detail?.other, watchPresence]);

    // Live updates for this chat.
    useEffect(() => {
        const mine = (message) => String(message.sender?._id) === String(user._id);
        const offs = [
            on("message:new", ({ conversationId: id, message }) => {
                if (String(id) !== String(conversationId)) return;
                const withMine = { ...message, mine: mine(message) };
                setMessages((current) => {
                    if (current.some((item) => item._id === message._id)) return current;
                    const pendingIndex = message.clientId ? current.findIndex((item) => item.pending && item.clientId === message.clientId) : -1;
                    if (pendingIndex >= 0) return current.map((item, index) => (index === pendingIndex ? withMine : item));
                    return [...current, withMine];
                });
                if (!mine(message)) {
                    markRead();
                    setTyping((current) => {
                        const next = { ...current };
                        delete next[message.sender?._id];
                        return next;
                    });
                    setFresh((count) => count + 1);
                }
            }),
            on("message:updated", ({ conversationId: id, messageId, patch }) => {
                if (String(id) !== String(conversationId)) return;
                setMessages((current) =>
                    current.map((item) =>
                        item._id === messageId
                            ? {
                                  ...item,
                                  ...patch,
                                  reactions: patch.reactions
                                      ? patch.reactions.map((reaction) => ({ ...reaction, mine: reaction.users.includes(String(user._id)) }))
                                      : item.reactions
                              }
                            : item
                    )
                );
            }),
            on("receipt", ({ conversationId: id, userId, readAt, deliveredAt }) => {
                if (String(id) !== String(conversationId)) return;
                setDetail((current) =>
                    current
                        ? {
                              ...current,
                              receipts: current.receipts.map((receipt) =>
                                  receipt.userId === userId
                                      ? { ...receipt, readAt: readAt || receipt.readAt, deliveredAt: deliveredAt || receipt.deliveredAt }
                                      : receipt
                              )
                          }
                        : current
                );
            }),
            on("typing", ({ conversationId: id, user: who, recording }) => {
                if (String(id) !== String(conversationId)) return;
                setTyping((current) => ({ ...current, [who._id]: { name: who.name, recording, until: Date.now() + 4500 } }));
            }),
            on("conversation:updated", ({ conversationId: id }) => String(id) === String(conversationId) && loadDetail()),
            on("conversation:removed", ({ conversationId: id }) => {
                if (String(id) !== String(conversationId)) return;
                toast.info("You're no longer in this chat");
                navigate("/messages", { replace: true });
            })
        ];
        return () => offs.forEach((off) => off());
    }, [on, conversationId, user._id, markRead, loadDetail, toast, navigate]);

    // Typing indicators fade after a few seconds without news.
    useEffect(() => {
        if (!Object.keys(typing).length) return undefined;
        const timer = setInterval(
            () => setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, value]) => value.until > Date.now()))),
            1500
        );
        return () => clearInterval(timer);
    }, [typing]);

    // Mark read when the tab comes back into view.
    useEffect(() => {
        const onVisible = () => document.visibilityState === "visible" && markRead();
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
    }, [markRead]);

    // ------------------------------------------------------------ Scrolling

    const scrollToBottom = (smooth = false) => {
        const box = scroller.current;
        if (box) box.scrollTo({ top: box.scrollHeight, behavior: smooth ? "smooth" : "auto" });
        setFresh(0);
    };

    useLayoutEffect(() => {
        const box = scroller.current;
        if (!box) return;
        if (keepScroll.current !== null) {
            box.scrollTop = box.scrollHeight - keepScroll.current;
            keepScroll.current = null;
            return;
        }
        if (atBottom || messages.at(-1)?.mine) scrollToBottom(messages.length > 40);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    const loadOlder = async () => {
        if (!hasMore || loadingOlder || !messages.length) return;
        setLoadingOlder(true);
        try {
            const page = await chatApi.messages(conversationId, messages[0]._id);
            keepScroll.current = scroller.current.scrollHeight - scroller.current.scrollTop;
            setMessages((current) => [...page.data.items, ...current]);
            setHasMore(page.data.hasMore);
        } catch (err) {
            toast.error(err);
        } finally {
            setLoadingOlder(false);
        }
    };

    const onScroll = () => {
        const box = scroller.current;
        if (!box) return;
        const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        setAtBottom(bottom);
        if (bottom) setFresh(0);
        if (box.scrollTop < 120) loadOlder();
    };

    const jump = (messageId) => {
        const element = document.getElementById(`m-${messageId}`);
        if (!element) {
            toast.info("That message is further up — scroll to load it");
            return;
        }
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlight(messageId);
        setTimeout(() => setHighlight(null), 1600);
    };

    // ------------------------------------------------------------ Actions

    const send = async ({ text, attachments, previews = [] }) => {
        const clientId = newClientId();
        const reply = replyTo;
        setReplyTo(null);
        const pending = {
            _id: `pending-${clientId}`,
            clientId,
            pending: true,
            mine: true,
            type: attachments.length ? (attachments[0].kind === "AUDIO" ? "VOICE" : attachments[0].kind === "DOCUMENT" ? "FILE" : "MEDIA") : "TEXT",
            sender: { _id: user._id, name: user.name, avatar: user.avatar },
            text,
            attachments: previews.map((item) => ({ ...item, thumb: item.url })),
            replyTo: reply ? { _id: reply._id, sender: reply.sender, text: reply.text || reply.preview } : null,
            reactions: [],
            createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, pending]);
        try {
            const response = await chatApi.send(conversationId, { clientId, text, attachments, replyTo: reply?._id || null });
            setMessages((current) => {
                if (current.some((item) => item._id === response.data._id)) return current.filter((item) => item._id !== pending._id);
                return current.map((item) => (item._id === pending._id ? { ...response.data, mine: true } : item));
            });
            onChanged?.();
        } catch (err) {
            setMessages((current) => current.filter((item) => item._id !== pending._id));
            toast.error(err);
        }
    };

    const actions = {
        reply: (message) => {
            setEditing(null);
            setReplyTo({ ...message, preview: message.text || (message.attachments[0] ? "Attachment" : "") });
        },
        copy: (message) => navigator.clipboard?.writeText(message.text).then(() => toast.success("Copied")),
        edit: (message) => {
            setReplyTo(null);
            setEditing({ _id: message._id, text: message.text, hasFiles: message.attachments.length > 0 });
        },
        forward: (message) => setForwarding(message),
        pin: async (message, pinned) => {
            try {
                setDetail((await chatApi.pin(conversationId, message._id, pinned)).data);
            } catch (err) {
                toast.error(err);
            }
        },
        delete: async (message, scope) => {
            if (scope === "everyone") {
                setUnsending(message);
                return;
            }
            try {
                await chatApi.remove(message._id, "me");
                setMessages((current) => current.filter((item) => item._id !== message._id));
            } catch (err) {
                toast.error(err);
            }
        },
        report: (message) => {
            setReportReason("");
            setReporting(message);
        },
        react: async (message, emoji) => {
            try {
                const response = await chatApi.react(message._id, emoji);
                setMessages((current) => current.map((item) => (item._id === message._id ? { ...item, reactions: response.data.reactions } : item)));
            } catch (err) {
                toast.error(err);
            }
        },
        jump,
        showReactions: (message) => setReactionsOf(message)
    };

    const saveEdit = async (text) => {
        const target = editing;
        setEditing(null);
        try {
            const response = await chatApi.edit(target._id, text);
            setMessages((current) => current.map((item) => (item._id === target._id ? { ...response.data, mine: true } : item)));
        } catch (err) {
            toast.error(err);
        }
    };

    const onTyping = (extra) => emit("typing", { conversationId, ...(extra || {}) });

    // ------------------------------------------------------------ Render

    const meta = useMemo(
        () => ({
            type: detail?.type,
            receipts: detail?.receipts || [],
            canPin: detail?.canPin,
            isAdmin: detail?.isAdmin,
            meId: String(user._id),
            pinnedIds: new Set((detail?.pinned || []).map((message) => String(message._id)))
        }),
        [detail, user._id]
    );

    if (error) return <ErrorState error={error} onRetry={() => navigate(0)} />;
    if (!detail) {
        return (
            <section className="chat-thread is-loading">
                <Spinner />
            </section>
        );
    }

    const typers = Object.values(typing);
    const subtitle = typers.length
        ? typers[0].recording
            ? `${detail.type === "DIRECT" ? "" : `${typers[0].name.split(" ")[0]} is `}recording audio…`
            : detail.type === "DIRECT"
              ? "typing…"
              : `${typers.map((who) => who.name.split(" ")[0]).join(", ")} ${typers.length > 1 ? "are" : "is"} typing…`
        : detail.type === "DIRECT"
          ? presenceText(presence[detail.other?._id] || detail.presence)
          : `${detail.memberCount} ${detail.memberCount === 1 ? "member" : "members"}${detail.announceOnly ? " · Only admins can send" : ""}`;

    const items = [];
    messages.forEach((message, index) => {
        const previous = messages[index - 1];
        const next = messages[index + 1];
        if (!previous || !sameDay(previous.createdAt, message.createdAt)) items.push({ day: dayLabel(message.createdAt), key: `d-${message._id}` });
        const sameRun = (a, b) =>
            a &&
            b &&
            a.type !== "SYSTEM" &&
            b.type !== "SYSTEM" &&
            a.sender?._id === b.sender?._id &&
            Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) < RUN_GAP &&
            sameDay(a.createdAt, b.createdAt);
        items.push({ message, first: !sameRun(previous, message), last: !sameRun(message, next) });
    });

    return (
        <section
            className={`chat-thread ${info ? "has-info" : ""}`}
            onDragOver={(event) => {
                if (detail.canSend && event.dataTransfer?.types?.includes("Files")) {
                    event.preventDefault();
                    setDragging(true);
                }
            }}
            onDragLeave={(event) => event.currentTarget === event.target && setDragging(false)}
            onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (detail.canSend && event.dataTransfer.files.length) setDropped({ files: event.dataTransfer.files, at: Date.now() });
            }}
        >
            <div className="chat-main">
                <header className="chat-head">
                    <Link to="/messages" className="icon-button chat-back" aria-label="Back to chats">
                        <ChevronLeft size={26} />
                    </Link>
                    <button type="button" className="chat-head-who" onClick={() => setInfo((value) => !value)}>
                        <span className="chat-row-avatar">
                            <Avatar name={detail.title} src={detail.avatar} square={detail.type === "CLUB"} />
                            {detail.type === "DIRECT" && presence[detail.other?._id]?.online && <span className="online-dot" />}
                        </span>
                        <span>
                            <strong>{detail.title}</strong>
                            <small className={typers.length ? "is-typing" : ""}>
                                {detail.type === "CLUB" && !typers.length && <Megaphone size={11} />}
                                {detail.type === "GROUP" && !typers.length && <Users size={11} />} {subtitle}
                            </small>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={`icon-button ${info ? "is-on" : ""}`}
                        onClick={() => setInfo((value) => !value)}
                        aria-label="Chat details"
                        aria-pressed={info}
                    >
                        <Info size={23} strokeWidth={1.8} />
                    </button>
                </header>

                {detail.pinned.length > 0 && (
                    <button type="button" className="chat-pinned" onClick={() => jump(detail.pinned.at(-1)._id)}>
                        <Pin size={15} />
                        <span>
                            <strong>Pinned{detail.pinned.length > 1 ? ` · ${detail.pinned.length}` : ""}</strong>
                            <span>{detail.pinned.at(-1).text || "Attachment"}</span>
                        </span>
                    </button>
                )}

                <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
                    <div className="chat-intro">
                        <Avatar name={detail.title} src={detail.avatar} size="xl" square={detail.type === "CLUB"} />
                        <strong>{detail.title}</strong>
                        <span className="subtle small">
                            {detail.type === "DIRECT"
                                ? [detail.other?.accountType === "FACULTY" ? "Faculty" : "Student", detail.other?.departmentCode].filter(Boolean).join(" · ")
                                : detail.type === "CLUB"
                                  ? `Club group · ${detail.memberCount} members`
                                  : `Group · ${detail.memberCount} members`}
                        </span>
                        {detail.type === "DIRECT" && detail.other && (
                            <Link to={`/people/${detail.other._id}`} className="btn btn-secondary btn-sm">
                                View profile
                            </Link>
                        )}
                    </div>
                    {loadingOlder && (
                        <div className="chat-older">
                            <Spinner size="sm" />
                        </div>
                    )}
                    {items.map((item) =>
                        item.day ? (
                            <div key={item.key} className="chat-day">
                                <span>{item.day}</span>
                            </div>
                        ) : (
                            <MessageBubble
                                key={item.message._id}
                                message={item.message}
                                first={item.first}
                                last={item.last}
                                conversation={meta}
                                showSender={detail.type !== "DIRECT"}
                                highlighted={highlight === item.message._id}
                                actions={actions}
                            />
                        )
                    )}
                    {typers.length > 0 && (
                        <div className="msg is-theirs is-first is-last">
                            <div className="bubble typing-bubble" aria-label="Typing">
                                <i />
                                <i />
                                <i />
                            </div>
                        </div>
                    )}
                </div>

                {!atBottom && (
                    <button type="button" className="chat-jump" onClick={() => scrollToBottom(true)} aria-label="Scroll to latest">
                        <ArrowDown size={18} />
                        {fresh > 0 && <span className="chat-badge">{fresh}</span>}
                    </button>
                )}

                <Composer
                    conversationId={conversationId}
                    blockedReason={detail.sendBlockedReason}
                    replyTo={replyTo}
                    onCancelReply={() => setReplyTo(null)}
                    editing={editing}
                    onCancelEdit={() => setEditing(null)}
                    onSend={send}
                    onEditSave={saveEdit}
                    onTyping={onTyping}
                    meId={String(user._id)}
                    dropped={dropped}
                />
                {dragging && <div className="chat-drop">Drop files to send</div>}
            </div>

            {info && (
                <ChatInfo
                    detail={detail}
                    onClose={() => setInfo(false)}
                    onUpdated={(next) => (setDetail(next), onChanged?.())}
                    onCleared={() => (setMessages([]), setHasMore(false), onChanged?.())}
                />
            )}

            <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />

            <ConfirmDialog
                open={Boolean(unsending)}
                onClose={() => setUnsending(null)}
                onConfirm={async () => {
                    await chatApi.remove(unsending._id, "everyone");
                    setMessages((current) =>
                        current.map((item) =>
                            item._id === unsending._id ? { ...item, deleted: true, text: "", attachments: [], link: null, reactions: [] } : item
                        )
                    );
                    onChanged?.();
                }}
                title={unsending?.mine ? "Unsend message?" : "Delete for everyone?"}
                description="It will be removed for everyone in this chat. People may have seen it already."
                confirmLabel={unsending?.mine ? "Unsend" : "Delete"}
                variant="danger"
            />

            <Modal
                open={Boolean(reporting)}
                onClose={() => setReporting(null)}
                title="Report message"
                description="The university admin will see this message and who sent it. The sender isn't told who reported it."
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setReporting(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            onClick={async () => {
                                try {
                                    await chatApi.report(reporting._id, reportReason);
                                    toast.success("Reported. Thanks for letting us know.");
                                    setReporting(null);
                                } catch (err) {
                                    toast.error(err);
                                }
                            }}
                        >
                            Report
                        </Button>
                    </>
                }
            >
                <Textarea
                    label="What's wrong? (optional)"
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="Harassment, spam, inappropriate content…"
                />
            </Modal>

            <Modal open={Boolean(reactionsOf)} onClose={() => setReactionsOf(null)} title="Reactions" size="sm">
                <ul className="reaction-list">
                    {(reactionsOf?.reactions || []).flatMap((reaction) =>
                        reaction.users.map((id) => {
                            const person = detail.members.find((member) => String(member._id) === String(id));
                            return (
                                <li key={`${reaction.emoji}-${id}`}>
                                    <Avatar name={person?.name || "Someone"} src={person?.avatar} size="sm" />
                                    <span>{String(id) === String(user._id) ? "You" : person?.name || "Someone"}</span>
                                    <span className="reaction-list-emoji">{reaction.emoji}</span>
                                </li>
                            );
                        })
                    )}
                </ul>
            </Modal>
        </section>
    );
};
