const mongoose = require("mongoose");
const { TEAM_MEMBER_STATUS, TEAM_STATUS } = require("../constants/Statuses");
const { formAnswerSchema } = require("./FormSchemas");

// A team entered in a team event. The student who registers is the leader and holds the team's place;
// the students they invite join by accepting (each gets their own registration linked to the team).
const teamMemberSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        status: { type: String, enum: Object.values(TEAM_MEMBER_STATUS), required: true },
        invitedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null }
    },
    { _id: false }
);

const teamSchema = new mongoose.Schema(
    {
        event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
        name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
        // Lower-cased name: team names are unique within an event, ignoring case.
        nameKey: { type: String, required: true },
        leader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        members: { type: [teamMemberSchema], default: [] },
        // Leader plus accepted members; kept in step atomically so a team can never go over the size limit.
        size: { type: Number, default: 1, min: 0 },
        status: { type: String, enum: Object.values(TEAM_STATUS), default: TEAM_STATUS.ACTIVE },
        // The leader's answers to the registration form's "once per team" questions.
        answers: { type: [formAnswerSchema], default: [] },
        disbandedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

teamSchema.index({ event: 1, nameKey: 1 }, { unique: true, partialFilterExpression: { status: TEAM_STATUS.ACTIVE } });
teamSchema.index({ event: 1, status: 1 });
teamSchema.index({ "members.user": 1, "members.status": 1 });

module.exports = mongoose.model("Team", teamSchema);
