const Department = require("../models/Department");
const AcademicBatch = require("../models/AcademicBatch");
const Venue = require("../models/Venue");
const { env, validateEnv } = require("../config/env");
const connectDB = require("../config/Database");
const { bootstrapAdminIfNeeded } = require("../services/AdminService");
const logger = require("../utils/Logger");

const DEPARTMENTS = [
    { code: "CE", name: "Computer Engineering" },
    { code: "IT", name: "Information Technology" },
    { code: "EC", name: "Electronics and Communication" },
    { code: "ME", name: "Mechanical Engineering" },
    { code: "EE", name: "Electrical Engineering" },
    { code: "CH", name: "Chemical Engineering" },
    { code: "CL", name: "Civil Engineering" }
];

const currentTwoDigitYear = () => String(new Date().getFullYear()).slice(-2);

const buildBatches = () => {
    const now = Number(currentTwoDigitYear());
    const codes = [];

    for (let offset = 0; offset < 6; offset += 1) {
        const code = String((now - offset + 100) % 100).padStart(2, "0");
        codes.push({
            code,
            label: `Batch 20${code}`
        });
    }

    return codes;
};

const DEFAULT_VENUES = [
    { name: "Auditorium", location: "Main Campus", capacity: 400, type: "AUDITORIUM" },
    { name: "Seminar Hall A", location: "Academic Block", capacity: 120, type: "HALL" },
    { name: "Seminar Hall B", location: "Academic Block", capacity: 80, type: "HALL" },
    // Labs belong to departments: only their departments' events can book them.
    { name: "CE Software Lab", location: "CE Block, 2nd floor", capacity: 60, type: "LAB", departmentCodes: ["CE"] },
    { name: "IT Networks Lab", location: "IT Block, 1st floor", capacity: 50, type: "LAB", departmentCodes: ["IT"] },
    { name: "Innovation Lab", location: "CE Block, ground floor", capacity: 40, type: "LAB", departmentCodes: ["CE", "IT"] },
    { name: "EC Electronics Lab", location: "EC Block, 1st floor", capacity: 45, type: "LAB", departmentCodes: ["EC"] }
];

const seedReferenceData = async () => {
    for (const department of DEPARTMENTS) {
        await Department.findOneAndUpdate(
            { code: department.code },
            { ...department, isActive: true },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    }

    for (const batch of buildBatches()) {
        await AcademicBatch.findOneAndUpdate(
            { code: batch.code },
            { ...batch, isActive: true },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    }

    for (const venue of DEFAULT_VENUES) {
        await Venue.findOneAndUpdate(
            { name: venue.name },
            { $setOnInsert: venue },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );
    }

    await bootstrapAdminIfNeeded();
};

const seed = async () => {
    validateEnv();
    await connectDB();
    await seedReferenceData();
    logger.info("Seed completed", { domain: env.universityDomain });
    process.exit(0);
};

if (require.main === module) {
    seed().catch((error) => {
        logger.error("Seed failed", { message: error.message });
        process.exit(1);
    });
}

module.exports = { seedReferenceData, buildBatches };
