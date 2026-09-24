const mongoose = require("mongoose");

const STORY_MEDIA_KINDS = ["IMAGE", "VIDEO"];
// cloudinary: uploaded by the browser to Cloudinary; local: saved under UPLOAD_DIR (development);
// event: reuses the linked event's existing poster, which the story never deletes.
const STORY_MEDIA_PROVIDERS = ["cloudinary", "local", "event"];

// A club story lives for 24 hours. Only its description is stored here: the photo or video itself sits in
// media storage and is served to viewers from there (a CDN in production), never through this database.
const storySchema = new mongoose.Schema(
    {
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        media: {
            kind: { type: String, enum: STORY_MEDIA_KINDS, required: true },
            provider: { type: String, enum: STORY_MEDIA_PROVIDERS, required: true },
            // Cloudinary public ID, path under UPLOAD_DIR, or the event poster's URL.
            key: { type: String, required: true },
            version: { type: Number, default: null },
            format: { type: String, default: null },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
            duration: { type: Number, default: null },
            bytes: { type: Number, default: null }
        },
        caption: {
            type: String,
            trim: true,
            maxlength: 200,
            default: ""
        },
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            default: null
        },
        viewCount: {
            type: Number,
            default: 0,
            min: 0
        },
        likeCount: {
            type: Number,
            default: 0,
            min: 0
        },
        expiresAt: {
            type: Date,
            required: true
        },
        // Failed attempts to remove the media from storage after expiry (the sweeper gives up after a few).
        cleanupAttempts: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

storySchema.index({ expiresAt: 1, club: 1, createdAt: 1 });
storySchema.index({ club: 1, expiresAt: 1 });
// Backstop only: the sweeper normally deletes a story (and its media) within minutes of expiry.
storySchema.index({ expiresAt: 1 }, { name: "story_ttl_backstop", expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("Story", storySchema);
module.exports.STORY_MEDIA_KINDS = STORY_MEDIA_KINDS;
module.exports.STORY_MEDIA_PROVIDERS = STORY_MEDIA_PROVIDERS;
