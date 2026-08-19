const mongoose = require("mongoose");

const clubSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            unique: true
        },

        description: {
            type: String,
            required: true,
            trim: true
        },

        category: {
            type: String,
            required: true,
            enum: [
                "TECHNOLOGY",
                "SPORTS",
                "CULTURAL",
                "LITERARY",
                "MUSIC",
                "ART",
                "SOCIAL_SERVICE",
                "ENTREPRENEURSHIP",
                "OTHER"
            ]
        },

        logo: {
            type: String,
            default: null
        },

        president: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        status: {
            type: String,
            enum: ["PENDING", "ACTIVE", "INACTIVE"],
            default: "PENDING"
        }
    },
    {
        timestamps: true
    }
);

const Club = mongoose.model("Club", clubSchema);

module.exports = Club;