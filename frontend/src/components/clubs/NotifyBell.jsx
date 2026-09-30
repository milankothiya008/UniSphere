import { useEffect, useState } from "react";
import { UserCheck, UserPlus } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { plural } from "../../lib/format";

/**
 * Follow a club to be emailed about its new events and announcements. The button says what it does:
 * "Follow" while you don't, "Unfollow" while you do.
 */
export const FollowButton = ({ club, className = "", showCount = true, onFollowersChange }) => {
    const toast = useToast();
    const [following, setFollowing] = useState(Boolean(club.viewer?.subscribed));
    const [followers, setFollowers] = useState(club.followerCount ?? 0);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        setFollowing(Boolean(club.viewer?.subscribed));
        setFollowers(club.followerCount ?? 0);
    }, [club]);

    useEffect(() => {
        onFollowersChange?.(followers);
    }, [followers, onFollowersChange]);

    // Inactive clubs can be unfollowed but not followed.
    if (club.status !== "ACTIVE" && !following) {
        return null;
    }

    const toggle = async () => {
        const next = !following;
        setPending(true);
        setFollowing(next);
        setFollowers((count) => Math.max(0, count + (next ? 1 : -1)));
        try {
            const { data } = await clubApi.setSubscription(club._id, next);
            setFollowing(data.subscribed);
            if (typeof data.followerCount === "number") setFollowers(data.followerCount);
            if (!next) {
                toast.info(`You unfollowed ${club.name}`);
            } else if (data.emailsEnabled) {
                toast.success(`You're following ${club.name} — you'll get emails about new events and announcements`);
            } else {
                toast.info(`You're following ${club.name}, but "Clubs you follow" emails are off in your email settings`);
            }
        } catch (error) {
            setFollowing(!next);
            setFollowers((count) => Math.max(0, count + (next ? -1 : 1)));
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className={`follow ${className}`}>
            <button
                type="button"
                className={`follow-btn ${following ? "is-following" : ""}`}
                aria-pressed={following}
                onClick={toggle}
                disabled={pending}
                title={following ? `Stop getting emails from ${club.name}` : `Get emails about ${club.name}'s new events and announcements`}
            >
                {following ? <UserCheck size={16} /> : <UserPlus size={16} />}
                {following ? "Unfollow" : "Follow"}
            </button>
            {showCount && <span className="follow-count">{plural(followers, "follower")}</span>}
        </div>
    );
};

// Older name, kept for existing imports.
export const NotifyBell = FollowButton;
