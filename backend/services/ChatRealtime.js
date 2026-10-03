const { Server } = require("socket.io");
const User = require("../models/User");
const { verifyAccessToken } = require("../utils/Token");
const logger = require("../utils/Logger");

// Live chat over WebSockets (Socket.IO). Each signed-in tab joins a room for its user ("user:<id>"), and
// everything is delivered by user, so who receives a message is decided by the server on every send
// (club membership included) rather than by rooms that could go stale.
//
// Presence ("Active now") is kept in memory for this server; lastSeenAt is saved when someone's last tab
// closes. People can hide it (Settings), and then they don't see others' either — as on Instagram.

let io = null;
const online = new Map(); // userId -> open sockets
const viewing = new Map(); // socketId -> { userId, conversationId } for tabs showing a chat on screen
const handlers = {}; // set by ChatService: typing, delivered, access checks

const userRoom = (id) => `user:${id}`;
const presenceRoom = (id) => `presence:${id}`;

const isOnline = (userId) => (online.get(String(userId)) || 0) > 0;

/** People who have this chat open on screen right now (they don't need a notification for it). */
const viewersOf = (conversationId) => {
    const ids = new Set();
    viewing.forEach((entry) => entry.conversationId === String(conversationId) && ids.add(entry.userId));
    return ids;
};

/** Sends an event to every open tab of these users (no-op when sockets aren't running, e.g. tests). */
const emitToUsers = (userIds, event, payload) => {
    if (!io) return;
    const rooms = [...new Set(userIds.map(String))].map(userRoom);
    if (rooms.length) io.to(rooms).emit(event, payload);
};

const presencePayload = (user, isNowOnline) =>
    user.showActivityStatus === false ? { userId: String(user._id), hidden: true } : { userId: String(user._id), online: isNowOnline, lastSeenAt: isNowOnline ? null : user.lastSeenAt || null };

const authenticate = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) throw new Error("No token");
        const decoded = verifyAccessToken(token);
        const user = await User.findById(decoded.sub).select("name avatar isActive isEmailVerified showActivityStatus lastSeenAt").lean();
        if (!user || !user.isActive || !user.isEmailVerified) throw new Error("Not allowed");
        socket.data.user = user;
        next();
    } catch {
        const error = new Error("Authentication required");
        error.data = { code: "UNAUTHORIZED" };
        next(error);
    }
};

const onConnection = (socket) => {
    const user = socket.data.user;
    const id = String(user._id);
    socket.join(userRoom(id));
    const count = (online.get(id) || 0) + 1;
    online.set(id, count);
    if (count === 1 && io) io.to(presenceRoom(id)).emit("presence", presencePayload(user, true));

    // Watch who's online among these people (the chats on screen). Answers with their current state.
    socket.on("presence:watch", async (ids, reply) => {
        try {
            const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 200);
            for (const room of socket.rooms) if (room.startsWith("presence:")) socket.leave(room);
            wanted.forEach((other) => socket.join(presenceRoom(other)));
            if (typeof reply !== "function") return;
            const viewer = await User.findById(id).select("showActivityStatus").lean();
            if (viewer?.showActivityStatus === false) return reply([]);
            const people = await User.find({ _id: { $in: wanted } }).select("showActivityStatus lastSeenAt").lean();
            reply(people.map((person) => presencePayload(person, isOnline(person._id))));
        } catch {
            if (typeof reply === "function") reply([]);
        }
    });

    // The tab says which chat it shows while it's visible (null when hidden or on another page).
    socket.on("viewing", (payload) => {
        const conversationId = payload?.conversationId ? String(payload.conversationId).slice(0, 40) : null;
        if (conversationId && payload.visible !== false) viewing.set(socket.id, { userId: id, conversationId });
        else viewing.delete(socket.id);
    });
    socket.on("typing", (payload) => handlers.typing?.(user, payload).catch(() => {}));
    socket.on("delivered", (payload) => handlers.delivered?.(user, payload).catch(() => {}));

    socket.on("disconnect", async () => {
        viewing.delete(socket.id);
        const left = (online.get(id) || 1) - 1;
        if (left > 0) {
            online.set(id, left);
            return;
        }
        online.delete(id);
        const lastSeenAt = new Date();
        try {
            const saved = await User.findByIdAndUpdate(id, { $set: { lastSeenAt } }, { new: true }).select("showActivityStatus lastSeenAt").lean();
            if (io && saved) io.to(presenceRoom(id)).emit("presence", presencePayload(saved, false));
        } catch (error) {
            logger.warn("Could not save last seen", { message: error.message });
        }
    });
};

/** Starts Socket.IO on the HTTP server (same origin rules as the REST API). */
const init = (server, { origin }) => {
    io = new Server(server, {
        path: "/socket.io",
        cors: { origin, credentials: true },
        maxHttpBufferSize: 64 * 1024,
        pingInterval: 25000,
        pingTimeout: 20000
    });
    io.use(authenticate);
    io.on("connection", onConnection);
    return io;
};

const registerHandlers = (next) => Object.assign(handlers, next);

module.exports = { init, emitToUsers, isOnline, viewersOf, presencePayload, registerHandlers };
