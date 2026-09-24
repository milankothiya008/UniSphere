const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");

const { env, validateEnv } = require("./config/env");
const connectDB = require("./config/Database");
const errorHandler = require("./middleware/ErrorHandler");
const { apiLimiter } = require("./middleware/RateLimiter");
const AppError = require("./utils/AppError");
const logger = require("./utils/Logger");
const { bootstrapAdminIfNeeded } = require("./services/AdminService");
const { deliveryMode, checkMailConfiguration } = require("./services/MailService");
const { startEmailWorker } = require("./services/EmailQueueService");
const { startStorySweeper } = require("./services/StoryService");

const authRoutes = require("./routes/AuthRoutes");
const userRoutes = require("./routes/UserRoutes");
const clubRoutes = require("./routes/ClubRoutes");
const clubRequestRoutes = require("./routes/ClubRequestRoutes");
const membershipRoutes = require("./routes/MembershipRoutes");
const eventRoutes = require("./routes/EventRoutes");
const venueRoutes = require("./routes/VenueRoutes");
const adminRoutes = require("./routes/AdminRoutes");
const registrationRoutes = require("./routes/RegistrationRoutes");
const resultRoutes = require("./routes/ResultRoutes");
const feedRoutes = require("./routes/FeedRoutes");
const notificationRoutes = require("./routes/NotificationRoutes");
const uploadRoutes = require("./routes/UploadRoutes");
const dashboardRoutes = require("./routes/DashboardRoutes");
const storyRoutes = require("./routes/StoryRoutes");
const devRoutes = require("./routes/DevRoutes");

validateEnv();

const app = express();

app.set("trust proxy", 1);
app.use(
    helmet({
        // Uploaded images are loaded by the frontend, which may run on another origin in development.
        crossOriginResourcePolicy: { policy: "cross-origin" }
    })
);
app.use(
    cors({
        origin: env.clientUrl,
        credentials: true
    })
);
app.use(express.json({ limit: "1mb" }));
// Express 5 leaves req.body undefined when a request has no body (e.g. "approve" with no comment).
app.use((req, res, next) => {
    req.body ??= {};
    next();
});
app.use(cookieParser());
if (!env.isTest) {
    app.use(morgan(env.isProduction ? "combined" : "dev"));
}

// File names are unique, so uploads can be cached for good (videos are served with range requests).
app.use("/uploads", express.static(env.uploadDir, { fallthrough: false, maxAge: "7d", immutable: true, index: false }));

app.use("/api", apiLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/club-requests", clubRequestRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/venues", venueRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/registrations", registrationRoutes);
app.use("/api/results", resultRoutes);
app.use("/api/feed", feedRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/stories", storyRoutes);

// Development inbox: only exists when SMTP is not configured and NODE_ENV is not production.
if (deliveryMode() === "preview") {
    app.use("/api/dev", devRoutes);
}

app.get("/api/health", (req, res) => {
    res.json({ success: true, message: "CampusConnect API is running", data: { emailDelivery: deliveryMode() } });
});

// In production the built React app is served from the same origin as the API.
const clientDist = path.join(__dirname, "..", "frontend", "dist");
if (env.isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false }));
    app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

app.use((req, res, next) => {
    next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404));
});

app.use(errorHandler);

const start = async () => {
    await connectDB();
    await bootstrapAdminIfNeeded();
    await checkMailConfiguration();
    startEmailWorker();
    startStorySweeper();

    app.listen(env.port, () => {
        logger.info(`Server running on port ${env.port}`);
    });
};

if (require.main === module) {
    start().catch((error) => {
        logger.error("Server failed to start", { message: error.message });
        process.exit(1);
    });
}

module.exports = app;
