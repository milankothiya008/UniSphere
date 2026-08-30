const express = require("express");
const {
    createDepartment,
    listDepartments,
    updateDepartment,
    createBatch,
    listBatches,
    updateBatch,
    promoteCoordinator,
    assignedClubs
} = require("../controllers/AdminController");
const { protect, restrictTo, requireVerified } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const { mongoIdParam } = require("../validators/RequestValidators");

const router = express.Router();

router.get("/departments", listDepartments);
router.get("/batches", listBatches);

router.use(protect, requireVerified);

router.get("/assigned-clubs", restrictTo(GLOBAL_ROLES.COORDINATOR, GLOBAL_ROLES.UNIVERSITY_ADMIN), assignedClubs);

router.post("/departments", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), createDepartment);
router.put("/departments/:id", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), mongoIdParam("id"), validate, updateDepartment);

router.post("/batches", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), createBatch);
router.put("/batches/:id", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), mongoIdParam("id"), validate, updateBatch);

router.post("/coordinators", restrictTo(GLOBAL_ROLES.UNIVERSITY_ADMIN), promoteCoordinator);

module.exports = router;
