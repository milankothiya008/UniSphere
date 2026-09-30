import { useEffect, useState } from "react";
import { notificationApi } from "../api/endpoints";

// One shared unread count for every badge (sidebar, bottom tabs, top bar): a single poll, however many badges.

const POLL_MS = 60_000;

let count = 0;
let timer = null;
const listeners = new Set();

const publish = (next) => {
    count = next;
    listeners.forEach((listener) => listener(count));
};

export const refreshUnread = () =>
    notificationApi
        .unreadCount()
        .then((response) => publish(response.data.count))
        .catch(() => {});

export const setUnread = (next) => publish(Math.max(0, next));

export const useUnreadCount = () => {
    const [value, setValue] = useState(count);

    useEffect(() => {
        listeners.add(setValue);
        if (listeners.size === 1) {
            refreshUnread();
            timer = setInterval(refreshUnread, POLL_MS);
        }
        return () => {
            listeners.delete(setValue);
            if (!listeners.size) {
                clearInterval(timer);
                timer = null;
            }
        };
    }, []);

    return value;
};
