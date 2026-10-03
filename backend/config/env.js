const dotenv = require("dotenv");
const path = require("path");
const AppError = require("../utils/AppError");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

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

const nodeEnv = process.env.NODE_ENV || "development";

const env = {
    nodeEnv,
    isProduction: nodeEnv === "production",
    isTest: nodeEnv === "test",
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGO_URI,
    clientUrl: process.env.CLIENT_URL || "http://localhost:3000",
    publicApiUrl: process.env.PUBLIC_API_URL || "",
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "15m",
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || "7d",
    cookieSecure: process.env.COOKIE_SECURE === "true" || nodeEnv === "production",
    universityDomain: process.env.UNIVERSITY_DOMAIN || "ddu.ac.in",
    universityName: process.env.UNIVERSITY_NAME || "Dharmsinh Desai University",
    // Event dates and times are entered as university-local wall-clock time.
    timezoneOffset: process.env.UNIVERSITY_TZ_OFFSET || "+05:30",
    bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || "",
    // Bulk email sending rate (see services/EmailQueueService).
    emailRatePerMinute: Number(process.env.EMAIL_RATE_PER_MINUTE) || 30,
    bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || "",
    bootstrapAdminName: process.env.BOOTSTRAP_ADMIN_NAME || "University Admin",
    smtp: {
        host: process.env.SMTP_HOST || "",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === "true",
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || ""
    },
    mailFrom: process.env.MAIL_FROM || "CampusConnect <no-reply@campusconnect.local>",
    // Brevo's HTTPS email API, for hosts that block outgoing SMTP (e.g. Railway's free and Hobby plans).
    brevoApiKey: process.env.BREVO_API_KEY || "",
    // Proxies in front of the API (1 = the host's load balancer; 2 when the frontend's host also proxies /api).
    trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || "") ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === "false" ? false : 1,
    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
        apiKey: process.env.CLOUDINARY_API_KEY || "",
        apiSecret: process.env.CLOUDINARY_API_SECRET || "",
        folder: process.env.CLOUDINARY_FOLDER || "campusconnect"
    },
    // Web Push (phone/desktop notifications). Generate keys with: npx web-push generate-vapid-keys
    push: {
        publicKey: process.env.VAPID_PUBLIC_KEY || "",
        privateKey: process.env.VAPID_PRIVATE_KEY || "",
        subject: process.env.VAPID_SUBJECT || "mailto:admin@campusconnect.local"
    },
    uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, "..", "uploads"),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024,
    // Club stories: short-lived photos and videos kept in media storage, never in the database.
    stories: {
        lifetimeHours: Number(process.env.STORY_LIFETIME_HOURS) || 24,
        maxImageBytes: Number(process.env.STORY_MAX_IMAGE_BYTES) || 10 * 1024 * 1024,
        maxVideoBytes: Number(process.env.STORY_MAX_VIDEO_BYTES) || 40 * 1024 * 1024,
        maxVideoSeconds: Number(process.env.STORY_MAX_VIDEO_SECONDS) || 30,
        maxActivePerClub: Number(process.env.STORY_MAX_ACTIVE_PER_CLUB) || 30
    },
    // Event galleries: photos and videos from club members and checked-in participants, shown once approved.
    gallery: {
        maxImageBytes: Number(process.env.GALLERY_MAX_IMAGE_BYTES) || 15 * 1024 * 1024,
        maxVideoBytes: Number(process.env.GALLERY_MAX_VIDEO_BYTES) || 80 * 1024 * 1024,
        maxVideoSeconds: Number(process.env.GALLERY_MAX_VIDEO_SECONDS) || 90,
        // Waiting-for-review uploads one person may have per event, so the review queue can't be flooded.
        maxPendingPerUser: Number(process.env.GALLERY_MAX_PENDING_PER_USER) || 30
    },
    // Chat attachments: photos, videos, voice notes and documents.
    chat: {
        maxImageBytes: Number(process.env.CHAT_MAX_IMAGE_BYTES) || 15 * 1024 * 1024,
        maxVideoBytes: Number(process.env.CHAT_MAX_VIDEO_BYTES) || 50 * 1024 * 1024,
        maxVideoSeconds: Number(process.env.CHAT_MAX_VIDEO_SECONDS) || 180,
        maxAudioBytes: Number(process.env.CHAT_MAX_AUDIO_BYTES) || 10 * 1024 * 1024,
        maxAudioSeconds: Number(process.env.CHAT_MAX_AUDIO_SECONDS) || 600,
        maxDocumentBytes: Number(process.env.CHAT_MAX_FILE_BYTES) || 25 * 1024 * 1024,
        // How long the sender can still edit a message (WhatsApp allows 15 minutes).
        editMinutes: Number(process.env.CHAT_EDIT_MINUTES) || 15,
        maxGroupMembers: Number(process.env.CHAT_MAX_GROUP_MEMBERS) || 256
    },
    // Recruitment application files (resumes, portfolios).
    recruitment: {
        maxDocumentBytes: Number(process.env.RECRUITMENT_MAX_FILE_BYTES) || 5 * 1024 * 1024,
        maxImageBytes: Number(process.env.RECRUITMENT_MAX_FILE_BYTES) || 5 * 1024 * 1024,
        maxVideoBytes: 0,
        maxVideoSeconds: 0
    }
};

module.exports = { env, validateEnv };
