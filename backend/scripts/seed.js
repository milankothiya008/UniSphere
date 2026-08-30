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
    { name: "Auditorium", location: "Main Campus", capacity: 400 },
    { name: "Seminar Hall A", location: "Academic Block", capacity: 120 },
    { name: "Seminar Hall B", location: "Academic Block", capacity: 80 }
];

const seed = async () => {
    validateEnv();
    await connectDB();

    for (const department of DEPARTMENTS) {
        await Department.findOneAndUpdate(
            { code: department.code },
            { ...department, isActive: true },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    for (const batch of buildBatches()) {
        await AcademicBatch.findOneAndUpdate(
            { code: batch.code },
            { ...batch, isActive: true },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    for (const venue of DEFAULT_VENUES) {
        await Venue.findOneAndUpdate(
            { name: venue.name },
            venue,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    await bootstrapAdminIfNeeded();
    logger.info("Seed completed", { domain: env.universityDomain });
    process.exit(0);
};

seed().catch((error) => {
    logger.error("Seed failed", { message: error.message });
    process.exit(1);
});
