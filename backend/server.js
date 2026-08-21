const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/database");
const errorHandler = require("./middleware/errorHandler");
const AppError = require("./utils/AppError");

const userRoutes = require("./routes/userRoutes");
const clubRoutes = require("./routes/clubRoutes");
const membershipRoutes = require("./routes/membershipRoutes");
const eventRoutes = require("./routes/eventRoutes");

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