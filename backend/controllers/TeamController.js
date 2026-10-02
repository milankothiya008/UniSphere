const teamService = require("../services/TeamService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const candidates = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Students fetched", await teamService.searchCandidates(req.user, req.params.id, req.query.search));
});

const invite = asyncHandler(async (req, res) => {
    const team = await teamService.inviteMembers(req.user, req.params.id, req.body.users);
    sendSuccess(res, 200, "Invites sent", team);
});

const removeMember = asyncHandler(async (req, res) => {
    const team = await teamService.removeMember(req.user, req.params.id, req.params.userId);
    sendSuccess(res, 200, "Team updated", team);
});

const accept = asyncHandler(async (req, res) => {
    const result = await teamService.respondToInvite(req.user, req.params.id, req.params.teamId, true, req.body);
    sendSuccess(res, 200, result.waitlisted ? "You joined the team. The team is on the waitlist." : "You joined the team and are registered", result);
});

const decline = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Invite declined", await teamService.respondToInvite(req.user, req.params.id, req.params.teamId, false));
});

const myInvites = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Team invites fetched", await teamService.invitesFor(req.user));
});

module.exports = { candidates, invite, removeMember, accept, decline, myInvites };
