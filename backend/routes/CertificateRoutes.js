const express = require("express");
const { param } = require("express-validator");
const c = require("../controllers/CertificateController");
const { protect, requireVerified } = require("../middleware/Auth");
const validate = require("../middleware/Validate");

const router = express.Router();
const code = param("code").matches(/^CERT-[A-Z0-9]{10}$/i).withMessage("Invalid certificate ID");

// Public: anyone (an employer, a scholarship office) can check a certificate's code.
router.get("/verify/:code", code, validate, c.verify);
router.get("/mine", protect, requireVerified, c.mine);
router.get("/:code/pdf", protect, requireVerified, code, validate, c.download);

module.exports = router;
