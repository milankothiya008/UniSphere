const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/database");
const userRoutes = require("./routes/userRoutes");
const clubRoutes = require("./routes/clubRoutes");

dotenv.config();

const app = express();

app.use(express.json());

connectDB();

app.use("/api/users", userRoutes);
app.use("/api/clubs", clubRoutes);

app.get("/", (req, res) => {
    res.send("UniSphere API is running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});