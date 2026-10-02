const hackathons = require("../services/HackathonService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const ok = (message, run) => asyncHandler(async (req, res) => sendSuccess(res, 200, message, await run(req)));

module.exports = {
    get: ok("Hackathon fetched", (req) => hackathons.getHackathon(req.user, req.params.id)),
    updateSettings: ok("Hackathon settings saved", (req) => hackathons.updateSettings(req.user, req.params.id, req.body)),
    addProblem: ok("Problem statement added", (req) => hackathons.addProblem(req.user, req.params.id, req.body)),
    updateProblem: ok("Problem statement updated", (req) => hackathons.updateProblem(req.user, req.params.id, req.params.problemId, req.body)),
    deleteProblem: ok("Problem statement removed", (req) => hackathons.deleteProblem(req.user, req.params.id, req.params.problemId)),
    addJudge: ok("Judge added", (req) => hackathons.addJudge(req.user, req.params.id, req.body.userId)),
    removeJudge: ok("Judge removed", (req) => hackathons.removeJudge(req.user, req.params.id, req.params.userId)),
    chooseProblem: ok("Problem statement chosen", (req) => hackathons.chooseProblem(req.user, req.params.id, req.body.problemId)),
    submitProject: ok("Project submitted", (req) => hackathons.submitProject(req.user, req.params.id, req.body)),
    judging: ok("Judging panel fetched", (req) => hackathons.listForJudging(req.user, req.params.id)),
    score: ok("Score saved", (req) => hackathons.scoreEntry(req.user, req.params.id, req.params.entryId, req.body)),
    leaderboard: ok("Leaderboard fetched", (req) => hackathons.getLeaderboard(req.user, req.params.id)),
    draftResults: ok("Results draft prepared — the president can review and publish it", (req) => hackathons.draftResults(req.user, req.params.id, req.body))
};
