const certificates = require("../services/CertificateService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const sendPdf = (res, { pdf, filename }, disposition = "attachment") =>
    res
        .type("pdf")
        .set("Content-Disposition", `${disposition}; filename="${filename}"`)
        .set("Cache-Control", "private, no-store")
        .send(pdf);

module.exports = {
    forEvent: asyncHandler(async (req, res) => sendSuccess(res, 200, "Certificates fetched", await certificates.myCertificatesForEvent(req.user, req.params.id))),
    mine: asyncHandler(async (req, res) => sendSuccess(res, 200, "Certificates fetched", await certificates.listMine(req.user))),
    verify: asyncHandler(async (req, res) => sendSuccess(res, 200, "Certificate checked", await certificates.verify(req.params.code))),
    download: asyncHandler(async (req, res) => sendPdf(res, await certificates.certificateFile(req.user, req.params.code))),
    sendPdf
};
