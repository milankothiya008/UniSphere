const ClubMembership = require("../models/ClubMembership");
const Club = require("../models/Club");
const User = require("../models/User");

const AppError = require("../utils/AppError");


// JOIN CLUB
const joinClub = async (clubId, userId) => {

    // Check club
    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError(
            "Club not found",
            404
        );
    }
    // Check user
    const user = await User.findById(userId);

    if (!user) {
        throw new AppError(
            "User not found",
            404
        );
    }


    // Check existing membership
    const existingMembership =
        await ClubMembership.findOne({
            club: clubId,
            user: userId
        });


    if (existingMembership) {

        if (existingMembership.status === "APPROVED") {
            throw new AppError(
                "User is already a member of this club",
                409
            );
        }

        if (existingMembership.status === "PENDING") {
            throw new AppError(
                "Membership request is already pending",
                409
            );
        }

        if (existingMembership.status === "REJECTED") {

            existingMembership.status = "PENDING";

            const membership =
                await existingMembership.save();

            return membership;
        }
    }


    // Create membership request
    const membership = await ClubMembership.create({
        club: clubId,
        user: userId,
        role: "MEMBER",
        status: "PENDING"
    });


    return membership.populate([
        {
            path: "club",
            select: "name category"
        },
        {
            path: "user",
            select: "name email"
        }
    ]);
};


// GET CLUB MEMBERS
const getClubMembers = async (clubId) => {

    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError(
            "Club not found",
            404
        );
    }


    const members =
        await ClubMembership.find({
            club: clubId,
            status: "APPROVED"
        })
            .populate("user", "name email")
            .sort({ joinedAt: -1 });


    return members;
};


// LEAVE CLUB
const leaveClub = async (clubId, userId) => {

    const membership =
        await ClubMembership.findOne({
            club: clubId,
            user: userId,
            status: "APPROVED"
        });


    if (!membership) {
        throw new AppError(
            "User is not a member of this club",
            404
        );
    }


    // President should not leave directly
    if (membership.role === "PRESIDENT") {
        throw new AppError(
            "Club president cannot leave the club directly",
            400
        );
    }


    await ClubMembership.findByIdAndDelete(
        membership._id
    );
};


// GET USER CLUBS
const getUserClubs = async (userId) => {

    const user = await User.findById(userId);

    if (!user) {
        throw new AppError(
            "User not found",
            404
        );
    }


    const memberships =
        await ClubMembership.find({
            user: userId,
            status: "APPROVED"
        })
            .populate("club", "name category logo status")
            .sort({ joinedAt: -1 });


    return memberships;
};


module.exports = {
    joinClub,
    getClubMembers,
    leaveClub,
    getUserClubs
};