// Development tool: how many database round trips each API request makes, and how many of them happen one
// after another. Every query is delayed by LATENCY ms (like a database in another region), so a request's
// time divided by LATENCY is roughly its number of sequential round trips.
//
//   MONGO_URI=... node scripts/profileRequests.js
require("dotenv").config();
const mongoose = require("mongoose");
const request = require("supertest");

const LATENCY = Number(process.env.PROFILE_LATENCY) || 50;
let queries = 0;
const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY));
for (const proto of [mongoose.Query.prototype, mongoose.Aggregate.prototype]) {
    const exec = proto.exec;
    proto.exec = async function patchedExec(...args) {
        queries += 1;
        await delay();
        return exec.apply(this, args);
    };
}
const save = mongoose.Model.prototype.save;
mongoose.Model.prototype.save = async function patchedSave(...args) {
    queries += 1;
    await delay();
    return save.apply(this, args);
};

const app = require("../server");

const ROUTES = [
    "/api/auth/me",
    "/api/dashboard",
    "/api/clubs/mine",
    "/api/notifications/unread-count",
    "/api/events?timeframe=upcoming&page=1&limit=8&withCounts=true",
    "/api/clubs?page=1&limit=12",
    "/api/feed?page=1&limit=10",
    "/api/gallery?page=1&limit=12",
    "/api/results?page=1&limit=12",
    "/api/recruitment",
    "/api/registrations/me?timeframe=upcoming&includeWaitlist=true",
    "/api/recruitment/mine",
    "/api/stories",
    "/api/events/schedule?days=7",
    "/api/events/manage?page=1&limit=20"
];

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const login = await request(app).post("/api/auth/login").send({ email: process.argv[2] || "26cedmo006@ddu.ac.in", password: "Demo@1234" });
    const token = login.body.data?.accessToken;
    if (!token) {
        console.log("login failed", login.status, login.body.message);
        process.exit(1);
    }
    for (const route of ROUTES) {
        queries = 0;
        const started = Date.now();
        const response = await request(app).get(route).set("Authorization", `Bearer ${token}`);
        const took = Date.now() - started;
        console.log(`${String(response.status).padEnd(4)} ${route.padEnd(66)} ${String(queries).padStart(3)} queries  ~${Math.round(took / LATENCY)} sequential`);
    }
    process.exit(0);
})();
