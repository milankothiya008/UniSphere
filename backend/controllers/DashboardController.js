const dashboardService = require("../services/DashboardService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const getDashboard = asyncHandler(async (req, res) => {
    const data = await dashboardService.getDashboard(req.user);
    sendSuccess(res, 200, "Dashboard fetched", data);
});

module.exports = { getDashboard };
