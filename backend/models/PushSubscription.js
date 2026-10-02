const mongoose = require("mongoose");

// A browser/phone where a user switched on push notifications (Web Push). One user can have several.
const pushSubscriptionSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        endpoint: { type: String, required: true, unique: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true }
        },
        userAgent: { type: String, default: "", maxlength: 300 },
        lastSuccessAt: { type: Date, default: null },
        failures: { type: Number, default: 0 }
    },
    { timestamps: true }
);

pushSubscriptionSchema.index({ user: 1 });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
