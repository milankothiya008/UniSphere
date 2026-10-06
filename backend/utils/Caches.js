const { TtlCache } = require("./TtlCache");

// Signed-in users by id (plain objects), and the ids of paused clubs. Short-lived, and cleared whenever a
// user or club is written, so role changes, deactivation and suspensions take effect at once.
const userCache = new TtlCache(30 * 1000);
const pausedClubsCache = new TtlCache(30 * 1000);
// Departments and batches by query string; they change only when the admin edits them.
const referenceCache = new TtlCache(5 * 60 * 1000);
// The part of an events feed page that is the same for everyone (events, totals, tab counts, results), for a
// few seconds. Cleared whenever an event, result, club or venue is written.
const eventFeedCache = new TtlCache(5 * 1000, 500);
// The public clubs directory, for a few seconds. Cleared on any club, membership or recruitment drive write.
const clubDirectoryCache = new TtlCache(5 * 1000, 200);

module.exports = { userCache, pausedClubsCache, referenceCache, eventFeedCache, clubDirectoryCache };
