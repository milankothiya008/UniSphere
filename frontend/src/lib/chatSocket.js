import { io } from "socket.io-client";
import { getAccessToken, refreshSession } from "../api/client";
import vercel from "../../vercel.json";

// The live chat connection (Socket.IO). Vercel forwards /api to the backend but can't forward WebSockets,
// so on the deployed site the socket goes straight to the backend's own address (taken from the same
// rewrite in vercel.json). Locally, Vite proxies /socket.io to the API.

const backendOrigin = () => {
    if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
    if (typeof window === "undefined" || ["localhost", "127.0.0.1"].includes(window.location.hostname)) return undefined;
    const rewrite = (vercel.rewrites || []).find((rule) => rule.source === "/api/:path*");
    try {
        return rewrite ? new URL(rewrite.destination.replace("/api/:path*", "")).origin : undefined;
    } catch {
        return undefined;
    }
};

let socket = null;

/** The shared socket for the signed-in user (created on first use). */
export const connectChat = () => {
    if (socket) return socket;
    socket = io(backendOrigin(), {
        path: "/socket.io",
        transports: ["websocket", "polling"],
        // A fresh token on every (re)connect: access tokens are short-lived.
        auth: (callback) => callback({ token: getAccessToken() }),
        reconnectionDelay: 1000,
        reconnectionDelayMax: 8000
    });
    socket.on("connect_error", async (error) => {
        // Expired token: refresh it, and Socket.IO retries with the new one.
        if (error?.data?.code === "UNAUTHORIZED" || /Authentication/.test(error?.message || "")) {
            try {
                await refreshSession();
                socket?.connect();
            } catch {
                // Signed out: the app takes the user to the login page.
            }
        }
    });
    return socket;
};

export const disconnectChat = () => {
    socket?.disconnect();
    socket = null;
};

export const chatSocket = () => socket;
