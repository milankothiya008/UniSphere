const clubService = require("../services/ClubService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getUserClubs = asyncHandler(async (req, res) => {
    if (String(req.user._id) !== String(req.params.userId) && req.user.globalRole !== "UNIVERSITY_ADMIN") {
        const AppError = require("../utils/AppError");
        const ERROR_CODES = require("../constants/ErrorCodes");
        throw new AppError("You cannot view another user's clubs", 403, ERROR_CODES.FORBIDDEN);
    }

    const memberships = await clubService.getUserClubs(req.params.userId);
    sendSuccess(res, 200, "User clubs fetched", memberships, { count: memberships.length });
});

module.exports = { getUserClubs };
