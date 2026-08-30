const mongoose = require("mongoose");
const logger = require("../utils/Logger");
const { env } = require("./env");

const connectDB = async () => {
    try {
        await mongoose.connect(env.mongoUri);
        logger.info("MongoDB connected successfully");
    } catch (error) {
        logger.error("MongoDB connection failed", { message: error.message });
        process.exit(1);
    }
};

module.exports = connectDB;
