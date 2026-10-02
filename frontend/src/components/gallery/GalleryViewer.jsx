import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, Heart, Trash2, X } from "lucide-react";
import { Avatar, Button } from "../ui";
import { timeAgo } from "../../lib/format";
import { DoubleTapLike, LikeCount, useLike } from "../social/Likes";

const SWIPE_PX = 50;

const roleLabel = (item) => (item.uploaderRole === "PARTICIPANT" ? "Participant" : "Club member");

// The photo or video itself. The thumbnail shows (blurred) until the full-size file has loaded.
const Media = ({ item }) => {
    const [loaded, setLoaded] = useState(false);

    if (item.kind === "VIDEO") {
        return (
            <video className="gv-media" src={item.url} poster={item.poster || item.thumb || undefined} controls autoPlay playsInline>
                Your browser can't play this video.
            </video>
        );
    }
    return (
        <>
            {!loaded && item.thumb && <img className="gv-placeholder" src={item.thumb} alt="" aria-hidden="true" />}
            <img
                className={`gv-media ${loaded ? "is-loaded" : ""}`}
                src={item.url}
                alt={`Photo by ${item.uploader.name}`}
                draggable={false}
                onLoad={() => setLoaded(true)}
            />
        </>
    );
};

/**
 * Full-screen viewer for gallery photos and videos: arrows, keyboard and swipe to move, a filmstrip to jump.
 * In review mode (president / vice-president) it shows Approve and Decline for the item on screen.
 */
export const GalleryViewer = ({ items, index, onIndex, onClose, title, review = false, busy = false, onApprove, onDecline, onDelete, onLiked }) => {
    const closeRef = useRef(null);
    const stripRef = useRef(null);
    const swipe = useRef(null);
    const item = items[index];
    // The heart for the photo on screen; the gallery list is told so counts are right when coming back to it.
    const like = useLike("media", item?._id, item?.likedByMe, item?.likeCount, (state) => item && onLiked?.(item, state));
    const hasPrev = index > 0;
    const hasNext = index < items.length - 1;

    const go = (step) => {
        const target = index + step;
        if (target >= 0 && target < items.length) {
            onIndex(target);
        }
    };
    const goRef = useRef(go);
    goRef.current = go;
    const closeFn = useRef(onClose);
    closeFn.current = onClose;

    useEffect(() => {
        const previous = document.activeElement;
        const onKey = (event) => {
            // Leave the keys alone while a dialog (e.g. "Delete this photo?") is open on top.
            if (document.querySelector(".modal-backdrop")) {
                return;
            }
            if (event.key === "Escape") {
                closeFn.current();
            } else if (event.key === "ArrowLeft") {
                goRef.current(-1);
            } else if (event.key === "ArrowRight") {
                goRef.current(1);
            }
        };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        closeRef.current?.focus();
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            previous?.focus?.();
        };
    }, []);

    // Warm the neighbours so moving through the gallery feels instant.
    useEffect(() => {
        [items[index - 1], items[index + 1]].forEach((neighbour) => {
            if (neighbour?.kind === "IMAGE") {
                new Image().src = neighbour.url;
            }
        });
        stripRef.current?.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
    }, [items, index]);

    if (!item) {
        return null;
    }

    const onPointerDown = (event) => {
        if (event.pointerType !== "mouse") {
            swipe.current = { x: event.clientX, y: event.clientY };
        }
    };
    const onPointerUp = (event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) {
            return;
        }
        const dx = event.clientX - start.x;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
            go(dx < 0 ? 1 : -1);
        }
    };

    return createPortal(
        <div className="gv" role="dialog" aria-modal="true" aria-label={`${title} — photos and videos`}>
            <div className="gv-top">
                <span className="gv-count">
                    {index + 1} / {items.length}
                </span>
                <div className="gv-by">
                    <Avatar name={item.uploader.name} src={item.uploader.avatar} size="sm" />
                    <span>
                        <strong>{item.uploader.name}</strong>
                        <small>
                            {roleLabel(item)} · {timeAgo(item.createdAt)}
                        </small>
                    </span>
                </div>
                <div className="gv-tools">
                    {!review && item.canDelete && onDelete && (
                        <button type="button" className="gv-icon" onClick={() => onDelete(item)} aria-label="Delete">
                            <Trash2 size={18} />
                        </button>
                    )}
                    {!review && (
                        <span className="gv-like">
                            <button
                                type="button"
                                className={`gv-icon like-btn ${like.liked ? "is-liked" : ""}`}
                                onClick={like.toggle}
                                aria-pressed={like.liked}
                                aria-label={like.liked ? "Unlike" : "Like"}
                            >
                                <Heart size={19} fill={like.liked ? "currentColor" : "none"} />
                            </button>
                            <LikeCount like={like} type="media" id={item._id} canSeeLikers={Boolean(item.canDelete)} />
                        </span>
                    )}
                    {!review && (
                        <a className="gv-icon" href={item.url} target="_blank" rel="noreferrer" aria-label="Open full size">
                            <Download size={18} />
                        </a>
                    )}
                    <button ref={closeRef} type="button" className="gv-icon" onClick={onClose} aria-label="Close">
                        <X size={20} />
                    </button>
                </div>
            </div>

            <div className="gv-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
                <button type="button" className="gv-nav is-prev" onClick={() => go(-1)} disabled={!hasPrev} aria-label="Previous">
                    <ChevronLeft size={26} />
                </button>
                <figure key={item._id} className="gv-frame">
                    {!review && item.kind !== "VIDEO" ? (
                        <DoubleTapLike like={like}>
                            <Media item={item} />
                        </DoubleTapLike>
                    ) : (
                        <Media item={item} />
                    )}
                </figure>
                <button type="button" className="gv-nav is-next" onClick={() => go(1)} disabled={!hasNext} aria-label="Next">
                    <ChevronRight size={26} />
                </button>
            </div>

            {review ? (
                <div className="gv-review">
                    <span className="gv-review-note">Waiting for your approval</span>
                    <div className="row">
                        <Button variant="secondary" onClick={() => onDecline(item)} disabled={busy}>
                            <X size={16} /> Decline
                        </Button>
                        <Button onClick={() => onApprove(item)} loading={busy}>
                            <Check size={16} /> Approve
                        </Button>
                    </div>
                </div>
            ) : (
                items.length > 1 && (
                    <div className="gv-strip" ref={stripRef}>
                        {items.map((entry, i) => (
                            <button
                                key={entry._id}
                                type="button"
                                className={`gv-thumb ${i === index ? "is-active" : ""}`}
                                onClick={() => onIndex(i)}
                                aria-label={`Show ${entry.kind === "VIDEO" ? "video" : "photo"} ${i + 1}`}
                                aria-current={i === index ? "true" : undefined}
                            >
                                {entry.thumb ? <img src={entry.thumb} alt="" loading="lazy" /> : <span className="gv-thumb-video" />}
                            </button>
                        ))}
                    </div>
                )
            )}
        </div>,
        document.body
    );
};
