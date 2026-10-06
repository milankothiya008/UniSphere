// Runs bcrypt off the main thread so password checks never block other requests (see utils/Password.js).
const { parentPort } = require("worker_threads");
const bcrypt = require("bcryptjs");

parentPort.on("message", ({ id, op, plain, hashed, rounds }) => {
    try {
        const result = op === "hash" ? bcrypt.hashSync(plain, rounds) : bcrypt.compareSync(plain, hashed);
        parentPort.postMessage({ id, result });
    } catch (error) {
        parentPort.postMessage({ id, error: error.message });
    }
});
