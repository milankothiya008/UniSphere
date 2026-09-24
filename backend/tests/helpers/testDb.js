const mongoose = require("mongoose");

const assertTestDatabase = () => {
    const name = new URL(process.env.MONGO_URI.replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
    if (!/test/i.test(name)) {
        throw new Error(`Refusing to run tests against non-test database "${name}"`);
    }
};

const connect = async () => {
    assertTestDatabase();
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoose.connection.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
};

const clear = async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
};

const disconnect = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
};

module.exports = { connect, clear, disconnect };
