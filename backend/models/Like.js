const mongoose = require("mongoose");

// A like (♥) on an event post, a gallery photo/video or a club story. Counts are kept on the item itself.
const likeSchema = new mongoose.Schema(
    {
        targetType: { type: String, enum: ["EVENT", "MEDIA", "STORY"], required: true },
        target: { type: mongoose.Schema.Types.ObjectId, required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
    },
    { timestamps: true }
);

likeSchema.index({ targetType: 1, target: 1, user: 1 }, { unique: true });
likeSchema.index({ user: 1, targetType: 1, target: 1 });
likeSchema.index({ targetType: 1, target: 1, createdAt: -1 });

module.exports = mongoose.model("Like", likeSchema);
