import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Avatar } from "../ui";

/**
 * Instagram-style banners for new messages while you're elsewhere in the app: who wrote, what they said,
 * tap to open the chat. They slide away after a few seconds.
 */
export const MessageBanners = ({ banners, onDismiss }) => {
    const navigate = useNavigate();

    useEffect(() => {
        if (!banners.length) return undefined;
        const timers = banners.map((banner) => setTimeout(() => onDismiss(banner.key), Math.max(0, banner.until - Date.now())));
        return () => timers.forEach(clearTimeout);
    }, [banners, onDismiss]);

    if (!banners.length) return null;
    return (
        <div className="msg-banners" role="status" aria-live="polite">
            {banners.map((banner) => (
                <div key={banner.key} className="msg-banner">
                    <button
                        type="button"
                        className="msg-banner-open"
                        onClick={() => {
                            onDismiss(banner.key);
                            navigate(`/messages/${banner.conversationId}`);
                        }}
                    >
                        <Avatar name={banner.sender} src={banner.avatar} />
                        <span className="msg-banner-text">
                            <strong>{banner.title}</strong>
                            <span>{banner.body}</span>
                        </span>
                        <small>now</small>
                    </button>
                    <button type="button" className="msg-banner-close" onClick={() => onDismiss(banner.key)} aria-label="Dismiss">
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>
    );
};

/** A soft two-note chime for a new message (no sound file needed). */
let audio = null;
export const playMessageSound = () => {
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === "suspended") audio.resume();
        const now = audio.currentTime;
        [
            [880, 0],
            [1320, 0.09]
        ].forEach(([frequency, offset]) => {
            const tone = audio.createOscillator();
            const gain = audio.createGain();
            tone.type = "sine";
            tone.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
            tone.connect(gain).connect(audio.destination);
            tone.start(now + offset);
            tone.stop(now + offset + 0.18);
        });
    } catch {
        // No audio (old browser, or not allowed before the first tap): the banner is enough.
    }
};
