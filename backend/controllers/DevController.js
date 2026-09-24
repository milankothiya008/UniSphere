const { listDevInbox } = require("../services/MailService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

// Development only: emails captured because SMTP is not configured.
const inbox = asyncHandler(async (req, res) => {
    const emails = listDevInbox({ to: req.query.to });
    sendSuccess(res, 200, "Development inbox fetched", emails, { meta: { total: emails.length } });
});

module.exports = { inbox };
