const mongoose = require("mongoose");
const { FEED_POST_TYPES, FEED_VISIBILITY, ANNOUNCEMENT_AUDIENCE } = require("../constants/Statuses");

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
        },
        // Who the announcement was sent to (services/AudienceService). Chosen people are kept only as a count.
        audience: {
            type: new mongoose.Schema(
                {
                    mode: { type: String, enum: Object.values(ANNOUNCEMENT_AUDIENCE), default: ANNOUNCEMENT_AUDIENCE.EVERYONE },
                    roles: { type: [String], default: [] },
                    departments: { type: [String], default: [] },
                    batches: { type: [String], default: [] },
                    people: { type: Number, default: 0 },
                    includeMentor: { type: Boolean, default: false },
                    label: { type: String, default: null }
                },
                { _id: false }
            ),
            default: null
        },
        // AUDIENCE posts: everyone it was sent to, so only they (and the club's team) can see it.
        recipients: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: undefined, select: false },
        recipientCount: { type: Number, default: null }
    },
    { timestamps: true }
);

feedPostSchema.index({ createdAt: -1 });
feedPostSchema.index({ recipients: 1, createdAt: -1 }, { sparse: true });
feedPostSchema.index({ club: 1, createdAt: -1 });
feedPostSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("FeedPost", feedPostSchema);
