const mongoose = require("mongoose");

// "This member has voted in this election" — and nothing else. The choice itself is only added to the
// candidate's count (ClubElection.candidates.votes), so a ballot can't be traced back to a vote; and the
// counts stay hidden until voting closes, so watching them change can't give a vote away either.
const electionBallotSchema = new mongoose.Schema(
    {
        election: { type: mongoose.Schema.Types.ObjectId, ref: "ClubElection", required: true },
        voter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
    },
    { timestamps: false, versionKey: false }
);

electionBallotSchema.index({ election: 1, voter: 1 }, { unique: true });

module.exports = mongoose.model("ElectionBallot", electionBallotSchema);
