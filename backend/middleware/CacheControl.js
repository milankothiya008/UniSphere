// Lets browsers reuse public reference data (departments, batches, venues) for a short while, and serve a
// slightly stale copy instantly while they check for a newer one in the background.
const cacheFor = (seconds, staleSeconds = seconds * 10) => (req, res, next) => {
    res.set("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${staleSeconds}`);
    next();
};

module.exports = { cacheFor };
