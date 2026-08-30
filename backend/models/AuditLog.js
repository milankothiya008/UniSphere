const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true
        },
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        targetType: {
            type: String,
            required: true
        },
        targetId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        fromState: {
            type: String,
            default: null
        },
        toState: {
            type: String,
            default: null
        },
        reason: {
            type: String,
            default: null
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
