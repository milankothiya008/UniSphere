const express = require("express");
const { body, param, query } = require("express-validator");
const elections = require("../services/ElectionService");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

// Club elections (see services/ElectionService): anonymous votes among a club's members for its roles.
const router = express.Router();
router.use(protect, requireVerified);

const ok = (handler, status = 200, message = "OK") => asyncHandler(async (req, res) => sendSuccess(res, status, message, await handler(req)));
const id = param("id").isMongoId().withMessage("Invalid election");
const details = [
    body("title").optional().isString().isLength({ max: 120 }),
    body("description").optional().isString().isLength({ max: 1000 }),
    body("candidates").optional().isArray({ max: 10 }).withMessage("Choose up to 10 candidates"),
    body("opensAt").optional({ values: "falsy" }).isISO8601().withMessage("Choose when voting opens"),
    body("closesAt").optional().isISO8601().withMessage("Choose when voting closes")
];

router.get(
    "/",
    query("club").isMongoId().withMessage("Choose a club"),
    validate,
    ok((req) => elections.listElections(req.user, req.query.club))
);
router.post(
    "/",
    body("club").isMongoId().withMessage("Choose a club"),
    body("role").isString().notEmpty().withMessage("Choose the role this election is for"),
    body("candidates").isArray({ min: 2, max: 10 }).withMessage("Choose 2 to 10 candidates"),
    body("closesAt").isISO8601().withMessage("Choose when voting closes"),
    ...details,
    validate,
    ok((req) => elections.createElection(req.user, req.body.club, req.body), 201, "Election created")
);
router.get(
    "/:id",
    id,
    validate,
    ok((req) => elections.getElection(req.user, req.params.id))
);
router.patch(
    "/:id",
    id,
    body("role").optional().isString(),
    ...details,
    validate,
    ok((req) => elections.updateElection(req.user, req.params.id, req.body))
);
router.post(
    "/:id/vote",
    id,
    body("candidate").isMongoId().withMessage("Choose a candidate"),
    validate,
    ok((req) => elections.vote(req.user, req.params.id, req.body.candidate), 200, "Vote recorded")
);
router.post(
    "/:id/close",
    id,
    validate,
    ok((req) => elections.closeElection(req.user, req.params.id))
);
router.post(
    "/:id/cancel",
    id,
    body("reason").optional().isString().isLength({ max: 300 }),
    validate,
    ok((req) => elections.cancelElection(req.user, req.params.id, req.body.reason))
);
router.post(
    "/:id/runoff",
    id,
    ...details,
    validate,
    ok((req) => elections.startRunoff(req.user, req.params.id, req.body), 201, "Runoff created")
);

module.exports = router;
