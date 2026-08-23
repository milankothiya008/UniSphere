const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/Database");
const errorHandler = require("./middleware/ErrorHandler");
const AppError = require("./utils/AppError");

const userRoutes = require("./routes/UserRoutes");
const clubRoutes = require("./routes/ClubRoutes");
const membershipRoutes = require("./routes/MembershipRoutes");
const eventRoutes = require("./routes/EventRoutes");

dotenv.config();

const app = express();

app.use(express.json());

connectDB();


// Routes
app.use("/api/users", userRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/events", eventRoutes);

app.get("/", (req, res) => {
    res.send("UniSphere API is running");
});


// Handle undefined routes
app.all("*", (req, res, next) => {
    next(
        new AppError(
            `Cannot find ${req.method} ${req.originalUrl} on this server`,
            404
        )
    );
});


// Global error handler (must be last middleware)
app.use(errorHandler);


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});