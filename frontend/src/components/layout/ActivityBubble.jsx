import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, Heart, Megaphone, Users } from "lucide-react";
import { useUnreadSummary } from "../../hooks/useUnreadCount";

const SHOW_MS = 7000;
const STORAGE_KEY = "cc.activitySeen";

// How many unread notifications the bubble has already announced, kept for the browser tab's session
// so moving between pages doesn't announce the same ones again.
const readSeen = () => {
    try {
        return Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
        return 0;
    }
};
const saveSeen = (value) => {
    try {
        sessionStorage.setItem(STORAGE_KEY, String(value));
    } catch {
        // Private mode or blocked storage: the bubble may simply show again.
    }
};

const KINDS = [
    ["events", CalendarDays, "event updates"],
    ["clubs", Users, "club updates"],
    ["recruitment", Megaphone, "recruitment updates"]
];

// The Activity link that's on screen: the side bar's on wide screens, the bottom tab's on phones.
const findAnchor = () => {
    const anchors = [...document.querySelectorAll("[data-activity-anchor]")];
    return anchors.find((element) => element.getClientRects().length > 0) || anchors[0];
};

/**
 * Instagram's activity bubble: when new notifications arrive, a red bubble pops out of the Activity
 * heart with how many are about events, clubs and recruitment, then tucks away after a few seconds
 * (the red dot stays until Activity is opened).
 */
export const ActivityBubble = () => {
    const { count, kinds, loaded } = useUnreadSummary();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const seen = useRef(readSeen());
    const [visible, setVisible] = useState(false);
    const [place, setPlace] = useState(null);

    useEffect(() => {
        if (!loaded) return undefined;
        if (pathname === "/activity") {
            seen.current = 0;
            saveSeen(0);
            setVisible(false);
            return undefined;
        }
        if (count < seen.current) {
            seen.current = count;
            saveSeen(count);
        }
        if (count <= seen.current) return undefined;
        setVisible(true);
        const timer = setTimeout(() => {
            setVisible(false);
            seen.current = count;
            saveSeen(count);
        }, SHOW_MS);
        return () => clearTimeout(timer);
    }, [count, pathname, loaded]);

    useLayoutEffect(() => {
        if (!visible) return undefined;
        const update = () => {
            const anchor = findAnchor();
            if (!anchor) return setPlace(null);
            const rect = anchor.getBoundingClientRect();
            const icon = anchor.querySelector(".nav-icon")?.getBoundingClientRect() || rect;
            setPlace(anchor.closest(".tabbar") ? { mode: "up", left: icon.left + icon.width / 2, top: rect.top } : { mode: "side", left: rect.right, top: icon.top + icon.height / 2 });
        };
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, [visible]);

    if (!visible || !place) return null;

    const shown = KINDS.filter(([key]) => kinds[key] > 0);
    const label = shown.length ? shown.map(([key, , text]) => `${kinds[key]} ${text}`).join(", ") : `${count} new`;

    return createPortal(
        <button
            type="button"
            className={`activity-bubble is-${place.mode}`}
            style={{ left: place.left, top: place.top }}
            onClick={() => navigate("/activity")}
            aria-label={`New activity: ${label}. Open Activity`}
        >
            <span className="activity-bubble-body">
                {shown.length ? (
                    shown.map(([key, Icon]) => (
                        <span key={key} className="activity-bubble-kind">
                            <Icon size={16} strokeWidth={2.4} /> {kinds[key] > 99 ? "99+" : kinds[key]}
                        </span>
                    ))
                ) : (
                    <span className="activity-bubble-kind">
                        <Heart size={16} strokeWidth={2.4} /> {count}
                    </span>
                )}
            </span>
        </button>,
        document.body
    );
};
