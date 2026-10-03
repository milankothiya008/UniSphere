const mongoose = require("mongoose");

// A message someone reported to the university admin. The text is copied in, so the report survives the
// sender unsending it.

const chatReportSchema = new mongoose.Schema(
    {
        message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", required: true },
        conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
        reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason: { type: String, trim: true, maxlength: 500, default: "" },
        text: { type: String, default: "" },
        attachmentCount: { type: Number, default: 0 },
        status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        resolvedAt: { type: Date, default: null },
        note: { type: String, trim: true, maxlength: 500, default: "" }
    },
    { timestamps: true }
);

chatReportSchema.index({ status: 1, createdAt: -1 });
chatReportSchema.index({ message: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model("ChatReport", chatReportSchema);
