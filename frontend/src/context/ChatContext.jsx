import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { chatApi } from "../api/endpoints";
import { useAuth } from "./AuthContext";
import { connectChat, disconnectChat } from "../lib/chatSocket";
import { MessageBanners, playMessageSound } from "../components/chat/MessageBanners";

// Live chat state shared by the whole signed-in app: the socket, the unread badge, who's online, which chat
// is on screen (no notifications for it), and Instagram-style banners for messages that arrive elsewhere.

const noop = () => () => {};
const ChatContext = createContext({
    connected: false,
    unread: { chats: 0, messages: 0 },
    refreshUnread: () => {},
    on: noop,
    emit: () => {},
    presence: {},
    watchPresence: () => {},
    setOpenConversation: () => {},
    settings: null,
    updateSettings: async () => {},
    sound: true,
    setSound: () => {}
});

const SOUND_KEY = "cc.chatSound";
const readSound = () => {
    try {
        return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
        return true;
    }
};

const BASE_TITLE = typeof document !== "undefined" ? document.title : "CampusConnect";
const ATTACHMENT_TEXT = { IMAGE: "📷 Photo", VIDEO: "🎥 Video", AUDIO: "🎤 Voice message", DOCUMENT: "📄 File" };

export const ChatProvider = ({ children }) => {
    const { user } = useAuth();
    const { pathname } = useLocation();
    const [connected, setConnected] = useState(false);
    const [unread, setUnread] = useState({ chats: 0, messages: 0 });
    const [presence, setPresence] = useState({});
    const [banners, setBanners] = useState([]);
    const [settings, setSettings] = useState(null);
    const [sound, setSoundState] = useState(readSound);
    const socketRef = useRef(null);
    const openRef = useRef(null);
    const timer = useRef(null);
    const pathRef = useRef(pathname);
    const prefs = useRef({ settings: null, sound });
    pathRef.current = pathname;
    prefs.current = { settings, sound };

    const refreshUnread = useCallback(() => {
        clearTimeout(timer.current);
        // Several events in a burst (a busy group) cause one request.
        timer.current = setTimeout(() => {
            chatApi
                .unread()
                .then((response) => setUnread(response.data))
                .catch(() => {});
        }, 400);
    }, []);

    // Tell the server which chat is on screen, so it doesn't send a notification for it.
    const reportViewing = useCallback(() => {
        socketRef.current?.emit("viewing", { conversationId: openRef.current, visible: document.visibilityState === "visible" });
    }, []);

    useEffect(() => {
        if (!user) return undefined;
        chatApi
            .settings()
            .then((response) => setSettings(response.data))
            .catch(() => {});
        const socket = connectChat();
        socketRef.current = socket;
        const onConnect = () => {
            setConnected(true);
            reportViewing();
        };
        const onDisconnect = () => setConnected(false);
        const onMessage = ({ conversationId, message, conversation, mutedFor = [] }) => {
            const mine = String(message?.sender?._id) === String(user._id);
            if (mine) return;
            socket.emit("delivered", { conversationId });
            const open = openRef.current === String(conversationId);
            if (!open) refreshUnread();

            // A banner when the message is for a chat that isn't on screen — not for muted chats, while
            // the chat list itself is showing, or with message notifications switched off.
            const muted = mutedFor.map(String).includes(String(user._id));
            const listShowing = pathRef.current === "/messages";
            const visible = document.visibilityState === "visible";
            if (open || muted || listShowing || !visible || message.type === "SYSTEM" || prefs.current.settings?.chatNotifications === false) return;
            const preview = message.deleted ? "Message unsent" : message.text || ATTACHMENT_TEXT[message.attachments?.[0]?.kind] || "New message";
            const direct = !conversation || conversation.type === "DIRECT";
            setBanners((current) =>
                [
                    {
                        key: `${message._id}`,
                        conversationId: String(conversationId),
                        sender: message.sender?.name || "Someone",
                        avatar: direct ? message.sender?.avatar : conversation?.avatar || message.sender?.avatar,
                        title: direct ? message.sender?.name || "New message" : conversation?.title || "Group",
                        body: direct ? preview : `${message.sender?.name?.split(" ")[0] || "Someone"}: ${preview}`,
                        until: Date.now() + 5000
                    },
                    // One banner per chat, newest on top, three at most.
                    ...current.filter((banner) => banner.conversationId !== String(conversationId))
                ].slice(0, 3)
            );
            if (prefs.current.sound) playMessageSound();
        };
        const onPresence = (payload) => setPresence((current) => ({ ...current, [payload.userId]: payload }));
        const onVisibility = () => reportViewing();
        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("message:new", onMessage);
        socket.on("conversation:read", refreshUnread);
        socket.on("conversation:removed", refreshUnread);
        socket.on("conversation:muted", refreshUnread);
        socket.on("presence", onPresence);
        document.addEventListener("visibilitychange", onVisibility);
        // A push for a chat while the app is open (but its socket was asleep) refreshes the badge.
        const onWorker = (event) => event.data?.kind === "chat" && refreshUnread();
        navigator.serviceWorker?.addEventListener?.("message", onWorker);
        if (socket.connected) onConnect();
        refreshUnread();
        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("message:new", onMessage);
            socket.off("conversation:read", refreshUnread);
            socket.off("conversation:removed", refreshUnread);
            socket.off("conversation:muted", refreshUnread);
            socket.off("presence", onPresence);
            document.removeEventListener("visibilitychange", onVisibility);
            navigator.serviceWorker?.removeEventListener?.("message", onWorker);
            disconnectChat();
            socketRef.current = null;
            clearTimeout(timer.current);
        };
    }, [user, refreshUnread, reportViewing]);

    // "(3) CampusConnect" in the browser tab while messages wait.
    useEffect(() => {
        document.title = unread.messages > 0 ? `(${unread.messages > 99 ? "99+" : unread.messages}) ${BASE_TITLE}` : BASE_TITLE;
        return () => {
            document.title = BASE_TITLE;
        };
    }, [unread.messages]);

    const on = useCallback((event, handler) => {
        const socket = socketRef.current;
        if (!socket) return () => {};
        socket.on(event, handler);
        return () => socket.off(event, handler);
    }, []);

    const emit = useCallback((event, payload, callback) => socketRef.current?.emit(event, payload, callback), []);

    const watchPresence = useCallback((ids) => {
        const socket = socketRef.current;
        if (!socket || !ids.length) return;
        socket.emit("presence:watch", ids, (states) => {
            if (Array.isArray(states)) setPresence((current) => ({ ...current, ...Object.fromEntries(states.map((state) => [state.userId, state])) }));
        });
    }, []);

    const setOpenConversation = useCallback(
        (id) => {
            openRef.current = id ? String(id) : null;
            if (id) setBanners((current) => current.filter((banner) => banner.conversationId !== String(id)));
            reportViewing();
        },
        [reportViewing]
    );

    const updateSettings = useCallback(async (patch) => {
        const response = await chatApi.updateSettings(patch);
        setSettings(response.data);
        return response.data;
    }, []);

    const setSound = useCallback((value) => {
        setSoundState(value);
        try {
            localStorage.setItem(SOUND_KEY, value ? "on" : "off");
        } catch {
            // Storage blocked: the choice lasts for this visit.
        }
    }, []);

    const dismiss = useCallback((key) => setBanners((current) => current.filter((banner) => banner.key !== key)), []);

    const value = useMemo(
        () => ({ connected, unread, refreshUnread, on, emit, presence, watchPresence, setOpenConversation, settings, updateSettings, sound, setSound }),
        [connected, unread, refreshUnread, on, emit, presence, watchPresence, setOpenConversation, settings, updateSettings, sound, setSound]
    );
    return (
        <ChatContext.Provider value={value}>
            {children}
            <MessageBanners banners={banners} onDismiss={dismiss} />
        </ChatContext.Provider>
    );
};

export const useChat = () => useContext(ChatContext);
