import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Clock3, Film, Image as ImageIcon, RefreshCw, Send, Sparkles, UploadCloud } from "lucide-react";
import { eventApi, storyApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { loadStories } from "../../hooks/useStories";
import { STORY_LIMITS, inspectStoryFile, uploadStoryMedia } from "../../lib/stories";
import { formatDate } from "../../lib/format";
import { ApiErrorAlert, Avatar, Button, Modal, Select, Textarea } from "../ui";

const ACCEPT = [...STORY_LIMITS.imageTypes, ...STORY_LIMITS.videoTypes].join(",");

const emptyDraft = { source: null, file: null, preview: null, posterEvent: null };

// "Add to story": pick a photo or short video (or share an event's poster), add a caption and an event link.
export const StoryComposer = ({ open, onClose, clubs }) => {
    const toast = useToast();
    const formId = useId();
    const inputRef = useRef(null);
    const [clubId, setClubId] = useState(clubs[0]?._id || "");
    const [draft, setDraft] = useState(emptyDraft);
    const [caption, setCaption] = useState("");
    const [eventId, setEventId] = useState("");
    const [events, setEvents] = useState([]);
    const [dragging, setDragging] = useState(false);
    const [progress, setProgress] = useState(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const club = clubs.find((item) => item._id === clubId) || clubs[0];

    useEffect(() => {
        if (open && !clubs.some((item) => item._id === clubId)) {
            setClubId(clubs[0]?._id || "");
        }
    }, [open, clubs, clubId]);

    // The club's published events that are still coming up or happening now, for linking or poster sharing.
    useEffect(() => {
        if (!open || !club?._id) {
            return undefined;
        }
        let active = true;
        Promise.all(["ongoing", "upcoming"].map((timeframe) => eventApi.list({ club: club._id, timeframe, limit: 20 }).catch(() => ({ data: [] }))))
            .then((responses) => active && setEvents(responses.flatMap((response) => response.data)))
            .catch(() => active && setEvents([]));
        return () => {
            active = false;
        };
    }, [open, club?._id]);

    // Free the preview's object URL when it is replaced or the composer closes.
    useEffect(() => {
        const url = draft.preview?.url;
        return () => url && URL.revokeObjectURL(url);
    }, [draft.preview?.url]);

    const reset = () => {
        setDraft(emptyDraft);
        setCaption("");
        setEventId("");
        setProgress(null);
        setError(null);
    };

    const close = () => {
        if (pending) {
            return;
        }
        reset();
        onClose();
    };

    const pickFile = async (file) => {
        if (!file) {
            return;
        }
        setError(null);
        const details = await inspectStoryFile(file);
        if (details.error) {
            setError(new Error(details.error));
            return;
        }
        setDraft({ source: "file", file, preview: details, posterEvent: null });
    };

    const sharePoster = (event) => {
        setError(null);
        setDraft({ source: "event", file: null, preview: null, posterEvent: event });
        setEventId(event._id);
    };

    const submit = async (submitEvent) => {
        submitEvent.preventDefault();
        if (!draft.source || !club) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            if (draft.source === "event") {
                await storyApi.create({ club: club._id, event: draft.posterEvent._id, media: { provider: "event" }, caption: caption.trim() });
            } else {
                setProgress(0);
                const media = await uploadStoryMedia(draft.file, club._id, { details: draft.preview, onProgress: setProgress });
                setProgress(1);
                await storyApi.create({ club: club._id, media, caption: caption.trim(), ...(eventId ? { event: eventId } : {}) });
            }
            toast.success(`Added to ${club.name}'s story — it disappears in 24 hours`);
            loadStories();
            reset();
            onClose();
        } catch (err) {
            setError(err);
            setProgress(null);
        } finally {
            setPending(false);
        }
    };

    const posterEvents = events.filter((event) => event.poster);
    const linked = events.find((event) => event._id === eventId) || draft.posterEvent;
    const uploading = progress !== null && progress < 1;

    return (
        <Modal
            open={open}
            onClose={close}
            title="Add to story"
            description="Stories appear at the top of the campus feed for 24 hours. Everyone can watch; you'll see who did."
            size="lg"
            footer={
                <>
                    <Button variant="secondary" onClick={close} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form={formId} loading={pending} disabled={!draft.source}>
                        <Send size={15} /> {uploading ? `Uploading ${Math.round(progress * 100)}%` : pending ? "Sharing…" : "Share to story"}
                    </Button>
                </>
            }
        >
            <form id={formId} className="story-composer" onSubmit={submit}>
                <div
                    className={`sc-preview ${dragging ? "is-dragging" : ""} ${draft.source ? "has-media" : ""}`}
                    onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        pickFile(event.dataTransfer.files?.[0]);
                    }}
                >
                    {draft.source === "file" && draft.preview.kind === "VIDEO" && <video src={draft.preview.url} autoPlay muted loop playsInline />}
                    {draft.source === "file" && draft.preview.kind === "IMAGE" && <img src={draft.preview.url} alt="Story preview" />}
                    {draft.source === "event" && <img src={draft.posterEvent.poster} alt={`${draft.posterEvent.title} poster`} />}

                    {draft.source ? (
                        <>
                            <div className="sc-preview-head">
                                <Avatar name={club?.name} src={club?.logo} size="sm" />
                                <strong>{club?.name}</strong>
                                <span>now</span>
                            </div>
                            <div className="sc-preview-foot">
                                {caption.trim() && <p>{caption.trim()}</p>}
                                {linked && (
                                    <span className="sc-preview-event">
                                        <CalendarDays size={14} /> {linked.title}
                                    </span>
                                )}
                            </div>
                            <button type="button" className="sc-replace" onClick={() => inputRef.current?.click()} disabled={pending}>
                                <RefreshCw size={14} /> Replace
                            </button>
                            {progress !== null && (
                                <span className="sc-progress" aria-hidden="true">
                                    <i style={{ width: `${Math.round(progress * 100)}%` }} />
                                </span>
                            )}
                        </>
                    ) : (
                        <button type="button" className="sc-drop" onClick={() => inputRef.current?.click()}>
                            <span className="sc-drop-icon">
                                <UploadCloud size={28} />
                            </span>
                            <strong>Add a photo or video</strong>
                            <span>Drag it here or click to choose</span>
                            <small>
                                <ImageIcon size={13} /> Photos up to {STORY_LIMITS.maxImageBytes / 1048576} MB · <Film size={13} /> Videos up to {STORY_LIMITS.maxVideoSeconds}s
                            </small>
                        </button>
                    )}
                    <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(event) => pickFile(event.target.files?.[0]).finally(() => (event.target.value = ""))} />
                </div>

                <div className="sc-fields stack">
                    {clubs.length > 1 && (
                        <Select label="Post as" value={club?._id || ""} onChange={(event) => setClubId(event.target.value)} disabled={pending}>
                            {clubs.map((item) => (
                                <option key={item._id} value={item._id}>
                                    {item.name}
                                </option>
                            ))}
                        </Select>
                    )}

                    {posterEvents.length > 0 && (
                        <div className="sc-posters">
                            <span className="sc-label">
                                <Sparkles size={14} /> Or share an event poster
                            </span>
                            <div className="sc-poster-row">
                                {posterEvents.map((event) => (
                                    <button
                                        key={event._id}
                                        type="button"
                                        className={`sc-poster ${draft.posterEvent?._id === event._id ? "is-selected" : ""}`}
                                        onClick={() => sharePoster(event)}
                                        disabled={pending}
                                        title={event.title}
                                    >
                                        <img src={event.poster} alt="" />
                                        <span>{event.title}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <Textarea
                        label="Caption"
                        rows={3}
                        maxLength={STORY_LIMITS.captionLength}
                        value={caption}
                        onChange={(event) => setCaption(event.target.value)}
                        placeholder="Say something about it… e.g. Registrations close tonight!"
                        hint={`${caption.length}/${STORY_LIMITS.captionLength}`}
                        disabled={pending}
                    />

                    {draft.source !== "event" && (
                        <Select label="Link an event (optional)" value={eventId} onChange={(event) => setEventId(event.target.value)} disabled={pending || events.length === 0} hint={events.length === 0 ? "This club has no upcoming published events" : "Viewers get a button to open it"}>
                            <option value="">No event</option>
                            {events.map((event) => (
                                <option key={event._id} value={event._id}>
                                    {event.title} · {formatDate(event.startAt)}
                                </option>
                            ))}
                        </Select>
                    )}

                    <p className="sc-note">
                        <Clock3 size={14} /> Disappears automatically after 24 hours. The file is stored in media storage, not in the database.
                    </p>

                    <ApiErrorAlert error={error} />
                </div>
            </form>
        </Modal>
    );
};
