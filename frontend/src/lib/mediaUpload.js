import { API_BASE, ApiError, getAccessToken, refreshSession } from "../api/client";

// Shared by story and gallery uploads: checking a picked file in the browser, then sending it with an
// upload ticket from the API — straight to Cloudinary in production, to the API's own storage in development.

export const MEDIA_TYPES = {
    image: ["image/jpeg", "image/png", "image/webp"],
    video: ["video/mp4", "video/quicktime", "video/webm"]
};

export const ACCEPT_MEDIA = [...MEDIA_TYPES.image, ...MEDIA_TYPES.video].join(",");

export const mediaKindOf = (file) => (MEDIA_TYPES.image.includes(file?.type) ? "IMAGE" : MEDIA_TYPES.video.includes(file?.type) ? "VIDEO" : null);

export const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Reads a picked file's size, dimensions and, for videos, its length, without uploading anything.
 * limits: { maxImageBytes, maxVideoBytes, maxVideoSeconds }. Resolves to { kind, url, width, height, duration } or { error }.
 */
export const inspectMediaFile = (file, limits) =>
    new Promise((resolve) => {
        const kind = mediaKindOf(file);
        if (!kind) {
            resolve({ error: "Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video" });
            return;
        }
        const limit = kind === "VIDEO" ? limits.maxVideoBytes : limits.maxImageBytes;
        if (file.size > limit) {
            resolve({ error: `${kind === "VIDEO" ? "Videos" : "Photos"} must be ${megabytes(limit)} or smaller` });
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
            if (duration && duration > limits.maxVideoSeconds + 0.5) {
                URL.revokeObjectURL(url);
                resolve({ error: `Videos can be up to ${limits.maxVideoSeconds} seconds long (this one is ${Math.round(duration)}s)` });
                return;
            }
            done({ duration, width: video.videoWidth, height: video.videoHeight });
        };
        video.onerror = () => done({});
        video.src = url;
    });

// XMLHttpRequest rather than fetch so uploads can report progress.
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
 * Sends one file using an upload ticket and returns the media reference to attach it with.
 * `localPath` is the API path for development storage (the ticket's uploadUrl, plus any query).
 */
export const uploadWithTicket = async (file, ticket, { localPath = ticket.uploadUrl, details = {}, onProgress } = {}) => {
    const kind = ticket.kind || mediaKindOf(file);
    if (file.size > ticket.maxBytes) {
        throw new ApiError(`${kind === "VIDEO" ? "Videos" : "Photos"} must be ${megabytes(ticket.maxBytes)} or smaller`);
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

    const upload = () => send(`${API_BASE}${localPath}`, form, { headers: { Authorization: `Bearer ${getAccessToken()}` }, onProgress });
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
