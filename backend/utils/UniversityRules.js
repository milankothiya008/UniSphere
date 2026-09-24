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

// Student: <batch 2 digits><department 2-4 letters><identity 3 letters><number 3 digits>, e.g. 24ceuog001.
// The department length is implied by the fixed 6-character tail, so the split is unambiguous.
const STUDENT_PATTERN = /^(\d{2})([a-z]{2,4})([a-z]{3})(\d{3})$/i;
// Faculty: <first name>.<department 2-4 letters>, e.g. mrudang.ce.
const FACULTY_PATTERN = /^([a-z]+)\.([a-z]{2,4})$/i;

const STUDENT_FORMAT_HINT = `Student emails must be <batch><department><identity><number>@${env.universityDomain}, e.g. 24ceuog001@${env.universityDomain} (2-digit batch, 2-4 letter department, 3 letters, 3 digits)`;
const FACULTY_FORMAT_HINT = `Faculty emails must be <first name>.<department>@${env.universityDomain}, e.g. mrudang.ce@${env.universityDomain}`;
const EMAIL_FORMAT_HINT = `student (e.g. 24ceuog001@${env.universityDomain}) or faculty (e.g. mrudang.ce@${env.universityDomain})`;

const localPart = (email) => String(email).trim().split("@")[0];

const parseStudentEmail = (email) => {
    const match = localPart(email).match(STUDENT_PATTERN);

    if (!match) {
        return null;
    }

    return {
        batchCode: match[1],
        departmentCode: match[2].toUpperCase(),
        identifier: `${match[3]}${match[4]}`.toUpperCase()
    };
};

const parseFacultyEmail = (email) => {
    const match = localPart(email).match(FACULTY_PATTERN);

    if (!match) {
        return null;
    }

    return { departmentCode: match[2].toUpperCase(), namePart: match[1].toLowerCase() };
};

// Format-only check (no database lookups), used at login.
const isValidUniversityEmailFormat = (email) =>
    isUniversityEmail(email) && Boolean(parseStudentEmail(email) || parseFacultyEmail(email));

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
        `Email must follow the ${EMAIL_FORMAT_HINT} format`,
        400,
        ERROR_CODES.INVALID_EMAIL
    );
};

const intervalsOverlap = (startA, endA, startB, endB) => {
    return startA < endB && endA > startB;
};

// Normalises a calendar date (YYYY-MM-DD string, ISO string or Date stored at UTC midnight)
// to its YYYY-MM-DD key, independent of the server's local timezone.
const toDateKey = (dateValue) => {
    if (typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
        const key = dateValue.slice(0, 10);
        if (!Number.isNaN(new Date(`${key}T00:00:00Z`).getTime())) {
            return key;
        }
    }

    const date = new Date(dateValue);

    if (dateValue === null || dateValue === undefined || dateValue === "" || Number.isNaN(date.getTime())) {
        throw new AppError("Invalid date", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return date.toISOString().slice(0, 10);
};

const dateKeyToDate = (dateValue) => new Date(`${toDateKey(dateValue)}T00:00:00Z`);

const formatDateKey = (dateValue) =>
    dateKeyToDate(dateValue).toLocaleDateString("en-GB", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric"
    });

// Combines a calendar date and an HH:mm wall-clock time in the university's timezone.
const combineDateAndTime = (dateValue, timeValue) => {
    const key = toDateKey(dateValue);
    const time = String(timeValue ?? "").trim();
    const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

    if (!match) {
        throw new AppError("Time must be in HH:mm 24-hour format", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    return new Date(`${key}T${match[1]}:${match[2]}:00${env.timezoneOffset}`);
};

module.exports = {
    classifyUniversityEmail,
    isUniversityEmail,
    parseStudentEmail,
    parseFacultyEmail,
    isValidUniversityEmailFormat,
    EMAIL_FORMAT_HINT,
    STUDENT_FORMAT_HINT,
    FACULTY_FORMAT_HINT,
    intervalsOverlap,
    toDateKey,
    dateKeyToDate,
    formatDateKey,
    combineDateAndTime
};
