const express = require("express");

const {
    createClub,
    getAllClubs,
    getClubById,
    updateClub,
    deleteClub
} = require("../controllers/ClubController");

const router = express.Router();


router.post("/", createClub);

router.get("/", getAllClubs);

router.get("/:id", getClubById);

router.put("/:id", updateClub);

router.delete("/:id", deleteClub);


module.exports = router;