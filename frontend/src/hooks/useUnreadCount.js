import { useEffect, useState } from "react";
import { notificationApi } from "../api/endpoints";

// One shared unread summary for every badge (sidebar, bottom tabs, the Activity bubble): a single poll,
// however many badges. It also refreshes whenever the tab comes back into view, so new activity shows
// up as soon as the student looks — like Instagram's heart.

const POLL_MS = 30_000;
const EMPTY = { count: 0, kinds: { events: 0, clubs: 0, recruitment: 0 }, loaded: false };

let summary = EMPTY;
let timer = null;
const listeners = new Set();

const publish = (next) => {
    summary = next;
    listeners.forEach((listener) => listener(summary));
};

export const refreshUnread = () =>
    notificationApi
        .unreadCount()
        .then((response) => publish({ count: response.data.count || 0, kinds: { ...EMPTY.kinds, ...response.data.kinds }, loaded: true }))
        .catch(() => {});

/** Sets the count locally (after marking notifications read), without waiting for the next poll. */
export const setUnread = (next) => publish(next > 0 ? { ...summary, count: next } : { ...EMPTY, loaded: true });

const onVisible = () => {
    if (document.visibilityState === "visible") refreshUnread();
};

export const useUnreadSummary = () => {
    const [value, setValue] = useState(summary);

    useEffect(() => {
        listeners.add(setValue);
        if (listeners.size === 1) {
            refreshUnread();
            timer = setInterval(() => document.visibilityState === "visible" && refreshUnread(), POLL_MS);
            document.addEventListener("visibilitychange", onVisible);
        }
        return () => {
            listeners.delete(setValue);
            if (!listeners.size) {
                // Signed out (or another account next): start from nothing.
                summary = EMPTY;
                clearInterval(timer);
                timer = null;
                document.removeEventListener("visibilitychange", onVisible);
            }
        };
    }, []);

    return value;
};

export const useUnreadCount = () => useUnreadSummary().count;
