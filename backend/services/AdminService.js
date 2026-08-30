const Department = require("../models/Department");
const AcademicBatch = require("../models/AcademicBatch");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, ACCOUNT_TYPES, USER_PUBLIC_FIELDS } = require("../constants/Roles");
const { hashPassword } = require("../utils/Password");
const { assertAdmin } = require("./AuthorizationService");

const createDepartment = async (actor, { code, name, isActive = true }) => {
    assertAdmin(actor);

    if (!code || !name) {
        throw new AppError("Code and name are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return Department.create({ code: code.toUpperCase(), name, isActive });
};

const listDepartments = async (query = {}) => {
    const filter = {};
    if (query.active === "true") {
        filter.isActive = true;
    }
    return Department.find(filter).sort({ code: 1 });
};

const updateDepartment = async (actor, id, data) => {
    assertAdmin(actor);
    const department = await Department.findByIdAndUpdate(id, data, { new: true, runValidators: true });

    if (!department) {
        throw new AppError("Department not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return department;
};

const createBatch = async (actor, { code, label, isActive = true }) => {
    assertAdmin(actor);

    if (!code || !label) {
        throw new AppError("Code and label are required", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return AcademicBatch.create({ code, label, isActive });
};

const listBatches = async (query = {}) => {
    const filter = {};
    if (query.active === "true") {
        filter.isActive = true;
    }
    return AcademicBatch.find(filter).sort({ code: -1 });
};

const updateBatch = async (actor, id, data) => {
    assertAdmin(actor);
    const batch = await AcademicBatch.findByIdAndUpdate(id, data, { new: true, runValidators: true });

    if (!batch) {
        throw new AppError("Academic batch not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return batch;
};

const promoteCoordinator = async (actor, userId) => {
    assertAdmin(actor);

    const user = await User.findById(userId);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (user.accountType !== ACCOUNT_TYPES.FACULTY) {
        throw new AppError("Only faculty accounts can be coordinators", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    user.globalRole = GLOBAL_ROLES.COORDINATOR;
    await user.save();
    return user;
};

const listUsers = async (actor, query = {}) => {
    assertAdmin(actor);

    const filter = {};
    if (query.role) {
        filter.globalRole = query.role.toUpperCase();
    }
    if (query.accountType) {
        filter.accountType = query.accountType.toUpperCase();
    }

    return User.find(filter).select(USER_PUBLIC_FIELDS).sort({ createdAt: -1 });
};

const getUserById = async (actor, id) => {
    if (!actor || String(actor._id) !== String(id)) {
        assertAdmin(actor);
    }

    const user = await User.findById(id).select(USER_PUBLIC_FIELDS);

    if (!user) {
        throw new AppError("User not found", 404, ERROR_CODES.NOT_FOUND);
    }

    return user;
};

const bootstrapAdminIfNeeded = async () => {
    const { env } = require("../config/env");
    const logger = require("../utils/Logger");

    if (!env.bootstrapAdminEmail || !env.bootstrapAdminPassword) {
        return;
    }

    const existingAdmin = await User.findOne({ globalRole: GLOBAL_ROLES.UNIVERSITY_ADMIN });
    if (existingAdmin) {
        return;
    }

    const existing = await User.findOne({ email: env.bootstrapAdminEmail.toLowerCase() });
    if (existing) {
        existing.globalRole = GLOBAL_ROLES.UNIVERSITY_ADMIN;
        existing.accountType = ACCOUNT_TYPES.FACULTY;
        existing.isEmailVerified = true;
        await existing.save();
        logger.info("Existing user promoted to university admin");
        return;
    }

    await User.create({
        name: env.bootstrapAdminName,
        email: env.bootstrapAdminEmail.toLowerCase(),
        password: await hashPassword(env.bootstrapAdminPassword),
        accountType: ACCOUNT_TYPES.FACULTY,
        globalRole: GLOBAL_ROLES.UNIVERSITY_ADMIN,
        isEmailVerified: true
    });

    logger.info("Bootstrap university admin created");
};

module.exports = {
    createDepartment,
    listDepartments,
    updateDepartment,
    createBatch,
    listBatches,
    updateBatch,
    promoteCoordinator,
    listUsers,
    getUserById,
    bootstrapAdminIfNeeded
};
