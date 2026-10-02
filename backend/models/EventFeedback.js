const mongoose = require("mongoose");

// A participant's rating (1-5 stars) and optional note after an event. The club sees the notes without
// names, so students can be honest.
const eventFeedbackSchema = new mongoose.Schema(
    {
        event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        note: { type: String, trim: true, maxlength: 1000, default: "" }
    },
    { timestamps: true }
);

eventFeedbackSchema.index({ event: 1, user: 1 }, { unique: true });
eventFeedbackSchema.index({ club: 1, createdAt: -1 });

module.exports = mongoose.model("EventFeedback", eventFeedbackSchema);
