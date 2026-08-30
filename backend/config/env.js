const dotenv = require("dotenv");
const path = require("path");
const AppError = require("../utils/AppError");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const REQUIRED = [
    "MONGO_URI",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET"
];

const validateEnv = () => {
    const missing = REQUIRED.filter((key) => !process.env[key] || !String(process.env[key]).trim());

    if (missing.length) {
        throw new AppError(
            `Missing required environment variables: ${missing.join(", ")}`,
            500
        );
    }
};

const env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    cookieSecure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    universityDomain: process.env.UNIVERSITY_DOMAIN || "ddu.ac.in",
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || "",
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || "",
    bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME || "University Admin"
};

module.exports = { env, validateEnv };
