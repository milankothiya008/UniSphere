// Runs before any module loads so config/env.js picks up an isolated test configuration.
const path = require("path");
const os = require("os");

process.env.NODE_ENV = "test";
process.env.MONGO_URI = process.env.MONGO_TEST_URI || "mongodb://127.0.0.1:27017/campusconnect_test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-long-enough";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-long-enough";
process.env.ACCESS_TOKEN_EXPIRY = "15m";
process.env.REFRESH_TOKEN_EXPIRY = "7d";
process.env.UNIVERSITY_DOMAIN = "ddu.ac.in";
process.env.UNIVERSITY_TZ_OFFSET = "+05:30";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.BOOTSTRAP_ADMIN_EMAIL = "";
process.env.BOOTSTRAP_ADMIN_PASSWORD = "";
process.env.SMTP_HOST = "";
process.env.CLOUDINARY_CLOUD_NAME = "";
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "campusconnect-test-uploads");
