const mongoose = require("mongoose");

// A user's bell for one club. Without a record, club members count as subscribed and everyone
// else as not subscribed; a record stores an explicit choice either way.
const clubSubscriptionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        enabled: {
            type: Boolean,
            required: true
        }
    },
    { timestamps: true }
);

clubSubscriptionSchema.index({ user: 1, club: 1 }, { unique: true });
clubSubscriptionSchema.index({ club: 1, enabled: 1 });

module.exports = mongoose.model("ClubSubscription", clubSubscriptionSchema);
