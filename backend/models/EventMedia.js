const mongoose = require("mongoose");
const { GALLERY_STATUS } = require("../constants/Statuses");

// A photo or video in an event's gallery. Like stories, only the description lives here: the file itself sits
// in media storage (Cloudinary in production) and is served from there. Rejected uploads are deleted outright.
const eventMediaSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        uploader: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        // How the uploader was allowed to add it: as a club member or as a checked-in participant.
        uploaderRole: {
            type: String,
            enum: ["MEMBER", "PARTICIPANT"],
            required: true
        },
        media: {
            kind: { type: String, enum: ["IMAGE", "VIDEO"], required: true },
            provider: { type: String, enum: ["cloudinary", "local"], required: true },
            // Cloudinary public ID or path under UPLOAD_DIR.
            key: { type: String, required: true },
            version: { type: Number, default: null },
            format: { type: String, default: null },
            width: { type: Number, default: null },
            height: { type: Number, default: null },
            duration: { type: Number, default: null },
            bytes: { type: Number, default: null }
        },
        status: {
            type: String,
            enum: Object.values(GALLERY_STATUS),
            default: GALLERY_STATUS.PENDING
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        reviewedAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

eventMediaSchema.index({ event: 1, status: 1, createdAt: -1 });
eventMediaSchema.index({ club: 1, status: 1 });
eventMediaSchema.index({ event: 1, uploader: 1, status: 1 });

module.exports = mongoose.model("EventMedia", eventMediaSchema);
