import { chatApi } from "../api/endpoints";
import { uploadWithTicket } from "./mediaUpload";
import { UNIVERSITY_TIMEZONE } from "./format";

// Chat helpers: times like Instagram ("2m", "Yesterday"), file sizes, what kind of file was picked, and
// uploading an attachment for one chat.

const tz = UNIVERSITY_TIMEZONE;
const dayKey = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const time = (value) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(value));

/** "Now", "5m", "3h", "Yesterday", "Mon", "12 Sept" — for the chat list. */
export const listTime = (value) => {
    if (!value) return "";
    const seconds = (Date.now() - new Date(value).getTime()) / 1000;
    if (seconds < 60) return "Now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (dayKey(value) === dayKey(Date.now())) return `${Math.floor(seconds / 3600)}h`;
    if (dayKey(value) === dayKey(Date.now() - 86400000)) return "Yesterday";
    if (seconds < 6 * 86400) return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "short" }).format(new Date(value));
    return new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(value));
};

/** Time shown on a bubble. */
export const bubbleTime = (value) => (value ? time(value) : "");

/** "Today", "Yesterday", "Monday", "12 September 2026" — separators between days. */
export const dayLabel = (value) => {
    const key = dayKey(value);
    if (key === dayKey(Date.now())) return "Today";
    if (key === dayKey(Date.now() - 86400000)) return "Yesterday";
    const age = (Date.now() - new Date(value).getTime()) / 86400000;
    if (age < 6) return new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long" }).format(new Date(value));
    return new Intl.DateTimeFormat("en-IN", { timeZone: tz, day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
};

export const sameDay = (a, b) => dayKey(a) === dayKey(b);

/** "Active now", "Active 5m ago" (Instagram style), or nothing when hidden. */
export const presenceText = (state) => {
    if (!state || state.hidden) return "";
    if (state.online) return "Active now";
    if (!state.lastSeenAt) return "";
    const minutes = Math.floor((Date.now() - new Date(state.lastSeenAt).getTime()) / 60000);
    if (minutes < 1) return "Active just now";
    if (minutes < 60) return `Active ${minutes}m ago`;
    if (minutes < 24 * 60) return `Active ${Math.floor(minutes / 60)}h ago`;
    const days = Math.floor(minutes / 1440);
    return days < 7 ? `Active ${days}d ago` : "";
};

export const fileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export const duration = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const DOC_EXTS = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "csv"];
export const ACCEPT_DOCUMENTS = DOC_EXTS.map((ext) => `.${ext}`).join(",");
export const ACCEPT_GALLERY = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm";

export const LIMITS = { IMAGE: 15, VIDEO: 50, AUDIO: 10, DOCUMENT: 25 }; // MB, as on the server

/** IMAGE / VIDEO / DOCUMENT for a picked file (and its extension), or an error. */
export const classify = (file) => {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    let kind = null;
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) kind = "IMAGE";
    else if (["video/mp4", "video/quicktime", "video/webm"].includes(file.type)) kind = "VIDEO";
    else if (DOC_EXTS.includes(ext)) kind = "DOCUMENT";
    if (!kind) return { error: `${file.name}: send photos (JPEG, PNG, WebP), videos (MP4, MOV, WebM) or documents (PDF, Word, PowerPoint, Excel, text)` };
    if (file.size > LIMITS[kind] * 1024 * 1024) return { error: `${file.name} is larger than ${LIMITS[kind]} MB` };
    return { kind, ext: kind === "DOCUMENT" ? ext : null };
};

/** Uploads one file for this chat and returns the reference to send with the message. */
export const uploadChatFile = async (conversationId, file, { kind, ext, details = {}, onProgress } = {}) => {
    const ticket = (await chatApi.uploadTicket(conversationId, kind, ext || undefined)).data;
    const query = new URLSearchParams({ conversation: conversationId, kind, ...(ext ? { ext } : {}) });
    const media = await uploadWithTicket(file, { ...ticket, kind }, { localPath: `/chat/media?${query}`, details, onProgress });
    return { ...media, kind, name: file.name };
};

export const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Tick state of one of my messages in a one-to-one chat: sent, delivered or seen. */
export const tickState = (message, receipts = []) => {
    if (!receipts.length) return "sent";
    const at = new Date(message.createdAt).getTime();
    if (receipts.every((receipt) => receipt.readAt && new Date(receipt.readAt).getTime() >= at)) return "seen";
    if (receipts.every((receipt) => (receipt.deliveredAt || receipt.readAt) && new Date(receipt.deliveredAt || receipt.readAt).getTime() >= at))
        return "delivered";
    return "sent";
};

/** Splits text into plain parts and clickable links. */
export const linkify = (text) => {
    const parts = [];
    const pattern = /\bhttps?:\/\/[^\s<>"']+/gi;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
        const url = match[0].replace(/[),.!?;:]+$/, "");
        if (match.index > last) parts.push({ text: text.slice(last, match.index) });
        parts.push({ url });
        last = match.index + url.length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts;
};

export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

export const EMOJI_SETS = [
    [
        "Smileys",
        "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤕 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬"
    ],
    ["Gestures", "👍 👎 👏 🙌 👐 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 🤌 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🫶 ✍️ 🤳 💅"],
    ["Hearts", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✨ ⭐ 🌟 💫 🔥 💯 ✅ ❌ ⚡ 🎉 🎊"],
    ["Campus", "📚 📖 📝 ✏️ 🖊️ 📌 📎 📅 🗓️ ⏰ 💻 🖥️ ⌨️ 🖱️ 📱 🎓 🏫 🧪 🔬 🧮 📊 📈 🏆 🥇 🥈 🥉 🎤 🎧 🎸 🎨 📸 🎬 ⚽ 🏏 🏀 🎯 🍕 🍔 ☕ 🍵 🚀"]
];

// Instagram's mute choices.
export const MUTE_OPTIONS = [
    ["15m", "For 15 minutes"],
    ["1h", "For 1 hour"],
    ["8h", "For 8 hours"],
    ["24h", "For 24 hours"],
    ["always", "Until I change it"]
];

/** "Muted until 5:30 pm", "Muted until Mon", "Muted". */
export const mutedLabel = (until) => {
    if (!until) return "";
    const date = new Date(until);
    if (date.getFullYear() - new Date().getFullYear() > 5) return "Muted";
    const sameDay = date.toDateString() === new Date().toDateString();
    return `Muted until ${new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...(sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" }) }).format(date)}`;
};
