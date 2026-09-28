const express = require("express");
const { param } = require("express-validator");
const validate = require("../middleware/Validate");
const asyncHandler = require("../utils/AsyncHandler");
const { renderTicketPng } = require("../services/TicketService");

const router = express.Router();

// The QR image embedded in ticket emails. Public and stateless: the token carries its own signature, and
// whether the ticket is still valid is decided at the door, not here.
router.get(
    "/:token/qr.png",
    param("token").matches(/^[A-Za-z0-9._-]{40,200}$/).withMessage("Invalid ticket"),
    validate,
    asyncHandler(async (req, res) => {
        const png = await renderTicketPng(req.params.token);
        res.type("png").set("Cache-Control", "public, max-age=604800").send(png);
    })
);

module.exports = router;
