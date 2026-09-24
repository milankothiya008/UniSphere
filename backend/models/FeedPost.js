const mongoose = require("mongoose");
const { FEED_POST_TYPES, FEED_VISIBILITY } = require("../constants/Statuses");

const feedPostSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: Object.values(FEED_POST_TYPES),
            required: true
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            default: null
        },
        result: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EventResult",
            default: null
        },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        body: {
            type: String,
            trim: true,
            maxlength: 4000,
            default: ""
        },
        image: {
            type: String,
            default: null
        },
        visibility: {
            type: String,
            enum: Object.values(FEED_VISIBILITY),
            default: FEED_VISIBILITY.PUBLIC
        },
        isSystem: {
            type: Boolean,
            default: false
        }
    },
    { timestamps: true }
);

feedPostSchema.index({ createdAt: -1 });
feedPostSchema.index({ club: 1, createdAt: -1 });
feedPostSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("FeedPost", feedPostSchema);
