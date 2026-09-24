const adminService = require("../services/AdminService");
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

const listFaculty = asyncHandler(async (req, res) => {
    const faculty = await adminService.listFaculty(req.user, req.query);
    sendSuccess(res, 200, "Faculty fetched", faculty);
});

const stats = asyncHandler(async (req, res) => {
    const data = await adminService.getStats(req.user);
    sendSuccess(res, 200, "Platform statistics fetched", data);
});

const auditLogs = asyncHandler(async (req, res) => {
    const { items, ...meta } = await adminService.listAuditLogs(req.user, req.query);
    sendSuccess(res, 200, "Audit log fetched", items, { meta });
});

module.exports = {
    createDepartment,
    listDepartments,
    updateDepartment,
    createBatch,
    listBatches,
    updateBatch,
    listFaculty,
    stats,
    auditLogs
};
