const mongoose = require("mongoose");
const { clearOnWrite } = require("../utils/TtlCache");
const { referenceCache } = require("../utils/Caches");

const departmentSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            minlength: 2,
            maxlength: 4
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

clearOnWrite(departmentSchema, () => referenceCache.clear());

module.exports = mongoose.model("Department", departmentSchema);
