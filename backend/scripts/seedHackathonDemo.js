// Adds the demo hackathons (see services/DemoHackathonSeeder.js) to the database in MONGO_URI.
// Replaces its own two events if they already exist. Sends no emails.
//
//   MONGO_URI=... node scripts/seedHackathonDemo.js --confirm
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { seedHackathonDemo } = require("../services/DemoHackathonSeeder");

(async () => {
    if (!process.argv.includes("--confirm")) {
        console.log("This adds demo hackathons to the database in MONGO_URI. Run again with --confirm.");
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    const ok = await seedHackathonDemo({ log: (message) => console.log(message) });
    await mongoose.disconnect();
    process.exit(ok ? 0 : 1);
})().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exit(1);
});
