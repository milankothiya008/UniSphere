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
        }
    },
    { timestamps: true }
);

eventRegistrationSchema.index({ event: 1, user: 1 }, { unique: true });
eventRegistrationSchema.index({ user: 1, status: 1 });
eventRegistrationSchema.index({ event: 1, status: 1 });

module.exports = mongoose.model("EventRegistration", eventRegistrationSchema);
