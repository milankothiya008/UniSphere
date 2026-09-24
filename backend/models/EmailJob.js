const mongoose = require("mongoose");
const { EMAIL_JOB_STATUS, EMAIL_CATEGORIES } = require("../constants/EmailCategories");

// Outgoing email waiting to be delivered by the background worker (services/EmailQueueService).
const emailJobSchema = new mongoose.Schema(
    {
        to: { type: String, required: true, lowercase: true, trim: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        category: { type: String, enum: Object.values(EMAIL_CATEGORIES), required: true },
        subject: { type: String, required: true },
        html: { type: String, required: true },
        text: { type: String, required: true },
        headers: { type: Map, of: String, default: undefined },
        // Lower goes first: account emails before marketing.
        priority: { type: Number, default: 5 },
        // Same key twice means the same email for the same person; the second copy is dropped.
        dedupeKey: { type: String, default: undefined },
        status: { type: String, enum: Object.values(EMAIL_JOB_STATUS), default: EMAIL_JOB_STATUS.PENDING },
        attempts: { type: Number, default: 0 },
        nextAttemptAt: { type: Date, default: Date.now },
        lockedAt: { type: Date, default: null },
        sentAt: { type: Date, default: null },
        // Set once the job is delivered or given up on; drives the clean-up index below.
        finishedAt: { type: Date, default: null },
        lastError: { type: String, default: null }
    },
    { timestamps: true }
);

emailJobSchema.index({ status: 1, priority: 1, nextAttemptAt: 1 });
emailJobSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });
// Delivered and failed jobs are kept for 30 days for troubleshooting, then removed.
emailJobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("EmailJob", emailJobSchema);
