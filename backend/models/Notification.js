const mongoose = require("mongoose");
const { NOTIFICATION_TYPES } = require("../constants/Statuses");

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        type: {
            type: String,
            enum: Object.values(NOTIFICATION_TYPES),
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        message: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: ""
        },
        link: {
            type: String,
            default: null
        },
        readAt: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, readAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
