import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { plural } from "../../lib/format";

// The club's bell, like YouTube's: with it on you're emailed the club's new events and announcements.
export const NotifyBell = ({ club, className = "" }) => {
    const toast = useToast();
    const [subscribed, setSubscribed] = useState(Boolean(club.viewer?.subscribed));
    const [followers, setFollowers] = useState(club.followerCount ?? 0);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        setSubscribed(Boolean(club.viewer?.subscribed));
        setFollowers(club.followerCount ?? 0);
    }, [club]);

    // Inactive clubs can be muted but not followed.
    if (club.status !== "ACTIVE" && !subscribed) {
        return null;
    }

    const toggle = async () => {
        const next = !subscribed;
        setPending(true);
        setSubscribed(next);
        try {
            const { data } = await clubApi.setSubscription(club._id, next);
            setSubscribed(data.subscribed);
            setFollowers(data.followerCount);
            if (!next) {
                toast.info(`Notifications off for ${club.name}`);
            } else if (data.emailsEnabled) {
                toast.success(`You'll get emails about ${club.name}'s new events and announcements`);
            } else {
                toast.info(`Bell on for ${club.name}, but "Clubs you follow" emails are off in your email settings`);
            }
        } catch (error) {
            setSubscribed(!next);
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className={`notify-bell ${className}`}>
            <button
                type="button"
                className={`notify-bell-btn ${subscribed ? "on" : ""}`}
                aria-pressed={subscribed}
                onClick={toggle}
                disabled={pending}
                title={subscribed ? "Turn off notifications from this club" : "Get emails about new events and announcements"}
            >
                {subscribed ? <BellRing size={16} /> : <Bell size={16} />}
                {subscribed ? "Notifications on" : "Get notified"}
            </button>
            <span className="notify-bell-count">{plural(followers, "follower")}</span>
        </div>
    );
};
