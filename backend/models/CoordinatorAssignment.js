const mongoose = require("mongoose");

const coordinatorAssignmentSchema = new mongoose.Schema(
    {
        coordinator: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        club: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Club",
            required: true
        },
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

coordinatorAssignmentSchema.index({ coordinator: 1, club: 1 }, { unique: true });
coordinatorAssignmentSchema.index({ club: 1, isActive: 1 });

module.exports = mongoose.model("CoordinatorAssignment", coordinatorAssignmentSchema);
