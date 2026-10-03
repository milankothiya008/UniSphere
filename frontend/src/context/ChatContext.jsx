import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { chatApi } from "../api/endpoints";
import { useAuth } from "./AuthContext";
import { connectChat, disconnectChat } from "../lib/chatSocket";

// Live chat state shared by the whole signed-in app: the socket, the unread badge, who's online, and which
// chat is open (messages there don't count as unread).

const noop = () => () => {};
const ChatContext = createContext({
    connected: false,
    unread: { chats: 0, messages: 0 },
    refreshUnread: () => {},
    on: noop,
    emit: () => {},
    presence: {},
    watchPresence: () => {},
    setOpenConversation: () => {}
});

export const ChatProvider = ({ children }) => {
    const { user } = useAuth();
    const [connected, setConnected] = useState(false);
    const [unread, setUnread] = useState({ chats: 0, messages: 0 });
    const [presence, setPresence] = useState({});
    const socketRef = useRef(null);
    const openRef = useRef(null);
    const timer = useRef(null);

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

    useEffect(() => {
        if (!user) return undefined;
        const socket = connectChat();
        socketRef.current = socket;
        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);
        const onMessage = ({ conversationId, message }) => {
            const mine = String(message?.sender?._id) === String(user._id);
            if (!mine) socket.emit("delivered", { conversationId });
            if (!mine && openRef.current !== String(conversationId)) refreshUnread();
        };
        const onPresence = (payload) => setPresence((current) => ({ ...current, [payload.userId]: payload }));
        socket.on("connect", onConnect);
        socket.on("disconnect", onDisconnect);
        socket.on("message:new", onMessage);
        socket.on("conversation:read", refreshUnread);
        socket.on("conversation:removed", refreshUnread);
        socket.on("presence", onPresence);
        if (socket.connected) setConnected(true);
        refreshUnread();
        return () => {
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("message:new", onMessage);
            socket.off("conversation:read", refreshUnread);
            socket.off("conversation:removed", refreshUnread);
            socket.off("presence", onPresence);
            disconnectChat();
            socketRef.current = null;
            clearTimeout(timer.current);
        };
    }, [user, refreshUnread]);

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

    const setOpenConversation = useCallback((id) => {
        openRef.current = id ? String(id) : null;
    }, []);

    const value = useMemo(
        () => ({ connected, unread, refreshUnread, on, emit, presence, watchPresence, setOpenConversation }),
        [connected, unread, refreshUnread, on, emit, presence, watchPresence, setOpenConversation]
    );
    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => useContext(ChatContext);
