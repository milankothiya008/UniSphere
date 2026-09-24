const express = require("express");
const c = require("../controllers/ClubRequestController");
const { protect, requireVerified, restrictTo } = require("../middleware/Auth");
const { GLOBAL_ROLES } = require("../constants/Roles");
const validate = require("../middleware/Validate");
const {
    clubRequestRules,
    clubRequestUpdateRules,
    mongoIdParam,
    rejectRules,
    commentRules,
    optionalCommentRules
} = require("../validators/RequestValidators");

const router = express.Router();
const id = mongoIdParam("id");

router.use(protect, requireVerified);

router.post("/", restrictTo(GLOBAL_ROLES.STUDENT), clubRequestRules, validate, c.createRequest);
router.get("/", c.listRequests);
router.get("/:id", id, validate, c.getRequest);
router.put("/:id", restrictTo(GLOBAL_ROLES.STUDENT), id, clubRequestUpdateRules, validate, c.updateRequest);
router.post("/:id/resubmit", restrictTo(GLOBAL_ROLES.STUDENT), id, validate, c.resubmit);
router.post("/:id/verify", restrictTo(GLOBAL_ROLES.FACULTY), id, optionalCommentRules, validate, c.verify);
router.post("/:id/request-changes", restrictTo(GLOBAL_ROLES.FACULTY), id, commentRules, validate, c.requestChanges);
router.post("/:id/reject", restrictTo(GLOBAL_ROLES.FACULTY, GLOBAL_ROLES.ADMIN), id, rejectRules, validate, c.reject);
router.post("/:id/approve", restrictTo(GLOBAL_ROLES.ADMIN), id, validate, c.approve);

module.exports = router;
