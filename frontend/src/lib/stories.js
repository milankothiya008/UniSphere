import { storyApi } from "../api/endpoints";
import { MEDIA_TYPES, inspectMediaFile, mediaKindOf, uploadWithTicket } from "./mediaUpload";

// Limits checked in the browser before uploading; the server enforces its own (sent with each upload ticket).
export const STORY_LIMITS = {
    imageTypes: MEDIA_TYPES.image,
    videoTypes: MEDIA_TYPES.video,
    maxImageBytes: 10 * 1024 * 1024,
    maxVideoBytes: 40 * 1024 * 1024,
    maxVideoSeconds: 30,
    captionLength: 200
};

// Seconds a photo stays on screen.
export const IMAGE_SECONDS = 6;

export const storyKindOf = mediaKindOf;

// Reads a picked file's size and, for videos, its length, without uploading anything.
export const inspectStoryFile = (file) => inspectMediaFile(file, STORY_LIMITS);

/**
 * Uploads a story photo or video and returns the media reference to post the story with.
 * With cloud storage the file goes straight from the browser to Cloudinary (never through our API);
 * in development it goes to the API's local storage.
 */
export const uploadStoryMedia = async (file, clubId, { details = {}, onProgress } = {}) => {
    const { data: ticket } = await storyApi.uploadTicket(clubId, mediaKindOf(file));
    return uploadWithTicket(file, ticket, { localPath: `${ticket.uploadUrl}?club=${encodeURIComponent(clubId)}`, details, onProgress });
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
