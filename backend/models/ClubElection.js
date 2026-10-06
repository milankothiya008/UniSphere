const mongoose = require("mongoose");
const { ELECTION_STATUS } = require("../constants/Statuses");

// An anonymous vote among a club's members for one of its roles (e.g. a new president when the old one
// leaves or the academic year ends). The organiser picks the candidates; the result is advisory — the
// president still appoints the role. Votes are counted on the candidates themselves and never stored
// with the voter: ElectionBallot only records *that* someone voted, so nobody can see who chose whom.

const candidateSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // A short pitch the organiser can add ("Ran the tech fest last year").
        statement: { type: String, trim: true, maxlength: 300, default: "" },
        // Hidden until voting closes.
        votes: { type: Number, default: 0, min: 0 }
    },
    { _id: false }
);

const clubElectionSchema = new mongoose.Schema(
    {
        club: { type: mongoose.Schema.Types.ObjectId, ref: "Club", required: true },
        // The club role being decided (key) and its name when the election was created.
        role: { type: String, required: true },
        roleName: { type: String, required: true, trim: true, maxlength: 80 },
        title: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, trim: true, maxlength: 1000, default: "" },
        candidates: { type: [candidateSchema], default: [] },
        opensAt: { type: Date, required: true },
        closesAt: { type: Date, required: true },
        status: { type: String, enum: Object.values(ELECTION_STATUS), default: ELECTION_STATUS.SCHEDULED },
        // How many members could vote (fixed when voting opens) and how many did.
        eligibleCount: { type: Number, default: 0 },
        votesCast: { type: Number, default: 0 },
        // A second vote among candidates who tied.
        runoffOf: { type: mongoose.Schema.Types.ObjectId, ref: "ClubElection", default: null },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        closedAt: { type: Date, default: null },
        closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        cancelledAt: { type: Date, default: null },
        cancelReason: { type: String, trim: true, maxlength: 300, default: "" }
    },
    { timestamps: true }
);

clubElectionSchema.index({ club: 1, createdAt: -1 });
clubElectionSchema.index({ status: 1, opensAt: 1 });
clubElectionSchema.index({ status: 1, closesAt: 1 });

module.exports = mongoose.model("ClubElection", clubElectionSchema);
