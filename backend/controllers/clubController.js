const clubService = require("../services/clubService");

const createClub = async (req, res) => {
    try {
        const {
            name,
            description,
            category,
            president
        } = req.body;
       
        if (!name || !description || !category || !president) {
            return res.status(400).json({
                message: "Name, description, category and president are required"
            });
        }
        const club = await clubService.createClub(req.body);


        res.status(201).json({
            message: "Club created successfully",
            club
        });

    } catch (error) {

        console.error(error);

        res.status(400).json({
            message: error.message
        });
    }
};

const getAllClubs = async (req, res) => {

    try {

        const result = await clubService.getAllClubs(
            req.query
        );


        res.status(200).json({
            message: "Clubs fetched successfully",
            ...result
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: error.message
        });
    }
};

const getClubById = async (req, res) => {

    try {

        const club = await clubService.getClubById(
            req.params.id
        );


        res.status(200).json({
            club
        });

    } catch (error) {

        console.error(error);

        res.status(404).json({
            message: error.message
        });
    }
};

const updateClub = async (req, res) => {

    try {

        const club = await clubService.updateClub(
            req.params.id,
            req.body
        );


        res.status(200).json({
            message: "Club updated successfully",
            club
        });

    } catch (error) {

        console.error(error);

        res.status(400).json({
            message: error.message
        });
    }
};

const deleteClub = async (req, res) => {

    try {

        await clubService.deleteClub(
            req.params.id
        );


        res.status(200).json({
            message: "Club deleted successfully"
        });

    } catch (error) {

        console.error(error);

        res.status(404).json({
            message: error.message
        });
    }
};
module.exports = {
    createClub,
    getAllClubs,
    getClubById,
    updateClub,
    deleteClub
};