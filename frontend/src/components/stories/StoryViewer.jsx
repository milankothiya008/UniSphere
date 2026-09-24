import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Eye, Heart, Pause, Play, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { useToast } from "../../context/ToastContext";
import { deleteStory, markStorySeen, setStoryLiked } from "../../hooks/useStories";
import { IMAGE_SECONDS, STORY_LIMITS, firstUnseenIndex, preloadStory } from "../../lib/stories";
import { formatDate } from "../../lib/format";
import { Avatar, ConfirmDialog } from "../ui";
import { StoryViewersSheet } from "./StoryViewersSheet";

const HOLD_MS = 200;
const SWIPE_PX = 60;

// "now", "12m", "3h" — the compact age shown next to the club name.
export const shortAgo = (value) => {
    const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) {
        return "now";
    }
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
};

const hoursLeft = (value) => Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 3600000));

// Sound preference for the rest of the visit.
let preferMuted = false;

/**
 * Full-screen story player. `groups` is the tray (one group per club); playback starts at `startClubId`
 * on its first unwatched story and continues through the following clubs, like Instagram.
 */
export const StoryViewer = ({ groups, startClubId, onClose }) => {
    const toast = useToast();
    // Keep the order fixed while watching, even if the tray refreshes and re-sorts in the background.
    const [order] = useState(() => groups.map((group) => String(group.club._id)));
    const byId = new Map(groups.map((group) => [String(group.club._id), group]));
    const live = order.map((id) => byId.get(id)).filter(Boolean);

    const [pos, setPos] = useState(() => {
        const start = live.find((group) => String(group.club._id) === String(startClubId)) || live[0];
        return { clubId: start ? String(start.club._id) : null, index: start ? firstUnseenIndex(start) : 0 };
    });
    const [direction, setDirection] = useState("none");
    const [restartKey, setRestartKey] = useState(0);
    const [readyId, setReadyId] = useState(null);
    const [failedId, setFailedId] = useState(null);
    const [buffering, setBuffering] = useState(false);
    const [held, setHeld] = useState(false);
    const [manualPause, setManualPause] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [muted, setMuted] = useState(preferMuted);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [likePop, setLikePop] = useState(0);

    const groupIndex = live.findIndex((group) => String(group.club._id) === pos.clubId);
    const group = live[groupIndex];
    const index = group ? Math.min(pos.index, group.stories.length - 1) : 0;
    const story = group?.stories[index];
    const storyId = story?._id;
    const ready = readyId === storyId || failedId === storyId;
    const paused = held || manualPause || hidden || sheetOpen || confirming;

    const videoRef = useRef(null);
    const barRef = useRef(null);
    const elapsed = useRef(0);
    const pausedRef = useRef(paused);
    const readyRef = useRef(ready);
    const bufferingRef = useRef(buffering);
    const closeRef = useRef(null);
    const pointer = useRef(null);
    pausedRef.current = paused;
    readyRef.current = ready;
    bufferingRef.current = buffering;

    const goTo = useCallback(
        (targetGroup, targetIndex, dir = "none") => {
            if (!targetGroup) {
                return;
            }
            setDirection(dir);
            setBuffering(false);
            setPos({ clubId: String(targetGroup.club._id), index: targetIndex });
        },
        []
    );

    const restart = useCallback(() => {
        elapsed.current = 0;
        if (videoRef.current) {
            videoRef.current.currentTime = 0;
        }
        setRestartKey((key) => key + 1);
    }, []);

    const next = useCallback(() => {
        if (!group) {
            return;
        }
        if (index < group.stories.length - 1) {
            goTo(group, index + 1);
        } else if (groupIndex < live.length - 1) {
            const following = live[groupIndex + 1];
            goTo(following, firstUnseenIndex(following), "next");
        } else {
            onClose();
        }
    }, [group, index, groupIndex, live, goTo, onClose]);

    const prev = useCallback(() => {
        if (!group) {
            return;
        }
        if (index > 0) {
            goTo(group, index - 1);
        } else if (groupIndex > 0) {
            goTo(live[groupIndex - 1], 0, "prev");
        } else {
            restart();
        }
    }, [group, index, groupIndex, live, goTo, restart]);

    const nextGroup = useCallback(() => {
        if (groupIndex < live.length - 1) {
            const following = live[groupIndex + 1];
            goTo(following, firstUnseenIndex(following), "next");
        } else {
            onClose();
        }
    }, [groupIndex, live, goTo, onClose]);

    const prevGroup = useCallback(() => (groupIndex > 0 ? goTo(live[groupIndex - 1], 0, "prev") : restart()), [groupIndex, live, goTo, restart]);

    const nextRef = useRef(next);
    nextRef.current = next;

    // The club's last story was deleted (or its stories expired) while watching.
    useEffect(() => {
        if (!group) {
            onClose();
        }
    }, [group, onClose]);

    // Progress: photos run on a timer, videos follow playback. Written straight to the DOM every frame.
    useEffect(() => {
        if (!story) {
            return undefined;
        }
        elapsed.current = 0;
        let frame;
        let last = performance.now();
        const total = IMAGE_SECONDS * 1000;
        const tick = (now) => {
            const delta = now - last;
            last = now;
            let progress = 0;
            if (story.kind === "VIDEO") {
                const video = videoRef.current;
                const length = Math.min(video?.duration || story.duration || STORY_LIMITS.maxVideoSeconds, STORY_LIMITS.maxVideoSeconds);
                progress = video && length ? video.currentTime / length : 0;
                if (failedId === story._id && !pausedRef.current) {
                    elapsed.current += delta;
                    progress = elapsed.current / total;
                }
            } else {
                if (!pausedRef.current && readyRef.current && !bufferingRef.current) {
                    elapsed.current += delta;
                }
                progress = elapsed.current / total;
            }
            barRef.current?.style.setProperty("--progress", String(Math.min(1, progress)));
            if (progress >= 1) {
                nextRef.current();
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storyId, restartKey, failedId]);

    // Play or pause the video with the viewer; fall back to muted playback if the browser blocks sound.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || story?.kind !== "VIDEO") {
            return;
        }
        if (paused || !ready) {
            video.pause();
            return;
        }
        const attempt = video.play();
        attempt?.catch?.((error) => {
            if (error?.name === "NotAllowedError" && !video.muted) {
                setMuted(true);
            }
        });
    }, [paused, ready, muted, storyId, story?.kind]);

    useEffect(() => {
        if (ready && storyId) {
            markStorySeen(storyId);
        }
    }, [ready, storyId]);

    // Warm up what comes next so it opens without a spinner.
    useEffect(() => {
        if (!group) {
            return;
        }
        preloadStory(group.stories[index + 1]);
        const following = live[groupIndex + 1];
        if (following) {
            preloadStory(following.stories[firstUnseenIndex(following)]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storyId]);

    useEffect(() => {
        const onVisibility = () => setHidden(document.visibilityState === "hidden");
        document.addEventListener("visibilitychange", onVisibility);
        const previous = document.activeElement;
        document.body.style.overflow = "hidden";
        closeRef.current?.focus();
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            document.body.style.overflow = "";
            previous?.focus?.();
        };
    }, []);

    useEffect(() => {
        const onKey = (event) => {
            if (sheetOpen || confirming) {
                if (event.key === "Escape" && sheetOpen) {
                    setSheetOpen(false);
                }
                return;
            }
            const actions = {
                ArrowRight: next,
                ArrowLeft: prev,
                ArrowDown: nextGroup,
                ArrowUp: prevGroup,
                Escape: onClose,
                " ": () => setManualPause((value) => !value),
                m: () => toggleMute()
            };
            const action = actions[event.key];
            if (action) {
                event.preventDefault();
                action();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    const toggleMute = () => {
        setMuted((value) => {
            preferMuted = !value;
            return !value;
        });
    };

    // Tap left/right to move, press and hold to pause, swipe sideways between clubs, swipe down to close.
    const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        const timer = setTimeout(() => setHeld(true), HOLD_MS);
        pointer.current = { x: event.clientX, y: event.clientY, timer, held: false };
    };

    const endPointer = (event, cancelled = false) => {
        const start = pointer.current;
        pointer.current = null;
        if (!start) {
            return;
        }
        clearTimeout(start.timer);
        const wasHeld = held;
        setHeld(false);
        if (cancelled || wasHeld) {
            return;
        }
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (dy > SWIPE_PX * 1.5 && Math.abs(dy) > Math.abs(dx)) {
            onClose();
        } else if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) {
                nextGroup();
            } else {
                prevGroup();
            }
        } else {
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX - box.left < box.width * 0.3) {
                prev();
            } else {
                next();
            }
        }
    };

    const toggleLike = async () => {
        const liked = !story.liked;
        if (liked) {
            setLikePop((n) => n + 1);
        }
        try {
            await setStoryLiked(story._id, liked);
        } catch (error) {
            toast.error(error);
        }
    };

    const remove = async () => {
        await deleteStory(story._id);
        toast.success("Story deleted");
    };

    if (!group || !story) {
        return null;
    }

    const backdrop = story.kind === "VIDEO" ? story.poster : story.url;

    return createPortal(
        <div className="sv-overlay" role="dialog" aria-modal="true" aria-label={`${group.club.name} stories`}>
            {backdrop && <div className="sv-backdrop" style={{ backgroundImage: `url("${backdrop}")` }} aria-hidden="true" />}

            <button type="button" className="sv-side sv-side-prev" onClick={prevGroup} aria-label="Previous club" disabled={groupIndex === 0 && index === 0}>
                <ChevronLeft size={22} />
            </button>

            <div key={group.club._id} className={`sv-frame sv-enter-${direction}`}>
                <div className="sv-media" style={{ "--sv-bg": backdrop ? `url("${backdrop}")` : "none" }}>
                    {story.kind === "VIDEO" ? (
                        <video
                            key={story._id}
                            ref={videoRef}
                            className="sv-video"
                            src={story.url}
                            poster={story.poster || undefined}
                            playsInline
                            muted={muted}
                            preload="auto"
                            onCanPlay={() => setReadyId(story._id)}
                            onWaiting={() => setBuffering(true)}
                            onPlaying={() => setBuffering(false)}
                            onEnded={next}
                            onError={() => setFailedId(story._id)}
                        />
                    ) : (
                        <img
                            key={story._id}
                            className="sv-image"
                            src={story.url}
                            alt={story.caption || `Story from ${group.club.name}`}
                            ref={(node) => node?.complete && node.naturalWidth && readyId !== story._id && setReadyId(story._id)}
                            onLoad={() => setReadyId(story._id)}
                            onError={() => setFailedId(story._id)}
                            draggable={false}
                        />
                    )}
                    {failedId === story._id && <div className="sv-failed">This story couldn't be loaded</div>}
                    {(!ready || buffering) && failedId !== story._id && <span className="sv-spinner" aria-label="Loading story" />}
                </div>

                <div className="sv-shade-top" aria-hidden="true" />
                <div className="sv-shade-bottom" aria-hidden="true" />

                <div
                    className="sv-tap"
                    onPointerDown={onPointerDown}
                    onPointerUp={(event) => endPointer(event)}
                    onPointerCancel={(event) => endPointer(event, true)}
                    onContextMenu={(event) => event.preventDefault()}
                    aria-hidden="true"
                />

                <header className={`sv-head ${held ? "is-hidden" : ""}`}>
                    <div className="sv-bars">
                        {group.stories.map((item, i) => (
                            <span key={item._id} className="sv-bar">
                                <i ref={i === index ? barRef : null} style={{ "--progress": i < index ? 1 : 0 }} />
                            </span>
                        ))}
                    </div>
                    <div className="sv-meta">
                        <Link to={`/clubs/${group.club._id}`} className="sv-club" onClick={onClose}>
                            <Avatar name={group.club.name} src={group.club.logo} size="sm" />
                            <strong>{group.club.name}</strong>
                            <span>{shortAgo(story.createdAt)}</span>
                        </Link>
                        <div className="sv-actions">
                            {story.kind === "VIDEO" && (
                                <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                                    {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
                                </button>
                            )}
                            <button type="button" onClick={() => setManualPause((value) => !value)} aria-label={manualPause ? "Play" : "Pause"}>
                                {manualPause ? <Play size={19} /> : <Pause size={19} />}
                            </button>
                            {group.canManage && (
                                <button type="button" onClick={() => setConfirming(true)} aria-label="Delete story">
                                    <Trash2 size={18} />
                                </button>
                            )}
                            <button type="button" ref={closeRef} onClick={onClose} aria-label="Close stories">
                                <X size={21} />
                            </button>
                        </div>
                    </div>
                </header>

                <footer className={`sv-foot ${held ? "is-hidden" : ""}`}>
                    {story.caption && <p className="sv-caption">{story.caption}</p>}
                    {story.event && (
                        <Link to={`/events/${story.event._id}`} className="sv-event" onClick={onClose}>
                            <CalendarDays size={16} />
                            <span>
                                <strong>{story.event.title}</strong>
                                <small>{formatDate(story.event.startAt)}</small>
                            </span>
                            <em>View event</em>
                        </Link>
                    )}
                    <div className="sv-foot-row">
                        {group.canManage ? (
                            <>
                                <button type="button" className="sv-pill" onClick={() => setSheetOpen(true)}>
                                    <Eye size={16} /> {story.viewCount ?? 0} {story.viewCount === 1 ? "viewer" : "viewers"}
                                    {story.likeCount ? (
                                        <span className="sv-pill-likes">
                                            <Heart size={13} /> {story.likeCount}
                                        </span>
                                    ) : null}
                                </button>
                                <span className="sv-expiry">Disappears in {hoursLeft(story.expiresAt)}h</span>
                            </>
                        ) : (
                            <button type="button" className={`sv-like ${story.liked ? "is-liked" : ""}`} onClick={toggleLike} aria-pressed={story.liked} aria-label={story.liked ? "Unlike story" : "Like story"}>
                                <Heart size={24} />
                                {likePop > 0 && <span key={likePop} className="sv-like-pop" aria-hidden="true" />}
                            </button>
                        )}
                    </div>
                </footer>

                {sheetOpen && <StoryViewersSheet story={story} onClose={() => setSheetOpen(false)} />}
            </div>

            <button type="button" className="sv-side sv-side-next" onClick={nextGroup} aria-label="Next club">
                <ChevronRight size={22} />
            </button>

            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={remove}
                title="Delete this story?"
                description="It will be removed for everyone right away, along with its view list."
                confirmLabel="Delete story"
                variant="danger"
            />
        </div>,
        document.body
    );
};
