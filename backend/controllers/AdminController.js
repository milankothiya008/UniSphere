const adminService = require("../services/AdminService");
const clubService = require("../services/ClubService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const createDepartment = asyncHandler(async (req, res) => {
    const department = await adminService.createDepartment(req.user, req.body);
    sendSuccess(res, 201, "Department created", department);
});

const listDepartments = asyncHandler(async (req, res) => {
    const departments = await adminService.listDepartments(req.query);
    sendSuccess(res, 200, "Departments fetched", departments);
});

const updateDepartment = asyncHandler(async (req, res) => {
    const department = await adminService.updateDepartment(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Department updated", department);
});

const createBatch = asyncHandler(async (req, res) => {
    const batch = await adminService.createBatch(req.user, req.body);
    sendSuccess(res, 201, "Academic batch created", batch);
});

const listBatches = asyncHandler(async (req, res) => {
    const batches = await adminService.listBatches(req.query);
    sendSuccess(res, 200, "Academic batches fetched", batches);
});

const updateBatch = asyncHandler(async (req, res) => {
    const batch = await adminService.updateBatch(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Academic batch updated", batch);
});

const promoteCoordinator = asyncHandler(async (req, res) => {
    const user = await adminService.promoteCoordinator(req.user, req.body.userId);
    sendSuccess(res, 200, "User promoted to coordinator", user);
});

const assignedClubs = asyncHandler(async (req, res) => {
    const clubs = await clubService.getAssignedClubs(req.user);
    sendSuccess(res, 200, "Assigned clubs fetched", clubs);
});

module.exports = {
    createDepartment,
    listDepartments,
    updateDepartment,
    createBatch,
    listBatches,
    updateBatch,
    promoteCoordinator,
    assignedClubs
};
