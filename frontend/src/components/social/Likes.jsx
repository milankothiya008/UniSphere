import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Heart } from "lucide-react";
import { likeApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { useApi } from "../../hooks/useApi";
import { AsyncContent, Avatar, EmptyState, Modal } from "../ui";
import { batchLabel, shortAgo } from "../../lib/format";

const plural = (count) => `${count.toLocaleString("en-IN")} like${count === 1 ? "" : "s"}`;

/**
 * Like state for an event post or a gallery photo. Updates at once and settles on the server's count;
 * a failed request puts things back.
 */
export const useLike = (type, id, initialLiked = false, initialCount = 0, onChange) => {
    const toast = useToast();
    const [state, setState] = useState({ liked: Boolean(initialLiked), count: initialCount || 0 });
    const latest = useRef(0);

    useEffect(() => {
        setState({ liked: Boolean(initialLiked), count: initialCount || 0 });
    }, [id, initialLiked, initialCount]);

    const set = async (liked) => {
        if (liked === state.liked) return;
        const before = state;
        const request = ++latest.current;
        setState({ liked, count: Math.max(0, before.count + (liked ? 1 : -1)) });
        try {
            const response = await likeApi.set(type, id, liked);
            if (request === latest.current) {
                setState({ liked: response.data.liked, count: response.data.likeCount });
                onChange?.({ liked: response.data.liked, likeCount: response.data.likeCount });
            }
        } catch (error) {
            if (request === latest.current) setState(before);
            toast.error(error);
        }
    };

    return { ...state, toggle: () => set(!state.liked), like: () => set(true) };
};

/** The heart in a post's action row. */
export const LikeButton = ({ like, label = "post", size = 24 }) => (
    <button
        type="button"
        className={`tool-btn like-btn ${like.liked ? "is-liked" : ""}`}
        onClick={like.toggle}
        aria-pressed={like.liked}
        aria-label={like.liked ? `Unlike ${label}` : `Like ${label}`}
        title={like.liked ? "Unlike" : "Like"}
    >
        <Heart size={size} strokeWidth={1.8} fill={like.liked ? "currentColor" : "none"} />
    </button>
);

/** Instagram's double-tap: a big heart pops over the picture. Wrap the media in it. */
// When the picture is also a link, a single tap still opens it, just after a short pause to see whether a second
// tap follows. Keyboard activation and ctrl/middle clicks behave like a normal link.
export const DoubleTapLike = ({ like, children, className = "", to }) => {
    const navigate = useNavigate();
    const [burst, setBurst] = useState(0);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);

    const onClickCapture = (clickEvent) => {
        if (clickEvent.detail === 0 || clickEvent.button !== 0 || clickEvent.metaKey || clickEvent.ctrlKey || clickEvent.shiftKey || clickEvent.altKey) return;
        clickEvent.preventDefault();
        clearTimeout(timer.current);
        if (clickEvent.detail >= 2) {
            like.like();
            setBurst((value) => value + 1);
        } else if (to) {
            timer.current = setTimeout(() => navigate(to), 260);
        }
    };

    return (
        <div className={`double-tap ${className}`} onClickCapture={onClickCapture}>
            {children}
            {burst > 0 && (
                <span key={burst} className="like-burst" aria-hidden="true">
                    <Heart size={96} fill="currentColor" strokeWidth={0} />
                </span>
            )}
        </div>
    );
};

const LikersDialog = ({ open, onClose, type, id }) => {
    const { data, loading, error, reload } = useApi(() => likeApi.likers(type, id), [type, id], { enabled: open });
    const items = data?.items || [];
    return (
        <Modal open={open} onClose={onClose} title="Likes" size="sm">
            <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!items.length} empty={<EmptyState icon={Heart} title="No likes yet" />}>
                <ul className="likers">
                    {items.map((row) => (
                        <li key={row.user._id}>
                            <Link to={`/people/${row.user._id}`} onClick={onClose}>
                                <Avatar name={row.user.name} src={row.user.avatar} size="sm" />
                                <span>
                                    <strong>{row.user.name}</strong>
                                    <span className="subtle small">
                                        {[row.user.departmentCode, row.user.batchCode && `Batch ${batchLabel(row.user.batchCode)}`].filter(Boolean).join(" · ")}
                                    </span>
                                </span>
                            </Link>
                            <span className="subtle small">{shortAgo(row.at)}</span>
                        </li>
                    ))}
                </ul>
            </AsyncContent>
        </Modal>
    );
};

/** The number beside the heart; organisers can tap it to see who liked. */
export const LikeCount = ({ like, type, id, canSeeLikers = false }) => {
    const [open, setOpen] = useState(false);
    if (!like.count) return null;
    const text = like.count.toLocaleString("en-IN");
    if (!canSeeLikers) {
        return (
            <span className="like-count" aria-label={plural(like.count)} title={plural(like.count)}>
                {text}
            </span>
        );
    }
    return (
        <>
            <button type="button" className="like-count is-button" onClick={() => setOpen(true)} aria-label={`${plural(like.count)} — see who`} title="See who liked">
                {text}
            </button>
            <LikersDialog open={open} onClose={() => setOpen(false)} type={type} id={id} />
        </>
    );
};
