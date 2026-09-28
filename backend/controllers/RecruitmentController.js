const drives = require("../services/RecruitmentService");
const applications = require("../services/ApplicationService");
const rounds = require("../services/RecruitmentRoundService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const ok = (message, work, status = 200) =>
    asyncHandler(async (req, res) => {
        sendSuccess(res, status, message, await work(req));
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

    // Applications
    mine: ok("Your applications fetched", (req) => applications.myApplications(req.user)),
    myApplication: ok("Your application fetched", (req) => applications.getMyApplication(req.user, req.params.id)),
    apply: ok("Application submitted", (req) => applications.apply(req.user, req.params.id, req.body), 201),
    updateApplication: ok("Application updated", (req) => applications.updateMyApplication(req.user, req.params.id, req.body)),
    withdraw: ok("Application withdrawn", async (req) => {
        await applications.withdraw(req.user, req.params.id);
        return null;
    }),
    uploadTickets: ok("Uploads ready", (req) => applications.createUploadTickets(req.user, req.params.id, req.body.kinds), 201),
    uploadLocal: ok("File uploaded", (req) => applications.uploadLocalFile(req.user, req.params.id, req.file), 201),
    listApplications: ok("Applications fetched", (req) => applications.listApplications(req.user, req.params.id, req.query)),
    getApplication: ok("Application fetched", (req) => applications.getApplication(req.user, req.params.id, req.params.applicationId)),

    // Rounds
    rounds: ok("Rounds fetched", (req) => rounds.getRounds(req.user, req.params.id)),
    createRound: ok("Round added", (req) => rounds.createRound(req.user, req.params.id, req.body), 201),
    scheduleRound: ok("Round scheduled — candidates are being invited", (req) => rounds.scheduleRound(req.user, req.params.id, req.params.roundId, req.body)),
    updateSlot: ok("Slot moved — the candidate has been told", (req) => rounds.updateSlot(req.user, req.params.id, req.params.roundId, req.params.applicationId, req.body)),
    setOutcomes: ok("Results saved", (req) => rounds.setOutcomes(req.user, req.params.id, req.params.roundId, req.body.decisions)),
    publishRound: ok("Results published — every candidate is being emailed", (req) => rounds.publishRoundResults(req.user, req.params.id, req.params.roundId)),
    finalize: ok("Recruitment complete — welcome emails are on their way", (req) => rounds.finalizeDrive(req.user, req.params.id, req.body.decisions))
};
