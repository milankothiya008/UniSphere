const Club = require("../models/Club");
const User = require("../models/User");
const AppError = require("../utils/AppError");


// CREATE CLUB
const createClub = async (clubData) => {

    const {
        name,
        description,
        category,
        logo,
        president
    } = clubData;


    // Check president
    const user = await User.findById(president);

    if (!user) {
        throw new AppError("President user not found", 404);
    }


    // Check duplicate club
    const existingClub = await Club.findOne({ name });

    if (existingClub) {
        throw new AppError(
            "Club with this name already exists",
            409
        );
    }


    // Create club
    const club = await Club.create({
        name,
        description,
        category,
        logo,
        president
    });


    return await club.populate("president", "name email");
};



const getAllClubs = async (query) => {

    const {
        search,
        category,
        status,
        page = 1,
        limit = 10
    } = query;


    // MongoDB filter
    const filter = {};


    // Search by club name
    if (search) {
        filter.name = {
            $regex: search,
            $options: "i"
        };
    }


    // Filter by category
    if (category) {
        filter.category = category.toUpperCase();
    }


    // Filter by status
    if (status) {
        filter.status = status.toUpperCase();
    }


    // Pagination
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    const skip = (pageNumber - 1) * limitNumber;


    // Get clubs
    const clubs = await Club.find(filter)
        .populate("president", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber);


    // Total matching clubs
    const totalClubs = await Club.countDocuments(filter);


    return {
        clubs,
        totalClubs,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalClubs / limitNumber),
        limit: limitNumber
    };
};



// GET CLUB BY ID
const getClubById = async (clubId) => {

    const club = await Club.findById(clubId)
        .populate("president", "name email");

    if (!club) {
        throw new AppError("Club not found", 404);
    }

    return club;
};



// UPDATE CLUB
const updateClub = async (clubId, clubData) => {

    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError("Club not found", 404);
    }


    const {
        name,
        description,
        category,
        logo,
        president,
        status
    } = clubData;


    // If president is changing
    if (president) {

        const user = await User.findById(president);

        if (!user) {
            throw new AppError("President user not found", 404);
        }

        club.president = president;
    }


    if (name !== undefined) {
        club.name = name;
    }

    if (description !== undefined) {
        club.description = description;
    }

    if (category !== undefined) {
        club.category = category;
    }

    if (logo !== undefined) {
        club.logo = logo;
    }

    if (status !== undefined) {
        club.status = status;
    }


    const updatedClub = await club.save();

    return await updatedClub.populate("president", "name email");
};

const deleteClub = async (clubId) => {

    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError("Club not found", 404);
    }

    await Club.findByIdAndDelete(clubId);

    return club;
};


module.exports = {
    createClub,
    getAllClubs,
    getClubById,
    updateClub,
    deleteClub
};