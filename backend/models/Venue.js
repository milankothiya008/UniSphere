const mongoose = require("mongoose");
const { VENUE_STATUS, VENUE_TYPES } = require("../constants/Statuses");

const venueSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            maxlength: 120
        },
        location: {
            type: String,
            required: true,
            trim: true
        },
        capacity: {
            type: Number,
            required: true,
            min: 1
        },
        type: {
            type: String,
            enum: Object.values(VENUE_TYPES),
            default: VENUE_TYPES.HALL
        },
        // Labs only: the departments whose events may book it.
        departmentCodes: {
            type: [String],
            default: []
        },
        status: {
            type: String,
            enum: Object.values(VENUE_STATUS),
            default: VENUE_STATUS.ACTIVE
        },
        // Short-lived lock taken while an event claims this venue (see VenueService.withVenueLock).
        bookingLock: {
            type: String,
            select: false,
            default: null
        },
        bookingLockExpires: {
            type: Date,
            select: false,
            default: null
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Venue", venueSchema);
