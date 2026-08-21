const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            validate: {
                validator: function (value) {
                    return value.endsWith("@ddu.ac.in");
                },
                message: "Only @ddu.ac.in email addresses are allowed"
            }
        },

        password: {
            type: String,
            required: true
        },

        role: {
            type: String,
            enum: ["student", "coordinator", "admin"],
            default: "student"
        }
    },
    {
        timestamps: true
    }
);

const User = mongoose.model("User", userSchema);

module.exports = User;