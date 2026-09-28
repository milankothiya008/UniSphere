import { useCallback, useEffect, useRef, useState } from "react";
import { galleryApi } from "../api/endpoints";
import { inspectMediaFile, uploadWithTicket } from "../lib/mediaUpload";

// Uploads a batch of photos and videos to an event's gallery: each file is checked in the browser, then sent
// with its own upload ticket (tickets are fetched for the whole batch in one request), a few at a time.
//
// entry: { id, name, kind, preview, status: queued | uploading | saving | done | error, progress, error, item }

const PARALLEL = 3;
const TICKET_BATCH = 20;
const DEFAULT_LIMITS = { maxImageBytes: 15 * 1024 * 1024, maxVideoBytes: 80 * 1024 * 1024, maxVideoSeconds: 90 };

let nextId = 0;

export const useGalleryUploader = (eventId, { limits, onAdded, onBatchDone } = {}) => {
    const [entries, setEntries] = useState([]);
    const filesRef = useRef(new Map());
    const detailsRef = useRef(new Map());
    const activeRef = useRef(0);
    const queueRef = useRef([]);
    const ticketsRef = useRef(new Map());
    const aliveRef = useRef(true);
    const callbacks = useRef({ onAdded, onBatchDone });
    callbacks.current = { onAdded, onBatchDone };

    const patch = useCallback((id, changes) => {
        if (aliveRef.current) {
            setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
        }
    }, []);

    const runOne = useCallback(
        async (id) => {
            const file = filesRef.current.get(id);
            const ticket = ticketsRef.current.get(id);
            activeRef.current += 1;
            patch(id, { status: "uploading", progress: 0 });
            try {
                const media = await uploadWithTicket(file, ticket, {
                    details: detailsRef.current.get(id),
                    onProgress: (progress) => patch(id, { progress })
                });
                patch(id, { status: "saving", progress: 1 });
                const { data: item } = await galleryApi.add(eventId, media);
                patch(id, { status: "done", item });
                callbacks.current.onAdded?.(item);
            } catch (error) {
                patch(id, { status: "error", error: error.message || "Upload failed" });
            } finally {
                ticketsRef.current.delete(id);
                activeRef.current -= 1;
                pump();
            }
        },
        // pump() reads pumpRef, so it is always current.
        [eventId, patch]
    );

    const pumpRef = useRef(null);
    const pump = () => pumpRef.current?.();

    pumpRef.current = () => {
        while (activeRef.current < PARALLEL && queueRef.current.length) {
            runOne(queueRef.current.shift());
        }
    };

    // Fetches upload tickets for waiting files (one request per 20), then starts them.
    const start = useCallback(
        async (ids) => {
            for (let i = 0; i < ids.length; i += TICKET_BATCH) {
                const chunk = ids.slice(i, i + TICKET_BATCH);
                try {
                    const { data: tickets } = await galleryApi.uploadTickets(
                        eventId,
                        chunk.map((id) => detailsRef.current.get(id).kind)
                    );
                    chunk.forEach((id, index) => ticketsRef.current.set(id, tickets[index]));
                    queueRef.current.push(...chunk);
                    pumpRef.current();
                } catch (error) {
                    chunk.forEach((id) => patch(id, { status: "error", error: error.message || "Upload failed" }));
                }
            }
        },
        [eventId, patch]
    );

    /** Adds picked or dropped files and starts uploading the valid ones. */
    const addFiles = useCallback(
        async (fileList) => {
            const files = Array.from(fileList || []);
            if (!files.length) {
                return;
            }
            const checked = await Promise.all(files.map((file) => inspectMediaFile(file, limits || DEFAULT_LIMITS)));
            const created = files.map((file, index) => {
                const id = `u${(nextId += 1)}`;
                const details = checked[index];
                filesRef.current.set(id, file);
                detailsRef.current.set(id, details);
                return {
                    id,
                    name: file.name,
                    kind: details.kind || null,
                    preview: details.url || null,
                    status: details.error ? "error" : "queued",
                    progress: 0,
                    error: details.error || null,
                    item: null
                };
            });
            setEntries((current) => [...current, ...created]);
            await start(created.filter((entry) => entry.status === "queued").map((entry) => entry.id));
        },
        [limits, start]
    );

    const retry = useCallback(
        (id) => {
            if (!detailsRef.current.get(id)?.kind) {
                return;
            }
            patch(id, { status: "queued", error: null, progress: 0 });
            start([id]);
        },
        [patch, start]
    );

    const release = (id) => {
        const details = detailsRef.current.get(id);
        if (details?.url) {
            URL.revokeObjectURL(details.url);
        }
        filesRef.current.delete(id);
        detailsRef.current.delete(id);
    };

    const dismiss = useCallback((id) => {
        release(id);
        setEntries((current) => current.filter((entry) => entry.id !== id));
    }, []);

    /** Clears finished and failed entries once the person has seen them. */
    const clearSettled = useCallback(() => {
        setEntries((current) => {
            current.filter((entry) => entry.status === "done" || entry.status === "error").forEach((entry) => release(entry.id));
            return current.filter((entry) => entry.status !== "done" && entry.status !== "error");
        });
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        const details = detailsRef.current;
        return () => {
            aliveRef.current = false;
            details.forEach((value) => value?.url && URL.revokeObjectURL(value.url));
        };
    }, []);

    const busy = entries.some((entry) => ["queued", "uploading", "saving"].includes(entry.status));

    // When a batch settles, report the files that made it (once).
    useEffect(() => {
        if (busy) {
            return;
        }
        const fresh = entries.filter((entry) => entry.status === "done" && !entry.reported);
        if (fresh.length) {
            setEntries((current) => current.map((entry) => (fresh.some((done) => done.id === entry.id) ? { ...entry, reported: true } : entry)));
            callbacks.current.onBatchDone?.(fresh.map((entry) => entry.item));
        }
    }, [busy, entries]);

    return { entries, busy, addFiles, retry, dismiss, clearSettled };
};
