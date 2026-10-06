const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;

// bcrypt at cost 12 takes ~250 ms of pure CPU. On the main thread every login would freeze the whole API for
// that long, so hashing runs on a small pool of worker threads instead. Same library, same hashes.
const POOL_SIZE = Math.max(1, Math.min(4, (os.availableParallelism?.() || os.cpus().length) - 1));
const WORKER_FILE = path.join(__dirname, "passwordWorker.js");

const workers = [];
const idle = [];
const queue = [];
const pending = new Map();
let nextId = 0;
let poolBroken = false;

const dispatch = () => {
    while (queue.length && idle.length) {
        const worker = idle.pop();
        const task = queue.shift();
        worker.current = task.id;
        worker.ref();
        worker.postMessage(task.message);
    }
};

const spawnWorker = () => {
    const worker = new Worker(WORKER_FILE);
    worker.unref();
    worker.on("message", ({ id, result, error }) => {
        const task = pending.get(id);
        pending.delete(id);
        worker.current = null;
        worker.unref();
        idle.push(worker);
        if (task) {
            if (error) task.reject(new Error(error));
            else task.resolve(result);
        }
        dispatch();
    });
    const drop = (error) => {
        workers.splice(workers.indexOf(worker), 1);
        const at = idle.indexOf(worker);
        if (at >= 0) idle.splice(at, 1);
        const task = worker.current != null ? pending.get(worker.current) : null;
        if (task) {
            pending.delete(worker.current);
            task.reject(error instanceof Error ? error : new Error("Password worker stopped"));
        }
        worker.current = null;
    };
    worker.on("error", drop);
    worker.on("exit", (code) => {
        if (workers.includes(worker)) drop(new Error(`Password worker exited with code ${code}`));
    });
    workers.push(worker);
    idle.push(worker);
};

const runInPool = (message, fallback) => {
    if (poolBroken) return fallback();
    try {
        if (!idle.length && workers.length < POOL_SIZE) spawnWorker();
    } catch {
        poolBroken = true;
        return fallback();
    }
    if (!workers.length) return fallback();
    return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        queue.push({ id, message: { ...message, id } });
        dispatch();
    });
};

const hashPassword = async (plain) => runInPool({ op: "hash", plain, rounds: SALT_ROUNDS }, () => bcrypt.hash(plain, SALT_ROUNDS));

const comparePassword = async (plain, hashed) => {
    // Bad arguments fail the same way as before, without a trip to a worker.
    if (typeof plain !== "string" || typeof hashed !== "string") return bcrypt.compare(plain, hashed);
    return runInPool({ op: "compare", plain, hashed }, () => bcrypt.compare(plain, hashed));
};

module.exports = { hashPassword, comparePassword };
