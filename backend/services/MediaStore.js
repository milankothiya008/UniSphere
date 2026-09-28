const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { env } = require("../config/env");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const logger = require("../utils/Logger");
const { detectImage } = require("./StorageService");

// Photo and video storage shared by club stories and event galleries. Production uses Cloudinary: the
// browser uploads straight to it with a short-lived signature from this API, and viewers load the files
// from Cloudinary's CDN, so media bytes never pass through this server or the database. Without Cloudinary
// credentials files go to UPLOAD_DIR instead (development).
//
// Each store is scoped (a club for stories, an event for galleries): an upload is issued to one user for
// one scope and can only be attached there by that user.

const KINDS = { IMAGE: "IMAGE", VIDEO: "VIDEO" };
const FORMATS = { IMAGE: ["jpg", "jpeg", "png", "webp"], VIDEO: ["mp4", "mov", "webm"] };
const TICKET_TTL_SECONDS = 60 * 60;

const useCloudinary = () => Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

const providerName = () => (useCloudinary() ? "cloudinary" : "local");

const uploadError = (message, status = 400) => new AppError(message, status, ERROR_CODES.UPLOAD_ERROR);

// Cloudinary signature: parameters sorted by name, joined as a query string, followed by the API secret.
const signParams = (params) => {
    const payload = Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&");
    return crypto.createHash("sha1").update(`${payload}${env.cloudinary.apiSecret}`).digest("hex");
};

const safeEqual = (a, b) => {
    const left = Buffer.from(String(a || ""));
    const right = Buffer.from(String(b || ""));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const cloudinaryUrl = (resource, transform, version, publicId, extension = "") =>
    `https://res.cloudinary.com/${env.cloudinary.cloudName}/${resource}/upload/${transform}/v${version}/${publicId}${extension}`;

// Adds a transformation to an existing Cloudinary delivery URL (e.g. an event poster); other URLs are returned as is.
const transformUrl = (url, transform) => {
    const match = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(String(url || ""));
    return match ? `${match[1]}${transform}/${match[2]}` : url;
};

const detectVideo = (buffer) => {
    if (!buffer || buffer.length < 12) {
        return null;
    }
    if (buffer.toString("ascii", 4, 8) === "ftyp") {
        const brand = buffer.toString("ascii", 8, 12);
        return brand === "qt  " ? { ext: "mov", mime: "video/quicktime" } : { ext: "mp4", mime: "video/mp4" };
    }
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return { ext: "webm", mime: "video/webm" };
    }
    return null;
};

/**
 * config:
 *   name          label for logs ("Story", "Gallery")
 *   scopeLabel    what an upload is issued for, used in errors ("club", "event")
 *   folder        (scopeId) => Cloudinary folder
 *   localDir      folder under UPLOAD_DIR
 *   macPurpose / localPurpose   HMAC key suffixes (keep stable: they sign uploads in flight)
 *   tag           Cloudinary tag
 *   limits        () => { maxImageBytes, maxVideoBytes, maxVideoSeconds }
 *   transforms    { image, thumb, video: () => string, videoPoster, videoThumb }
 *   localUploadUrl (scopeId) => API path the browser posts files to in development
 */
const createMediaStore = (config) => {
    const limits = () => config.limits();
    const maxBytesFor = (kind) => (kind === KINDS.VIDEO ? limits().maxVideoBytes : limits().maxImageBytes);
    const notIssued = () => uploadError(`This upload was not issued for this ${config.scopeLabel}`);

    // ------------------------------------------------------------ Cloudinary

    // The public ID carries a MAC of (scope, user, nonce), so a finished upload can only be attached by the
    // person it was issued to, in the scope it was issued for.
    const idMac = (scopeId, userId, nonce) =>
        crypto.createHmac("sha256", `${env.jwtAccessSecret}:${config.macPurpose}`).update(`${scopeId}:${userId}:${nonce}`).digest("hex").slice(0, 20);

    const issuePublicId = (scopeId, userId) => {
        const nonce = crypto.randomBytes(8).toString("hex");
        return `${config.folder(scopeId)}/${nonce}_${idMac(scopeId, userId, nonce)}`;
    };

    const publicIdIssuedTo = (publicId, scopeId, userId) => {
        const prefix = `${config.folder(scopeId)}/`;
        if (typeof publicId !== "string" || !publicId.startsWith(prefix)) {
            return false;
        }
        const [nonce, mac, extra] = publicId.slice(prefix.length).split("_");
        return Boolean(nonce && mac && extra === undefined && safeEqual(mac, idMac(scopeId, userId, nonce)));
    };

    const cloudinaryTicket = (scopeId, userId, kind) => {
        const params = {
            allowed_formats: FORMATS[kind].join(","),
            public_id: issuePublicId(scopeId, userId),
            tags: config.tag,
            timestamp: Math.floor(Date.now() / 1000)
        };
        if (kind === KINDS.VIDEO) {
            // Video derivatives are generated at upload so the first viewer doesn't wait for transcoding;
            // the strings must match the delivery URLs exactly for Cloudinary to reuse them.
            params.eager = `${config.transforms.video()}/mp4|${config.transforms.videoPoster}/jpg`;
            params.eager_async = "true";
        }

        const resource = kind === KINDS.VIDEO ? "video" : "image";
        return {
            provider: "cloudinary",
            kind,
            uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${resource}/upload`,
            fields: { ...params, api_key: env.cloudinary.apiKey, signature: signParams(params) },
            maxBytes: maxBytesFor(kind),
            maxVideoSeconds: limits().maxVideoSeconds,
            expiresIn: TICKET_TTL_SECONDS
        };
    };

    const clampDuration = (kind, duration) =>
        kind === KINDS.VIDEO ? Math.min(Number(duration) || limits().maxVideoSeconds, limits().maxVideoSeconds) : null;

    // Checks the upload response the browser got back from Cloudinary. Cloudinary signs public_id + version
    // with our API secret, so a forged or altered response is rejected.
    const verifyCloudinaryUpload = (media, scopeId, userId) => {
        const { publicId, version, signature, kind, format } = media || {};
        const numericVersion = Number(version);

        if (!Object.values(KINDS).includes(kind) || !Number.isInteger(numericVersion) || numericVersion <= 0) {
            throw uploadError("Upload details are incomplete");
        }
        if (!publicIdIssuedTo(publicId, String(scopeId), String(userId))) {
            throw notIssued();
        }
        if (!safeEqual(signature, signParams({ public_id: publicId, version: numericVersion }))) {
            throw uploadError("The upload could not be verified");
        }
        if (format && !FORMATS[kind].includes(String(format).toLowerCase())) {
            throw uploadError("Unsupported file format");
        }

        return {
            kind,
            provider: "cloudinary",
            key: publicId,
            version: numericVersion,
            format: format ? String(format).toLowerCase() : null,
            width: Number(media.width) || null,
            height: Number(media.height) || null,
            duration: clampDuration(kind, media.duration),
            bytes: Number(media.bytes) || null
        };
    };

    const destroyCloudinary = async (media) => {
        const params = { invalidate: "true", public_id: media.key, timestamp: Math.floor(Date.now() / 1000) };
        const form = new FormData();
        Object.entries({ ...params, api_key: env.cloudinary.apiKey, signature: signParams(params) }).forEach(([key, value]) => form.append(key, String(value)));

        const resource = media.kind === KINDS.VIDEO ? "video" : "image";
        const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${resource}/destroy`, { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        // "not found" means it is already gone, which is what we want.
        if (!response.ok || !["ok", "not found"].includes(payload.result)) {
            throw new Error(`Cloudinary destroy failed (${response.status} ${payload.result || payload.error?.message || ""})`);
        }
    };

    // ------------------------------------------------------------ Local storage (development)

    // Local uploads come back as a signed token describing the saved file, which is then attached with it.
    const signLocal = (payload) => crypto.createHmac("sha256", `${env.jwtAccessSecret}:${config.localPurpose}`).update(payload).digest("base64url");

    const localToken = (details) => {
        const payload = Buffer.from(JSON.stringify(details)).toString("base64url");
        return `${payload}.${signLocal(payload)}`;
    };

    const readLocalToken = (token) => {
        const [payload, signature] = String(token || "").split(".");
        if (!payload || !signature || !safeEqual(signature, signLocal(payload))) {
            return null;
        }
        try {
            return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        } catch {
            return null;
        }
    };

    const localTicket = (scopeId, kind) => ({
        provider: "local",
        kind,
        uploadUrl: config.localUploadUrl(scopeId),
        fields: {},
        maxBytes: maxBytesFor(kind),
        maxVideoSeconds: limits().maxVideoSeconds,
        expiresIn: TICKET_TTL_SECONDS
    });

    const saveLocalFile = async (file, scopeId, userId) => {
        if (!file?.buffer) {
            throw uploadError("A photo or video is required");
        }

        const image = detectImage(file.buffer);
        const video = image ? null : detectVideo(file.buffer);
        const detected = image || video;
        if (!detected) {
            throw uploadError("Only JPEG, PNG or WebP photos and MP4, MOV or WebM videos are allowed");
        }

        const kind = image ? KINDS.IMAGE : KINDS.VIDEO;
        if (file.buffer.length > maxBytesFor(kind)) {
            throw uploadError(`${kind === KINDS.VIDEO ? "Videos" : "Photos"} must be ${Math.round(maxBytesFor(kind) / (1024 * 1024))} MB or smaller`, 413);
        }

        const relative = `${config.localDir}/${scopeId}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${detected.ext}`;
        const target = path.join(env.uploadDir, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.buffer);

        const details = { k: relative, t: kind, f: detected.ext, b: file.buffer.length, c: String(scopeId), u: String(userId), x: Date.now() + TICKET_TTL_SECONDS * 1000 };
        return { token: localToken(details), kind, bytes: file.buffer.length, format: detected.ext };
    };

    const verifyLocalUpload = (media, scopeId, userId) => {
        const details = readLocalToken(media?.token);
        if (!details || details.c !== String(scopeId) || details.u !== String(userId)) {
            throw notIssued();
        }
        if (details.x < Date.now()) {
            throw uploadError("This upload has expired — please add the file again");
        }
        if (!details.k.startsWith(`${config.localDir}/${scopeId}/`) || details.k.includes("..")) {
            throw uploadError("Invalid upload");
        }

        return {
            kind: details.t,
            provider: "local",
            key: details.k,
            format: details.f,
            width: Number(media.width) || null,
            height: Number(media.height) || null,
            duration: clampDuration(details.t, media.duration),
            bytes: details.b
        };
    };

    const localUrl = (key) => `${env.publicApiUrl}/uploads/${key}`;

    const removeLocal = async (key) => {
        if (!key.startsWith(`${config.localDir}/`) || key.includes("..")) {
            return;
        }
        await fs.rm(path.join(env.uploadDir, key), { force: true });
    };

    // ------------------------------------------------------------ Shared

    const createUploadTicket = (scopeId, userId, kind) => (useCloudinary() ? cloudinaryTicket(scopeId, userId, kind) : localTicket(scopeId, kind));

    const verifyUpload = (media, scopeId, userId) => {
        if (media?.provider === "cloudinary") {
            if (!useCloudinary()) {
                throw uploadError("Cloud media storage is not configured");
            }
            return verifyCloudinaryUpload(media, scopeId, userId);
        }
        if (media?.provider === "local") {
            return verifyLocalUpload(media, scopeId, userId);
        }
        throw uploadError("Unknown media storage");
    };

    // Viewer-facing URLs, built from the stored details on every read (no media lookups).
    const mediaUrls = (media) => {
        const { transforms } = config;
        if (media.provider === "cloudinary") {
            if (media.kind === KINDS.VIDEO) {
                return {
                    url: cloudinaryUrl("video", transforms.video(), media.version, media.key, ".mp4"),
                    poster: cloudinaryUrl("video", transforms.videoPoster, media.version, media.key, ".jpg"),
                    thumb: cloudinaryUrl("video", `so_0,${transforms.thumb}`, media.version, media.key, ".jpg")
                };
            }
            return {
                url: cloudinaryUrl("image", transforms.image, media.version, media.key),
                poster: null,
                thumb: cloudinaryUrl("image", transforms.thumb, media.version, media.key)
            };
        }
        if (media.provider === "event") {
            return { url: transformUrl(media.key, transforms.image), poster: null, thumb: transformUrl(media.key, transforms.thumb) };
        }
        const url = localUrl(media.key);
        return { url, poster: null, thumb: media.kind === KINDS.IMAGE ? url : null };
    };

    // Removes a file from storage. Event posters shared into stories belong to the event and are never deleted here.
    const deleteMedia = async (media) => {
        if (media.provider === "cloudinary") {
            if (!useCloudinary()) {
                throw new Error(`Cloudinary is not configured, cannot remove ${config.name.toLowerCase()} media`);
            }
            return destroyCloudinary(media);
        }
        if (media.provider === "local") {
            return removeLocal(media.key);
        }
        return undefined;
    };

    const deleteMediaQuietly = async (media) => {
        try {
            await deleteMedia(media);
            return true;
        } catch (error) {
            logger.warn(`${config.name} media cleanup failed`, { provider: media.provider, key: media.key, message: error.message });
            return false;
        }
    };

    return {
        KINDS,
        FORMATS,
        providerName,
        maxBytesFor,
        createUploadTicket,
        saveLocalFile,
        verifyUpload,
        mediaUrls,
        transformUrl,
        deleteMedia,
        deleteMediaQuietly,
        // Exposed for tests.
        signParams,
        issuePublicId,
        publicIdIssuedTo,
        detectVideo
    };
};

module.exports = { createMediaStore, KINDS, FORMATS, signParams, transformUrl, detectVideo, providerName };
