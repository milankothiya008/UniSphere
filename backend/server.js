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

const authRoutes = require("./routes/AuthRoutes");
const userRoutes = require("./routes/UserRoutes");
const clubRoutes = require("./routes/ClubRoutes");
const clubRequestRoutes = require("./routes/ClubRequestRoutes");
const membershipRoutes = require("./routes/MembershipRoutes");
const eventRoutes = require("./routes/EventRoutes");
const venueRoutes = require("./routes/VenueRoutes");
const adminRoutes = require("./routes/AdminRoutes");
const registrationRoutes = require("./routes/RegistrationRoutes");

validateEnv();

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
    cors({
        origin: env.clientUrl,
        credentials: true
    })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/club-requests", clubRequestRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/venues", venueRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/registrations", registrationRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "UniSphere API is running"
    });
});

app.use((req, res, next) => {
    next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404));
});

app.use(errorHandler);

const start = async () => {
    await connectDB();
    await bootstrapAdminIfNeeded();

    app.listen(env.port, () => {
        logger.info(`Server running on port ${env.port}`);
    });
};

if (require.main === module) {
    start();
}

module.exports = app;
