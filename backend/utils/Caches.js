const { TtlCache } = require("./TtlCache");

// Signed-in users by id (plain objects), and the ids of paused clubs. Short-lived, and cleared whenever a
// user or club is written, so role changes, deactivation and suspensions take effect at once.
const userCache = new TtlCache(30 * 1000);
const pausedClubsCache = new TtlCache(30 * 1000);
// Departments and batches by query string; they change only when the admin edits them.
const referenceCache = new TtlCache(5 * 60 * 1000);

module.exports = { userCache, pausedClubsCache, referenceCache };
