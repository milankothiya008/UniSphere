const mongoose = require("mongoose");
const { VENUE_STATUS } = require("../constants/Statuses");

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
        status: {
            type: String,
            enum: Object.values(VENUE_STATUS),
            default: VENUE_STATUS.ACTIVE
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Venue", venueSchema);
