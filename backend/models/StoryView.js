const mongoose = require("mongoose");

// One row per person who watched a story; the club's story managers see this list.
const storyViewSchema = new mongoose.Schema(
    {
        story: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Story",
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        viewedAt: {
            type: Date,
            default: Date.now
        },
        liked: {
            type: Boolean,
            default: false
        },
        likedAt: {
            type: Date,
            default: null
        }
    },
    { versionKey: false }
);

storyViewSchema.index({ story: 1, user: 1 }, { unique: true });
storyViewSchema.index({ user: 1, story: 1, liked: 1 });
storyViewSchema.index({ story: 1, viewedAt: -1 });
// Backstop only: views are deleted together with their story.
storyViewSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 });

module.exports = mongoose.model("StoryView", storyViewSchema);
