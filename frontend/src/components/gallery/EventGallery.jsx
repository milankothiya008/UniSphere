import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Check, CheckCheck, Clock3, Film, Hourglass, ImagePlus, Images, Play, RotateCcw, ShieldCheck, Trash2, UploadCloud, X } from "lucide-react";
import { galleryApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useGalleryUploader } from "../../hooks/useGalleryUploader";
import { useToast } from "../../context/ToastContext";
import { ACCEPT_MEDIA } from "../../lib/mediaUpload";
import { plural } from "../../lib/format";
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Tabs } from "../ui";
import { GalleryViewer } from "./GalleryViewer";

// From this many photos the newest is shown large, mosaic-style.
const FEATURE_FROM = 9;
const LEAVE_MS = 260;

const duration = (seconds) => {
    const total = Math.round(seconds || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const describe = (items) => {
    const videos = items.filter((item) => item.kind === "VIDEO").length;
    const photos = items.length - videos;
    return [photos && plural(photos, "photo"), videos && plural(videos, "video")].filter(Boolean).join(" and ");
};

const newestFirst = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

// One square in the grid. Thumbnails fade in as they load; videos carry a play badge and their length.
const Tile = ({ item, index = 0, onOpen, selectable = false, selected = false, onToggle, leaving = false }) => (
    <div className={`gallery-tile ${selected ? "is-selected" : ""} ${leaving ? "is-leaving" : ""}`} style={{ "--i": Math.min(index, 12) }}>
        <button type="button" className="gallery-tile-open" onClick={onOpen} aria-label={`Open ${item.kind === "VIDEO" ? "video" : "photo"} by ${item.uploader.name}`}>
            {item.thumb ? (
                <img src={item.thumb} alt="" loading="lazy" decoding="async" onLoad={(event) => event.currentTarget.classList.add("is-loaded")} />
            ) : (
                <span className="gallery-tile-fallback">
                    <Film size={26} />
                </span>
            )}
            {item.kind === "VIDEO" && (
                <span className="gallery-tile-play" aria-hidden="true">
                    <Play size={16} fill="currentColor" />
                </span>
            )}
            {item.kind === "VIDEO" && item.duration ? <span className="gallery-tile-duration">{duration(item.duration)}</span> : null}
            <span className="gallery-tile-by">
                {item.uploader.name}
                {selectable && <small>{item.uploaderRole === "PARTICIPANT" ? "Participant" : "Member"}</small>}
            </span>
        </button>
        {selectable && (
            <button type="button" className="gallery-check" onClick={onToggle} aria-pressed={selected} aria-label={selected ? "Deselect" : "Select"}>
                <Check size={14} strokeWidth={3} />
            </button>
        )}
    </div>
);

// Progress for the files being uploaded right now.
const UploadTray = ({ uploader, moderated }) => {
    const { entries, busy, retry, dismiss, clearSettled } = uploader;
    if (!entries.length) {
        return null;
    }
    const done = entries.filter((entry) => entry.status === "done").length;
    const failed = entries.filter((entry) => entry.status === "error").length;

    return (
        <div className="gallery-tray" aria-live="polite">
            <div className="gallery-tray-head">
                <span className="row" style={{ gap: 8 }}>
                    {busy ? <UploadCloud size={16} className="gallery-tray-pulse" /> : failed ? <AlertCircle size={16} /> : <CheckCheck size={16} />}
                    <strong>
                        {busy
                            ? `Uploading ${done + 1 > entries.length ? entries.length : done + 1} of ${entries.length - failed}…`
                            : failed
                              ? `${plural(done, "file")} uploaded, ${failed} failed`
                              : moderated
                                ? `${plural(done, "file")} added to the gallery`
                                : `${plural(done, "file")} sent for review`}
                    </strong>
                </span>
                {!busy && (
                    <Button variant="ghost" size="sm" onClick={clearSettled}>
                        Done
                    </Button>
                )}
            </div>
            <ul className="gallery-tray-list">
                {entries.map((entry) => (
                    <li key={entry.id} className={`gallery-tray-item is-${entry.status}`} title={entry.error || entry.name}>
                        {entry.preview && entry.kind === "IMAGE" && <img src={entry.preview} alt="" />}
                        {entry.preview && entry.kind === "VIDEO" && <video src={entry.preview} muted playsInline preload="metadata" />}
                        {!entry.preview && (
                            <span className="gallery-tray-blank">
                                <AlertCircle size={18} />
                            </span>
                        )}
                        {(entry.status === "uploading" || entry.status === "queued" || entry.status === "saving") && (
                            <span className="gallery-tray-progress" style={{ "--p": entry.status === "queued" ? 0 : entry.progress }}>
                                <svg viewBox="0 0 36 36" aria-hidden="true">
                                    <circle cx="18" cy="18" r="15" />
                                    <circle cx="18" cy="18" r="15" className="bar" />
                                </svg>
                            </span>
                        )}
                        {entry.status === "done" && (
                            <span className="gallery-tray-badge is-ok">
                                <Check size={14} strokeWidth={3} />
                            </span>
                        )}
                        {entry.status === "error" && (
                            <span className="gallery-tray-error">
                                {entry.kind ? (
                                    <button type="button" onClick={() => retry(entry.id)} aria-label={`Retry ${entry.name}`}>
                                        <RotateCcw size={15} />
                                    </button>
                                ) : null}
                                <button type="button" onClick={() => dismiss(entry.id)} aria-label={`Remove ${entry.name}`}>
                                    <X size={15} />
                                </button>
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            {entries.some((entry) => entry.status === "error" && entry.error) && (
                <p className="gallery-tray-note">{entries.find((entry) => entry.status === "error" && entry.error).error}</p>
            )}
        </div>
    );
};

/**
 * An event's photo and video gallery (the /gallery/:eventId page). Club members (from publishing) and checked-in
 * participants (from the start of the event) add files; the president and vice-president approve them.
 */
export const EventGallery = ({ event }) => {
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const inputRef = useRef(null);
    const visible = ["PUBLISHED", "COMPLETED"].includes(event.status);
    const { data, meta, loading, reload, setData } = useApi(() => galleryApi.list(event._id, { limit: 24 }), [event._id], { enabled: visible });

    const [tab, setTab] = useState("gallery");
    const [viewer, setViewer] = useState(null); // { list: "approved" | "pending", index }
    const [confirm, setConfirm] = useState(null); // { type: "delete" | "decline", items }
    const [selected, setSelected] = useState(() => new Set());
    const [leaving, setLeaving] = useState(() => new Set());
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [page, setPage] = useState({ number: 1, loading: false });

    const access = data?.viewer || {};
    const approved = data?.items || [];
    const pending = data?.pending || [];
    const mine = data?.mine || [];
    const approvedCount = data?.counts?.approved || 0;
    const moreToLoad = meta ? page.number < meta.totalPages : false;

    const uploader = useGalleryUploader(event._id, {
        limits: access.limits,
        onAdded: (item) =>
            setData((current) =>
                item.status === "APPROVED"
                    ? { ...current, items: [item, ...current.items], counts: { ...current.counts, approved: current.counts.approved + 1 } }
                    : { ...current, mine: [item, ...current.mine], counts: { ...current.counts, pending: current.counts.pending + 1 } }
            ),
        onBatchDone: (items) =>
            items.every((item) => item.status === "APPROVED")
                ? toast.success(`Added ${describe(items)} to the gallery`)
                : toast.success(`Sent ${describe(items)} for review — they'll appear once the president or vice-president approves them.`)
    });

    // Links from notifications and the dashboard: ?review=1 opens the review queue.
    useEffect(() => {
        if (params.get("review") !== "1" || !data) {
            return;
        }
        if (access.canModerate) {
            setTab("review");
        }
        params.delete("review");
        setParams(params, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params, data]);

    // Leave the review tab once there's nothing left to review.
    useEffect(() => {
        if (tab === "review" && data && !pending.length) {
            setTab("gallery");
        }
    }, [tab, data, pending.length]);

    const pick = () => inputRef.current?.click();
    const onPicked = (changeEvent) => {
        uploader.addFiles(changeEvent.target.files);
        changeEvent.target.value = "";
    };

    const loadMore = async () => {
        setPage((current) => ({ ...current, loading: true }));
        try {
            const next = page.number + 1;
            const response = await galleryApi.list(event._id, { limit: 24, page: next });
            setData((current) => {
                const known = new Set(current.items.map((item) => item._id));
                return { ...current, items: [...current.items, ...response.data.items.filter((item) => !known.has(item._id))] };
            });
            setPage({ number: next, loading: false });
        } catch (error) {
            toast.error(error);
            setPage((current) => ({ ...current, loading: false }));
        }
    };

    const toggle = (id) =>
        setSelected((current) => {
            const next = new Set(current);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    // Approve or decline: tiles animate out, then the lists update from the server's counts.
    const review = useCallback(
        async (decision, items, reason) => {
            const ids = items.map((item) => item._id);
            setBusy(true);
            try {
                const response = decision === "approve" ? await galleryApi.approve(event._id, ids) : await galleryApi.reject(event._id, ids, reason);
                setLeaving(new Set(ids));
                await new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
                setData((current) => {
                    const moved = current.pending.filter((item) => ids.includes(item._id)).map((item) => ({ ...item, status: "APPROVED" }));
                    return {
                        ...current,
                        pending: current.pending.filter((item) => !ids.includes(item._id)),
                        items: decision === "approve" ? [...moved, ...current.items].sort(newestFirst) : current.items,
                        counts: response.data.counts
                    };
                });
                setLeaving(new Set());
                setSelected(new Set());
                toast.success(response.message);
                return true;
            } catch (error) {
                toast.error(error);
                reload({ silent: true });
                return false;
            } finally {
                setBusy(false);
            }
        },
        [event._id, reload, setData, toast]
    );

    const remove = async (item) => {
        const response = await galleryApi.remove(event._id, item._id);
        setData((current) => ({
            ...current,
            items: current.items.filter((entry) => entry._id !== item._id),
            mine: current.mine.filter((entry) => entry._id !== item._id),
            pending: current.pending.filter((entry) => entry._id !== item._id),
            counts: access.canModerate ? response.data.counts : { ...response.data.counts, pending: current.mine.filter((entry) => entry._id !== item._id).length }
        }));
        setViewer((current) => {
            if (!current) {
                return current;
            }
            const size = (current.list === "pending" ? pending : approved).length - 1;
            return size <= 0 ? null : { ...current, index: Math.min(current.index, size - 1) };
        });
        toast.success(response.message);
    };

    // In the viewer's review mode, approving or declining moves on to the next upload.
    const reviewFromViewer = async (decision, item, reason) => {
        const ok = await review(decision, [item], reason);
        if (ok) {
            setViewer((current) => {
                const left = pending.length - 1;
                return left <= 0 ? null : { ...current, index: Math.min(current.index, left - 1) };
            });
        }
    };

    // Drag and drop from the desktop.
    const dragProps = access.canUpload
        ? {
              onDragEnter: (dragEvent) => {
                  if (dragEvent.dataTransfer?.types?.includes("Files")) {
                      dragEvent.preventDefault();
                      setDragging(true);
                  }
              },
              onDragOver: (dragEvent) => dragEvent.dataTransfer?.types?.includes("Files") && dragEvent.preventDefault(),
              onDragLeave: (dragEvent) => !dragEvent.currentTarget.contains(dragEvent.relatedTarget) && setDragging(false),
              onDrop: (dragEvent) => {
                  dragEvent.preventDefault();
                  setDragging(false);
                  uploader.addFiles(dragEvent.dataTransfer.files);
              }
          }
        : {};

    if (!visible) {
        return null;
    }
    if ((loading && !data) || !data) {
        return (
            <div className="gallery-grid" aria-busy="true">
                {Array.from({ length: 8 }, (_, index) => (
                    <Skeleton key={index} height="100%" style={{ aspectRatio: "1", borderRadius: 14 }} />
                ))}
            </div>
        );
    }

    const featured = approved.length >= FEATURE_FROM;
    const viewerItems = viewer ? (viewer.list === "pending" ? pending : approved) : [];
    const selection = pending.filter((item) => selected.has(item._id));
    const tabs = [
        { value: "gallery", label: "Gallery", icon: Images, count: approvedCount },
        { value: "review", label: "To review", icon: Hourglass, count: pending.length }
    ];

    return (
        <section id="gallery" className={`gallery-section ${dragging ? "is-dragging" : ""}`} {...dragProps}>
            <Card
                title={
                    <h2 className="row">
                        <Images size={18} /> Photos & videos
                        {approvedCount > 0 && <span className="gallery-count">{approvedCount}</span>}
                    </h2>
                }
                actions={
                    access.canUpload && (
                        <Button size="sm" onClick={pick} disabled={uploader.busy}>
                            <ImagePlus size={15} /> Add photos
                        </Button>
                    )
                }
            >
                <input ref={inputRef} type="file" accept={ACCEPT_MEDIA} multiple hidden onChange={onPicked} data-testid="gallery-file-input" />

                <div className="stack">
                    {access.canModerate && pending.length > 0 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

                    <UploadTray uploader={uploader} moderated={access.canModerate} />

                    {tab === "gallery" && (
                        <>
                            {approved.length > 0 ? (
                                <div className={`gallery-grid ${featured ? "has-feature" : ""}`}>
                                    {approved.map((item, index) => (
                                        <Tile key={item._id} item={item} index={index % 24} onOpen={() => setViewer({ list: "approved", index })} />
                                    ))}
                                </div>
                            ) : access.canUpload ? (
                                <button type="button" className="gallery-empty" onClick={pick}>
                                    <span className="gallery-empty-icon">
                                        <ImagePlus size={26} />
                                    </span>
                                    <strong>No photos yet</strong>
                                    <span>Share photos and videos from the event — tap here or drop files.</span>
                                </button>
                            ) : (
                                <EmptyState
                                    icon={Images}
                                    title="No photos yet"
                                    description={
                                        access.canModerate
                                            ? "Uploads from members and checked-in participants will wait here for your approval."
                                            : access.hint || "Club members and checked-in participants share their photos and videos here."
                                    }
                                />
                            )}
                            {moreToLoad && (
                                <Button variant="secondary" block loading={page.loading} onClick={loadMore}>
                                    Load more
                                </Button>
                            )}
                        </>
                    )}

                    {tab === "review" && (
                        <div className="gallery-review">
                            <div className="gallery-review-bar">
                                <button
                                    type="button"
                                    className={`gallery-check is-inline ${selection.length === pending.length ? "is-on" : ""}`}
                                    onClick={() => setSelected(selection.length === pending.length ? new Set() : new Set(pending.map((item) => item._id)))}
                                    aria-pressed={selection.length === pending.length}
                                    aria-label="Select all"
                                >
                                    <Check size={14} strokeWidth={3} />
                                </button>
                                <span className="subtle small grow">{selection.length ? `${selection.length} selected` : `${plural(pending.length, "upload")} waiting`}</span>
                                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirm({ type: "decline", items: selection.length ? selection : pending })}>
                                    <X size={15} /> {selection.length ? "Decline" : "Decline all"}
                                </Button>
                                <Button size="sm" loading={busy} onClick={() => review("approve", selection.length ? selection : pending)}>
                                    <Check size={15} /> {selection.length ? `Approve ${selection.length}` : "Approve all"}
                                </Button>
                            </div>
                            <div className="gallery-grid">
                                {pending.map((item, index) => (
                                    <Tile
                                        key={item._id}
                                        item={item}
                                        index={index}
                                        selectable
                                        selected={selected.has(item._id)}
                                        leaving={leaving.has(item._id)}
                                        onToggle={() => toggle(item._id)}
                                        onOpen={() => setViewer({ list: "pending", index })}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {mine.length > 0 && (
                        <div className="gallery-mine">
                            <div className="row" style={{ gap: 6 }}>
                                <Clock3 size={15} />
                                <strong className="small">Waiting for approval</strong>
                                <span className="subtle small">· {plural(mine.length, "upload")}</span>
                            </div>
                            <ul className="gallery-mine-list">
                                {mine.map((item) => (
                                    <li key={item._id}>
                                        {item.thumb ? <img src={item.thumb} alt="" /> : <Film size={18} />}
                                        <button type="button" onClick={() => setConfirm({ type: "delete", items: [item] })} aria-label="Delete this upload">
                                            <Trash2 size={13} />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {access.canUpload && !access.canModerate && (
                        <p className="gallery-note">
                            <ShieldCheck size={14} /> New uploads appear after the club's president or vice-president approves them.
                        </p>
                    )}
                    {!access.canUpload && access.hint && approved.length > 0 && <p className="gallery-note">{access.hint}</p>}
                </div>

                {dragging && (
                    <div className="gallery-drop" aria-hidden="true">
                        <UploadCloud size={30} />
                        <strong>Drop to add photos and videos</strong>
                    </div>
                )}
            </Card>


            {viewer && viewerItems.length > 0 && (
                <GalleryViewer
                    items={viewerItems}
                    index={Math.min(viewer.index, viewerItems.length - 1)}
                    onIndex={(index) => setViewer((current) => ({ ...current, index }))}
                    onClose={() => setViewer(null)}
                    title={event.title}
                    review={viewer.list === "pending"}
                    busy={busy}
                    onApprove={(item) => reviewFromViewer("approve", item)}
                    onDecline={(item) => setConfirm({ type: "decline", items: [item], fromViewer: true })}
                    onDelete={(item) => setConfirm({ type: "delete", items: [item] })}
                />
            )}

            <ConfirmDialog
                open={confirm?.type === "delete"}
                onClose={() => setConfirm(null)}
                onConfirm={() => remove(confirm.items[0])}
                title={`Delete this ${confirm?.items[0]?.kind === "VIDEO" ? "video" : "photo"}?`}
                description="It's removed from the gallery and deleted for good."
                confirmLabel="Delete"
                variant="danger"
            />
            <ConfirmDialog
                open={confirm?.type === "decline"}
                onClose={() => setConfirm(null)}
                onConfirm={async (reason) => {
                    if (confirm.fromViewer) {
                        await reviewFromViewer("decline", confirm.items[0], reason);
                    } else {
                        await review("decline", confirm.items, reason);
                    }
                }}
                title={confirm?.items?.length > 1 ? `Decline ${describe(confirm.items)}?` : "Decline this upload?"}
                description="Declined uploads are deleted, and the people who added them are told."
                reasonLabel="Reason for the uploader"
                reasonPlaceholder="e.g. Blurry, or not from this event"
                confirmLabel="Decline and delete"
                variant="danger"
            />
        </section>
    );
};
