const mongoose = require("mongoose");

// An issued certificate. Names and titles are copied at issue time, so a certificate still verifies the
// same way if the event or club is renamed later. Anyone can check one at /verify/<code>.
const certificateSchema = new mongoose.Schema(
    {
        code: { type: String, required: true, unique: true },
        event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // PARTICIPATION for checked-in participants, MERIT for award winners.
        kind: { type: String, enum: ["PARTICIPATION", "MERIT"], required: true },
        recipientName: { type: String, required: true },
        eventTitle: { type: String, required: true },
        clubName: { type: String, required: true },
        eventStartAt: { type: Date, required: true },
        eventEndAt: { type: Date, required: true },
        awardTitle: { type: String, default: null },
        teamName: { type: String, default: null },
        issuedAt: { type: Date, default: Date.now },
        // Set if the basis disappears (attendance unmarked, award withdrawn): the code then shows as revoked.
        revokedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

certificateSchema.index({ event: 1, user: 1, kind: 1 }, { unique: true });
certificateSchema.index({ user: 1, issuedAt: -1 });

module.exports = mongoose.model("Certificate", certificateSchema);
