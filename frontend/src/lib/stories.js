import { API_BASE, ApiError, getAccessToken, refreshSession } from "../api/client";
import { storyApi } from "../api/endpoints";

// Limits checked in the browser before uploading; the server enforces its own (sent with each upload ticket).
export const STORY_LIMITS = {
    imageTypes: ["image/jpeg", "image/png", "image/webp"],
    videoTypes: ["video/mp4", "video/quicktime", "video/webm"],
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 40 * 1024 * 1024,
    maxVideoSeconds: 30,
    captionLength: 200
};

// Seconds a photo stays on screen.
export const IMAGE_SECONDS = 6;

const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

export const storyKindOf = (file) =>
    STORY_LIMITS.imageTypes.includes(file?.type) ? "IMAGE" : STORY_LIMITS.videoTypes.includes(file?.type) ? "VIDEO" : null;

// Reads a picked file's size and, for videos, its length, without uploading anything.
export const inspectStoryFile = (file) =>
    new Promise((resolve) => {
        const kind = storyKindOf(file);
        if (!kind) {
            resolve({ error: "Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video" });
            return;
        }
        const limit = kind === "VIDEO" ? STORY_LIMITS.maxVideoBytes : STORY_LIMITS.maxImageBytes;
        if (file.size > limit) {
            resolve({ error: `${kind === "VIDEO" ? "Videos" : "Photos"} must be ${mb(limit)} or smaller` });
            return;
        }

        const url = URL.createObjectURL(file);
        const done = (details) => resolve({ kind, url, ...details });

        if (kind === "IMAGE") {
            const image = new Image();
            image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => done({});
            image.src = url;
            return;
        }

        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            const duration = Number.isFinite(video.duration) ? video.duration : null;
            if (duration && duration > STORY_LIMITS.maxVideoSeconds + 0.5) {
                URL.revokeObjectURL(url);
                resolve({ error: `Videos can be up to ${STORY_LIMITS.maxVideoSeconds} seconds long (this one is ${Math.round(duration)}s)` });
                return;
            }
            done({ duration, width: video.videoWidth, height: video.videoHeight });
        };
        video.onerror = () => done({});
        video.src = url;
    });

// XMLHttpRequest rather than fetch so the composer can show upload progress.
const send = (url, form, { headers = {}, onProgress }) =>
    new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        if (headers.Authorization) {
            xhr.withCredentials = true;
        }
        xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
        xhr.onload = () => {
            let body = {};
            try {
                body = JSON.parse(xhr.responseText || "{}");
            } catch {
                body = {};
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(body);
            } else {
                reject(new ApiError(body.message || body.error?.message || `Upload failed (${xhr.status})`, { status: xhr.status, code: body.errorCode }));
            }
        };
        xhr.onerror = () => reject(new ApiError("Upload failed. Check your connection and try again."));
        xhr.send(form);
    });

/**
 * Uploads a story photo or video and returns the media reference to post the story with.
 * With cloud storage the file goes straight from the browser to Cloudinary (never through our API);
 * in development it goes to the API's local storage.
 */
export const uploadStoryMedia = async (file, clubId, { details = {}, onProgress } = {}) => {
    const kind = storyKindOf(file);
    const { data: ticket } = await storyApi.uploadTicket(clubId, kind);

    if (file.size > ticket.maxBytes) {
        throw new ApiError(`${kind === "VIDEO" ? "Videos" : "Photos"} must be ${mb(ticket.maxBytes)} or smaller`);
    }

    const form = new FormData();
    Object.entries(ticket.fields).forEach(([key, value]) => form.append(key, value));
    form.append("file", file);

    if (ticket.provider === "cloudinary") {
        const uploaded = await send(ticket.uploadUrl, form, { onProgress });
        return {
            provider: "cloudinary",
            kind,
            publicId: uploaded.public_id,
            version: uploaded.version,
            signature: uploaded.signature,
            format: uploaded.format,
            width: uploaded.width,
            height: uploaded.height,
            duration: uploaded.duration ?? details.duration,
            bytes: uploaded.bytes
        };
    }

    const upload = () =>
        send(`${API_BASE}${ticket.uploadUrl}?club=${encodeURIComponent(clubId)}`, form, {
            headers: { Authorization: `Bearer ${getAccessToken()}` },
            onProgress
        });
    let uploaded;
    try {
        uploaded = await upload();
    } catch (error) {
        if (error.status !== 401) {
            throw error;
        }
        await refreshSession();
        uploaded = await upload();
    }
    return { ...uploaded.data, width: details.width, height: details.height, duration: details.duration };
};

// ---------------------------------------------------------------- Preloading

// Keeps the next few stories' files warm in the browser cache so they open instantly.
const warm = new Map();
const WARM_LIMIT = 12;

export const preloadStory = (story) => {
    if (!story || typeof document === "undefined" || warm.has(story.url)) {
        return;
    }
    let element;
    if (story.kind === "VIDEO") {
        element = document.createElement("video");
        element.preload = "auto";
        element.muted = true;
        element.src = story.url;
        try {
            element.load();
        } catch {
            // Not supported in this environment.
        }
        if (story.poster) {
            new Image().src = story.poster;
        }
    } else {
        element = new Image();
        element.decoding = "async";
        element.src = story.url;
    }
    warm.set(story.url, element);

    if (warm.size > WARM_LIMIT) {
        const [oldestUrl, oldest] = warm.entries().next().value;
        if (oldest instanceof HTMLVideoElement) {
            oldest.removeAttribute("src");
        }
        warm.delete(oldestUrl);
    }
};

export const firstUnseenIndex = (group) => {
    const index = group.stories.findIndex((story) => !story.seen);
    return index === -1 ? 0 : index;
};
