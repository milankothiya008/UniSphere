const mongoose = require("mongoose");
const { REGISTRATION_STATUS } = require("../constants/Statuses");

const eventRegistrationSchema = new mongoose.Schema(
    {
        event: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Event",
            required: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        status: {
            type: String,
            enum: Object.values(REGISTRATION_STATUS),
            default: REGISTRATION_STATUS.REGISTERED
        },
        registeredAt: {
            type: Date,
            default: Date.now
        },
        // Queue order for WAITLISTED registrations (first in, first promoted).
        waitlistedAt: {
            type: Date,
            default: null
        },
        // Set when a waitlisted student was moved into a freed seat.
        promotedAt: {
            type: Date,
            default: null
        },
        // Team events: the team this registration belongs to. The leader's registration holds the team's
        // place (and its spot in the waitlist); members' registrations follow the leader's status.
        team: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Team",
            default: null
        },
        teamRole: {
            type: String,
            enum: ["LEADER", "MEMBER", null],
            default: null
        }
    },
    { timestamps: true }
);

eventRegistrationSchema.index({ event: 1, user: 1 }, { unique: true });
eventRegistrationSchema.index({ user: 1, status: 1 });
eventRegistrationSchema.index({ event: 1, status: 1 });
eventRegistrationSchema.index({ event: 1, status: 1, waitlistedAt: 1 });
eventRegistrationSchema.index({ team: 1, status: 1 });

module.exports = mongoose.model("EventRegistration", eventRegistrationSchema);
