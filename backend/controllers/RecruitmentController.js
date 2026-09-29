const drives = require("../services/RecruitmentService");
const applications = require("../services/ApplicationService");
const rounds = require("../services/RecruitmentRoundService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const ok = (message, work, status = 200) =>
    asyncHandler(async (req, res) => {
        const data = await work(req);
        sendSuccess(res, status, typeof message === "function" ? message(data, req) : message, data);
    });

module.exports = {
    // Drives
    listOpen: ok("Recruitment fetched", (req) => drives.listOpenDrives(req.user)),
    listForClub: ok("Recruitment fetched", (req) => drives.listClubDrives(req.user, req.params.clubId)),
    listToReview: ok("Drives to review fetched", (req) => drives.listDrivesToReview(req.user)),
    create: ok("Recruitment drive saved as a draft", (req) => drives.createDrive(req.user, req.params.clubId, req.body), 201),
    get: ok("Recruitment drive fetched", (req) => drives.getDrive(req.user, req.params.id)),
    update: ok("Recruitment drive saved", (req) => drives.updateDrive(req.user, req.params.id, req.body)),
    remove: ok("Draft deleted", async (req) => {
        await drives.deleteDraft(req.user, req.params.id);
        return null;
    }),
    submit: ok("Sent to your faculty mentor for approval", (req) => drives.submitDrive(req.user, req.params.id)),
    approve: ok("Recruitment approved", (req) => drives.approveDrive(req.user, req.params.id, req.body.comment)),
    requestChanges: ok("Changes requested", (req) => drives.requestDriveChanges(req.user, req.params.id, req.body.comment)),
    reject: ok("Recruitment rejected", (req) => drives.rejectDrive(req.user, req.params.id, req.body.comment)),
    publish: ok("Recruitment published — eligible students are being notified", (req) => drives.publishDrive(req.user, req.params.id)),
    extend: ok("Deadline updated", (req) => drives.extendDeadline(req.user, req.params.id, req.body.applicationEnd)),
    close: ok("Applications closed", (req) => drives.closeApplications(req.user, req.params.id)),
    cancel: ok("Recruitment cancelled", (req) => drives.cancelDrive(req.user, req.params.id, req.body.reason)),
    complete: ok("Recruitment completed — everyone still waiting has been told", (req) => rounds.closeRecruitment(req.user, req.params.id)),

    // Applying (one application per role)
    mine: ok("Your applications fetched", (req) => applications.myApplications(req.user)),
    myApplications: ok("Your applications fetched", (req) => applications.getMyApplications(req.user, req.params.id)),
    myApplication: ok("Your application fetched", (req) => applications.getMyApplication(req.user, req.params.id, req.params.positionId)),
    apply: ok("Application submitted", (req) => applications.apply(req.user, req.params.id, req.params.positionId, req.body), 201),
    updateApplication: ok("Application updated", (req) => applications.updateMyApplication(req.user, req.params.id, req.params.positionId, req.body)),
    withdraw: ok("Application withdrawn", async (req) => {
        await applications.withdraw(req.user, req.params.id, req.params.positionId);
        return null;
    }),
    accept: ok("Offer accepted — welcome to the club!", (req) => applications.respondToOffer(req.user, req.params.id, req.params.applicationId, true)),
    decline: ok("Offer declined", (req) => applications.respondToOffer(req.user, req.params.id, req.params.applicationId, false)),
    uploadTickets: ok("Uploads ready", (req) => applications.createUploadTickets(req.user, req.params.id, req.body.kinds), 201),
    uploadLocal: ok("File uploaded", (req) => applications.uploadLocalFile(req.user, req.params.id, req.file), 201),
    listApplications: ok("Applications fetched", (req) => applications.listApplications(req.user, req.params.id, req.query)),
    getApplication: ok("Application fetched", (req) => applications.getApplication(req.user, req.params.id, req.params.applicationId)),

    // Selection per role
    rounds: ok("Selection fetched", (req) => rounds.getRounds(req.user, req.params.id, req.params.positionId)),
    createRound: ok("Round added", (req) => rounds.createRound(req.user, req.params.id, req.params.positionId, req.body), 201),
    scheduleRound: ok("Round scheduled — candidates are being invited", (req) => rounds.scheduleRound(req.user, req.params.id, req.params.positionId, req.params.roundId, req.body)),
    updateSlot: ok("Slot moved — the candidate has been told", (req) => rounds.updateSlot(req.user, req.params.id, req.params.positionId, req.params.roundId, req.params.applicationId, req.body)),
    setOutcomes: ok("Results saved", (req) => rounds.setOutcomes(req.user, req.params.id, req.params.positionId, req.params.roundId, req.body.decisions)),
    publishRound: ok("Results published — every candidate is being emailed", (req) => rounds.publishRoundResults(req.user, req.params.id, req.params.positionId, req.params.roundId)),
    finalize: ok("Final selection sent — offers are on their way", (req) => rounds.finalizePosition(req.user, req.params.id, req.params.positionId, req.body)),
    offerToReserve: ok("Offer sent", (req) => rounds.offerToReserve(req.user, req.params.id, req.params.positionId, req.params.applicationId))
};
