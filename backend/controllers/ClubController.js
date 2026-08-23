const clubService = require("../services/ClubService");
const asyncHandler = require("../utils/AsyncHandler");
const AppError = require("../utils/AppError");


const createClub = asyncHandler(async (req, res) => {
    const { name, description, category, president } = req.body;

    if (!name || !description || !category || !president) {
        throw new AppError(
            "Name, description, category and president are required",
            400
        );
    }

    const club = await clubService.createClub(req.body);

    res.status(201).json({
        success: true,
        message: "Club created successfully",
        data: club
    });
});


const getAllClubs = asyncHandler(async (req, res) => {
    const result = await clubService.getAllClubs(req.query);

    res.status(200).json({
        success: true,
        message: "Clubs fetched successfully",
        ...result
    });
});


const getClubById = asyncHandler(async (req, res) => {
    const club = await clubService.getClubById(req.params.id);

    res.status(200).json({
        success: true,
        data: club
    });
});


const updateClub = asyncHandler(async (req, res) => {
    const club = await clubService.updateClub(
        req.params.id,
        req.body
    );

    res.status(200).json({
        success: true,
        message: "Club updated successfully",
        data: club
    });
});


const deleteClub = asyncHandler(async (req, res) => {
    await clubService.deleteClub(req.params.id);

    res.status(200).json({
        success: true,
        message: "Club deleted successfully"
    });
});


module.exports = {
    createClub,
    getAllClubs,
    getClubById,
    updateClub,
    deleteClub
};