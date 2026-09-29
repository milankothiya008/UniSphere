// A small in-memory cache whose entries expire after `ttlMs`. Used for values read on almost every request
// (the signed-in user, which clubs are paused) so they don't cost a database round trip each time; writers
// clear the relevant entries, so changes still apply straight away on this server.
class TtlCache {
    constructor(ttlMs, maxEntries = 5000) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expires <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value) {
        if (this.entries.size >= this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
        return value;
    }

    delete(key) {
        this.entries.delete(key);
    }

    clear() {
        this.entries.clear();
    }

    /** Returns the cached value, or loads, caches and returns it. Concurrent misses share one load. */
    async remember(key, load) {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const pending = this.entries.get(`pending:${key}`);
        if (pending) {
            return pending.value;
        }
        const promise = load().then(
            (value) => {
                this.entries.delete(`pending:${key}`);
                return this.set(key, value);
            },
            (error) => {
                this.entries.delete(`pending:${key}`);
                throw error;
            }
        );
        this.entries.set(`pending:${key}`, { value: promise, expires: Date.now() + this.ttlMs });
        return promise;
    }
}

/** Clears `onWrite` whenever documents of `schema` are written through Mongoose. */
const clearOnWrite = (schema, onWrite) => {
    const hook = function afterWrite(result) {
        onWrite(this, result);
    };
    ["save", "updateOne", "updateMany", "findOneAndUpdate", "findOneAndDelete", "deleteOne", "deleteMany", "replaceOne", "insertMany"].forEach((operation) => {
        schema.post(operation, { document: true, query: true }, hook);
    });
};

module.exports = { TtlCache, clearOnWrite };
