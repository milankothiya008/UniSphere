const Department = require("../models/Department");
const AcademicBatch = require("../models/AcademicBatch");
const AppError = require("./AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { ACCOUNT_TYPES } = require("../constants/Roles");
const { env } = require("../config/env");

const domain = () => env.universityDomain.toLowerCase();

const isUniversityEmail = (email) => {
    return String(email).toLowerCase().endsWith(`@${domain()}`);
};

const parseStudentEmail = (email) => {
    const local = String(email).split("@")[0];
    const match = local.match(/^(\d{2})([A-Za-z]{2,4})([A-Za-z0-9]+)$/);

    if (!match) {
        return null;
    }

    return {
        batchCode: match[1],
        departmentCode: match[2].toUpperCase(),
        identifier: match[3].toUpperCase()
    };
};

const parseFacultyEmail = (email) => {
    const local = String(email).split("@")[0];
    const parts = local.split(".");

    if (parts.length < 2) {
        return null;
    }

    if (!/^[a-z][a-z0-9-]*$/i.test(parts[0])) {
        return null;
    }

    const departmentCode = parts[parts.length - 1].toUpperCase();
    const namePart = parts.slice(0, -1).join(".");

    if (!namePart || !departmentCode) {
        return null;
    }

    return { departmentCode, namePart };
};

const classifyUniversityEmail = async (email) => {
    const normalized = String(email).trim().toLowerCase();

    if (!isUniversityEmail(normalized)) {
        throw new AppError(
            `Only @${domain()} email addresses are allowed`,
            400,
            ERROR_CODES.INVALID_EMAIL
        );
    }

    const studentParts = parseStudentEmail(normalized);
    if (studentParts) {
        const batch = await AcademicBatch.findOne({
            code: studentParts.batchCode,
            isActive: true
        });

        if (!batch) {
            throw new AppError(
                `Batch '${studentParts.batchCode}' is not an allowed academic batch`,
                400,
                ERROR_CODES.INVALID_EMAIL
            );
        }

        const department = await Department.findOne({
            code: studentParts.departmentCode,
            isActive: true
        });

        if (!department) {
            throw new AppError(
                `Department '${studentParts.departmentCode}' is not recognized`,
                400,
                ERROR_CODES.INVALID_EMAIL
            );
        }

        return {
            accountType: ACCOUNT_TYPES.STUDENT,
            batchCode: studentParts.batchCode,
            departmentCode: studentParts.departmentCode
        };
    }

    const facultyParts = parseFacultyEmail(normalized);
    if (facultyParts) {
        const department = await Department.findOne({
            code: facultyParts.departmentCode,
            isActive: true
        });

        if (!department) {
            throw new AppError(
                `Department '${facultyParts.departmentCode}' is not recognized`,
                400,
                ERROR_CODES.INVALID_EMAIL
            );
        }

        return {
            accountType: ACCOUNT_TYPES.FACULTY,
            batchCode: null,
            departmentCode: facultyParts.departmentCode
        };
    }

    throw new AppError(
        "Email must follow student (e.g. 24CE1234@ddu.ac.in) or faculty (e.g. name.ce@ddu.ac.in) format",
        400,
        ERROR_CODES.INVALID_EMAIL
    );
};

const intervalsOverlap = (startA, endA, startB, endB) => {
    return startA < endB && endA > startB;
};

const combineDateAndTime = (dateValue, timeValue) => {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        throw new AppError("Invalid date", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const time = String(timeValue).trim();
    const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    if (!match) {
        throw new AppError("Time must be in HH:mm 24-hour format", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const result = new Date(date);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return result;
};

module.exports = {
    classifyUniversityEmail,
    isUniversityEmail,
    parseStudentEmail,
    parseFacultyEmail,
    intervalsOverlap,
    combineDateAndTime
};
