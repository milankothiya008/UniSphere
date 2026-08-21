const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Event name is required"],
            trim: true
        },

        description: {
            type: String,
            required: [true, "Event description is required"],
            trim: true
        },

        date: {
            type: Date,
            required: [true, "Event date is required"]
        },

        time: {
            type: String,
            required: [true, "Event time is required"],
            trim: true
        },

        venue: {
            type: String,
            required: [true, "Event venue is required"],
            trim: true
        },

        registrationDeadline: {
            type: Date,
            required: [true, "Registration deadline is required"]
        },

        bannerImage: {
            type: String,
            default: null
        },

        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: [true, "Club is required"]
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Event creator is required"]
        },

        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"],
            default: "PENDING"
        },

        maxAttendees: {
            type: Number,
            default: null
        },

        registeredUsers: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            }
        ]
    },
    {
        timestamps: true
    }
);


// Registration deadline must be before event date
eventSchema.pre("validate", function (next) {
    if (this.registrationDeadline && this.date) {
        if (this.registrationDeadline >= this.date) {
            this.invalidate(
                "registrationDeadline",
                "Registration deadline must be before the event date"
            );
        }
    }
    next();
});


const Event = mongoose.model("Event", eventSchema);

module.exports = Event;
