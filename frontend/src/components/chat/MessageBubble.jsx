import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, CheckCheck, Copy, Download, FileText, Flag, Forward, Pause, Pencil, Pin, PinOff, Play, Reply, Smile, Trash2, Undo2 } from "lucide-react";
import { ActionMenu, Avatar, useLightbox } from "../ui";
import { QUICK_REACTIONS, bubbleTime, duration, fileSize, linkify, tickState } from "../../lib/chat";
import { ChatElectionCard } from "../elections/ChatElectionCard";

const EDIT_MINUTES = 15;

// ---------------------------------------------------------------- Pieces

const Text = ({ text }) => (
    <p className="bubble-text">
        {linkify(text).map((part, index) =>
            part.url ? (
                <a key={index} href={part.url} target="_blank" rel="noreferrer noopener">
                    {part.url}
                </a>
            ) : (
                <span key={index}>{part.text}</span>
            )
        )}
    </p>
);

const MediaGrid = ({ attachments, onOpen }) => {
    const shown = attachments.slice(0, 4);
    const extra = attachments.length - shown.length;
    return (
        <div className={`bubble-media count-${Math.min(attachments.length, 4)}`}>
            {shown.map((item, index) => (
                <button
                    key={index}
                    type="button"
                    className="bubble-media-item"
                    onClick={() => onOpen(index)}
                    aria-label={item.kind === "VIDEO" ? "Play video" : "View photo"}
                >
                    <img
                        src={item.kind === "VIDEO" ? item.poster || item.thumb : attachments.length > 1 ? item.thumb || item.url : item.url}
                        alt=""
                        loading="lazy"
                        style={attachments.length === 1 && item.width && item.height ? { aspectRatio: `${item.width} / ${item.height}` } : undefined}
                    />
                    {item.kind === "VIDEO" && (
                        <span className="bubble-play">
                            <Play size={22} fill="currentColor" />
                            {item.duration ? <small>{duration(item.duration)}</small> : null}
                        </span>
                    )}
                    {index === shown.length - 1 && extra > 0 && <span className="bubble-more">+{extra}</span>}
                </button>
            ))}
        </div>
    );
};

/** Voice note: play/pause, a progress bar you can tap to seek, and the length. */
export const VoicePlayer = ({ src, seconds }) => {
    const audio = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [length, setLength] = useState(seconds || 0);

    useEffect(() => {
        const element = audio.current;
        if (!element) return undefined;
        const onTime = () => setProgress(element.duration ? element.currentTime / element.duration : 0);
        const onMeta = () => Number.isFinite(element.duration) && setLength(element.duration);
        const onEnd = () => {
            setPlaying(false);
            setProgress(0);
        };
        element.addEventListener("timeupdate", onTime);
        element.addEventListener("loadedmetadata", onMeta);
        element.addEventListener("ended", onEnd);
        return () => {
            element.removeEventListener("timeupdate", onTime);
            element.removeEventListener("loadedmetadata", onMeta);
            element.removeEventListener("ended", onEnd);
        };
    }, []);

    const toggle = () => {
        const element = audio.current;
        if (!element) return;
        if (playing) {
            element.pause();
            setPlaying(false);
        } else {
            // Only one voice note plays at a time.
            document.querySelectorAll("audio.voice-audio").forEach((other) => other !== element && other.pause());
            element
                .play()
                .then(() => setPlaying(true))
                .catch(() => setPlaying(false));
        }
    };
    const seek = (event) => {
        const element = audio.current;
        const box = event.currentTarget.getBoundingClientRect();
        if (element?.duration) element.currentTime = ((event.clientX - box.left) / box.width) * element.duration;
    };

    return (
        <div className="voice">
            <audio ref={audio} className="voice-audio" src={src} preload="metadata" onPause={() => setPlaying(false)} />
            <button type="button" className="voice-play" onClick={toggle} aria-label={playing ? "Pause voice message" : "Play voice message"}>
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <span className="voice-track" onClick={seek} role="presentation">
                <span className="voice-wave" aria-hidden="true">
                    {Array.from({ length: 28 }, (_, index) => (
                        <i key={index} style={{ height: `${30 + ((index * 37) % 70)}%` }} className={index / 28 < progress ? "is-played" : ""} />
                    ))}
                </span>
            </span>
            <span className="voice-time">{duration(playing || progress ? length * progress : length)}</span>
        </div>
    );
};

const DocCard = ({ file }) => (
    <a className="doc-card" href={file.url} target="_blank" rel="noreferrer noopener" download={file.name || true}>
        <span className={`doc-icon is-${file.format}`}>
            <FileText size={22} />
            <small>{String(file.format || "file").toUpperCase()}</small>
        </span>
        <span className="doc-body">
            <strong>{file.name || "Document"}</strong>
            <span>{[String(file.format || "").toUpperCase(), fileSize(file.bytes)].filter(Boolean).join(" · ")}</span>
        </span>
        <Download size={18} className="doc-download" />
    </a>
);

const LinkCard = ({ link }) => (
    <a className="link-card" href={link.url} target="_blank" rel="noreferrer noopener">
        {link.image && (
            <img src={link.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => (event.currentTarget.style.display = "none")} />
        )}
        <span className="link-card-body">
            <small>{link.site}</small>
            <strong>{link.title}</strong>
            {link.description && <span>{link.description}</span>}
        </span>
    </a>
);

const Ticks = ({ state }) =>
    state === "seen" ? (
        <CheckCheck size={15} className="tick is-seen" aria-label="Seen" />
    ) : state === "delivered" ? (
        <CheckCheck size={15} className="tick" aria-label="Delivered" />
    ) : state === "pending" ? (
        <span className="tick-clock" aria-label="Sending" />
    ) : (
        <Check size={15} className="tick" aria-label="Sent" />
    );

// ---------------------------------------------------------------- The bubble

/**
 * One message. Hover (desktop) or long-press (phone) shows reactions and actions; double-tap likes with ❤️
 * like Instagram; swiping right on a phone replies.
 */
export const MessageBubble = memo(function MessageBubble({ message, first, last, conversation, showSender, highlighted, actions }) {
    const lightbox = useLightbox();
    const [picker, setPicker] = useState(false);
    const [swipe, setSwipe] = useState(0);
    const touch = useRef(null);
    const press = useRef(null);

    if (message.type === "SYSTEM") {
        return (
            <div className="msg-system" id={`m-${message._id}`}>
                <span>{message.text}</span>
            </div>
        );
    }

    if (message.type === "POLL" && !message.deleted) {
        return <ChatElectionCard message={message} />;
    }

    const mine = message.mine;
    const media = message.attachments.filter((item) => ["IMAGE", "VIDEO"].includes(item.kind));
    const docs = message.attachments.filter((item) => item.kind === "DOCUMENT");
    const voice = message.attachments.find((item) => item.kind === "AUDIO");
    const editable = mine && !message.deleted && message.text && Date.now() - new Date(message.createdAt).getTime() < EDIT_MINUTES * 60000;
    const pinned = conversation.pinnedIds?.has(String(message._id));
    const onlyMedia = media.length && !message.text && !message.replyTo && !docs.length;
    const ticks = mine && conversation.type !== "CLUB" ? (message.pending ? "pending" : tickState(message, conversation.receipts)) : null;

    const openMedia = (index) => {
        const item = media[index];
        lightbox({ src: item.url, type: item.kind === "VIDEO" ? "video" : "image", poster: item.poster, alt: "Photo", caption: message.text || "" });
    };

    const menu = message.deleted
        ? [{ label: "Delete for me", icon: Trash2, onClick: () => actions.delete(message, "me") }]
        : [
              { label: "Reply", icon: Reply, onClick: () => actions.reply(message) },
              message.text && { label: "Copy text", icon: Copy, onClick: () => actions.copy(message) },
              editable && { label: "Edit", icon: Pencil, onClick: () => actions.edit(message) },
              { label: "Forward", icon: Forward, onClick: () => actions.forward(message) },
              conversation.canPin && { label: pinned ? "Unpin" : "Pin", icon: pinned ? PinOff : Pin, onClick: () => actions.pin(message, !pinned) },
              "divider",
              { label: "Delete for me", icon: Trash2, onClick: () => actions.delete(message, "me") },
              (mine || conversation.isAdmin) && {
                  label: mine ? "Unsend" : "Delete for everyone",
                  icon: Undo2,
                  danger: true,
                  onClick: () => actions.delete(message, "everyone")
              },
              !mine && { label: "Report", icon: Flag, danger: true, onClick: () => actions.report(message) }
          ].filter(Boolean);

    const onTouchStart = (event) => {
        touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
        press.current = setTimeout(() => setPicker(true), 450);
    };
    const onTouchMove = (event) => {
        const start = touch.current;
        if (!start) return;
        const dx = event.touches[0].clientX - start.x;
        if (Math.abs(event.touches[0].clientY - start.y) > 12 || Math.abs(dx) > 8) clearTimeout(press.current);
        if (dx > 0 && Math.abs(event.touches[0].clientY - start.y) < 30 && !message.deleted) setSwipe(Math.min(dx, 80));
    };
    const onTouchEnd = () => {
        clearTimeout(press.current);
        if (swipe > 60) actions.reply(message);
        setSwipe(0);
        touch.current = null;
    };

    const reactionByMe = message.reactions.find((reaction) => reaction.mine)?.emoji;
    const react = (emoji) => {
        setPicker(false);
        actions.react(message, reactionByMe === emoji ? null : emoji);
    };

    return (
        <div
            id={`m-${message._id}`}
            className={`msg ${mine ? "is-mine" : "is-theirs"} ${first ? "is-first" : ""} ${last ? "is-last" : ""} ${highlighted ? "is-highlighted" : ""}`}
            onMouseLeave={() => setPicker(false)}
        >
            {!mine && conversation.type !== "DIRECT" && (
                <span className="msg-avatar">
                    {last && message.sender ? (
                        <Link to={`/people/${message.sender._id}`} tabIndex={-1}>
                            <Avatar name={message.sender.name} src={message.sender.avatar} size="sm" />
                        </Link>
                    ) : null}
                </span>
            )}
            <div className="msg-col">
                {showSender && first && !mine && message.sender && <span className="msg-sender">{message.sender.name}</span>}
                {message.forwarded && !message.deleted && (
                    <span className="msg-forwarded">
                        <Forward size={12} /> Forwarded
                    </span>
                )}
                <div className="msg-line" style={swipe ? { transform: `translateX(${swipe}px)` } : undefined}>
                    {swipe > 20 && <Reply size={18} className="msg-swipe-hint" style={{ opacity: swipe / 60 }} />}
                    <div
                        className={`bubble ${message.deleted ? "is-deleted" : ""} ${onlyMedia ? "is-media" : ""} ${voice ? "is-voice" : ""}`}
                        onDoubleClick={() => !message.deleted && react("❤️")}
                        onTouchStart={onTouchStart}
                        onTouchMove={onTouchMove}
                        onTouchEnd={onTouchEnd}
                        onContextMenu={(event) => {
                            if (window.matchMedia?.("(pointer: coarse)").matches) event.preventDefault();
                        }}
                    >
                        {message.deleted ? (
                            <p className="bubble-text">
                                <em>{mine ? "You unsent a message" : "This message was unsent"}</em>
                            </p>
                        ) : (
                            <>
                                {message.replyTo && (
                                    <button type="button" className="bubble-quote" onClick={() => actions.jump(message.replyTo._id)}>
                                        {message.replyTo.thumb && <img src={message.replyTo.thumb} alt="" />}
                                        <span>
                                            <strong>
                                                {message.replyTo.sender?._id === conversation.meId ? "You" : message.replyTo.sender?.name || "Message"}
                                            </strong>
                                            <span>{message.replyTo.text}</span>
                                        </span>
                                    </button>
                                )}
                                {media.length > 0 && <MediaGrid attachments={media} onOpen={openMedia} />}
                                {voice && <VoicePlayer src={voice.url} seconds={voice.duration} />}
                                {docs.map((file, index) => (
                                    <DocCard key={index} file={file} />
                                ))}
                                {message.text && <Text text={message.text} />}
                                {message.link && <LinkCard link={message.link} />}
                            </>
                        )}
                        <span className="bubble-meta">
                            {message.editedAt && !message.deleted && <span>Edited</span>}
                            {pinned && <Pin size={11} aria-label="Pinned" />}
                            <time dateTime={message.createdAt}>{bubbleTime(message.createdAt)}</time>
                            {ticks && <Ticks state={ticks} />}
                        </span>
                    </div>
                    {!message.deleted && (
                        <div className="msg-tools">
                            <button type="button" className="msg-tool" onClick={() => setPicker((value) => !value)} aria-label="React">
                                <Smile size={17} />
                            </button>
                            <button type="button" className="msg-tool" onClick={() => actions.reply(message)} aria-label="Reply">
                                <Reply size={17} />
                            </button>
                            <ActionMenu items={menu} label="Message actions" align={mine ? "right" : "left"} />
                        </div>
                    )}
                    {picker && (
                        <div className="reaction-picker" role="menu" aria-label="React">
                            {QUICK_REACTIONS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    role="menuitem"
                                    className={reactionByMe === emoji ? "is-on" : ""}
                                    onClick={() => react(emoji)}
                                    aria-label={`React ${emoji}`}
                                >
                                    {emoji}
                                </button>
                            ))}
                            <span className="reaction-picker-more">
                                <ActionMenu items={menu} label="More actions" align={mine ? "right" : "left"} />
                            </span>
                        </div>
                    )}
                </div>
                {message.reactions.length > 0 && (
                    <button type="button" className="msg-reactions" onClick={() => actions.showReactions(message)} aria-label="See reactions">
                        {message.reactions.slice(0, 3).map((reaction) => (
                            <span key={reaction.emoji}>{reaction.emoji}</span>
                        ))}
                        {message.reactions.reduce((sum, reaction) => sum + reaction.count, 0) > 1 && (
                            <small>{message.reactions.reduce((sum, reaction) => sum + reaction.count, 0)}</small>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
});
