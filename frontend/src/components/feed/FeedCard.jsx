import { useState } from "react";
import { Link } from "react-router-dom";
import { Award, CalendarDays, Lock, MapPin, Megaphone, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Avatar, Badge, ConfirmDialog, StatusBadge } from "../ui";
import { FEED_TYPE_LABELS } from "../../lib/constants";
import { formatDate, formatTimeRange, timeAgo } from "../../lib/format";

const TYPE_STYLE = {
    EVENT: ["info", CalendarDays],
    ANNOUNCEMENT: ["gold", Megaphone],
    EVENT_UPDATE: ["violet", RefreshCw],
    RESULT: ["success", Award],
    CLUB_UPDATE: ["ink", Sparkles]
};

export const Podium = ({ awards = [], limit = 3 }) => {
    const sorted = [...awards].sort((a, b) => (a.position || 99) - (b.position || 99)).slice(0, limit);
    return (
        <div className="podium">
            {sorted.map((award) => (
                <div key={award._id || award.title} className="podium-row">
                    <span className={`medal medal-${award.position || 0}`}>{award.position || "★"}</span>
                    <span>
                        <strong>{award.teamName || award.recipientName || award.recipientUser?.name}</strong>
                        <span className="subtle"> · {award.title}</span>
                        {award.prize && <span className="subtle"> · {award.prize}</span>}
                    </span>
                </div>
            ))}
        </div>
    );
};

export const FeedCard = ({ post, canDelete = false, onDelete }) => {
    const [confirming, setConfirming] = useState(false);
    const [tone, Icon] = TYPE_STYLE[post.type] || ["neutral", Sparkles];
    const event = post.event;

    return (
        <article className="card feed-card">
            <div className="feed-card-head">
                <Link to={`/clubs/${post.club?._id}`}>
                    <Avatar name={post.club?.name} src={post.club?.logo} square />
                </Link>
                <div className="who">
                    <Link to={`/clubs/${post.club?._id}`} style={{ color: "inherit" }}>
                        <strong>{post.club?.name}</strong>
                    </Link>
                    <span className="subtle">
                        {post.isSystem ? "CampusConnect" : post.author?.name} · {timeAgo(post.createdAt)}
                    </span>
                </div>
                <div className="spacer" />
                {post.visibility === "MEMBERS" && (
                    <Badge title="Visible to club members only">
                        <Lock size={11} /> Members
                    </Badge>
                )}
                <Badge tone={tone}>
                    <Icon size={12} /> {FEED_TYPE_LABELS[post.type]}
                </Badge>
                {canDelete && (
                    <button type="button" className="icon-button" onClick={() => setConfirming(true)} aria-label="Delete post">
                        <Trash2 size={16} />
                    </button>
                )}
            </div>
            <div className="feed-card-body">
                <h3>{post.title}</h3>
                {post.body && post.type !== "RESULT" && <p className="pre-line muted">{post.body}</p>}

                {post.type === "RESULT" && post.result && (
                    <div className="feed-embed">
                        <Podium awards={post.result.awards} />
                        {post.result.summary && <p className="small muted pre-line">{post.result.summary}</p>}
                    </div>
                )}

                {post.image && (
                    <div className="feed-image">
                        <img src={post.image} alt="" loading="lazy" />
                    </div>
                )}

                {event && (
                    <Link to={`/events/${event._id}`} className="feed-embed" style={{ color: "inherit", textDecoration: "none" }}>
                        <div className="row-between">
                            <strong>{event.title}</strong>
                            <StatusBadge status={event.status} />
                        </div>
                        <span className="subtle row" style={{ gap: 12 }}>
                            <span className="row" style={{ gap: 5 }}>
                                <CalendarDays size={13} /> {formatDate(event.startAt)} · {formatTimeRange(event.startAt, event.endAt)}
                            </span>
                            {event.venue?.name && (
                                <span className="row" style={{ gap: 5 }}>
                                    <MapPin size={13} /> {event.venue.name}
                                </span>
                            )}
                        </span>
                    </Link>
                )}
            </div>
            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={() => onDelete(post)}
                title="Delete this post?"
                description="It will be removed from the campus feed for everyone."
                confirmLabel="Delete post"
                variant="danger"
            />
        </article>
    );
};
