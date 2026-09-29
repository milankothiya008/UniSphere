const express = require("express");
const c = require("../controllers/AdminController");
const { protect, restrictTo, requireVerified } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam, departmentRules, batchRules } = require("../validators/RequestValidators");

const router = express.Router();

// Reference data used by registration and event forms.
router.get("/departments", c.listDepartments);
router.get("/batches", c.listBatches);

router.use(protect, requireVerified, restrictTo(GLOBAL_ROLES.ADMIN));

router.get("/stats", c.stats);
router.get("/faculty", c.listFaculty);

router.post("/departments", departmentRules(false), validate, c.createDepartment);
router.put("/departments/:id", mongoIdParam("id"), departmentRules(true), validate, c.updateDepartment);

router.post("/batches", batchRules(false), validate, c.createBatch);
router.put("/batches/:id", mongoIdParam("id"), batchRules(true), validate, c.updateBatch);

module.exports = router;
