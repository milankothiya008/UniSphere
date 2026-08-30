const venueService = require("../services/VenueService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const createVenue = asyncHandler(async (req, res) => {
    const venue = await venueService.createVenue(req.user, req.body);
    sendSuccess(res, 201, "Venue created", venue);
});

const listVenues = asyncHandler(async (req, res) => {
    const venues = await venueService.listVenues(req.query);
    sendSuccess(res, 200, "Venues fetched", venues);
});

const updateVenue = asyncHandler(async (req, res) => {
    const venue = await venueService.updateVenue(req.user, req.params.id, req.body);
    sendSuccess(res, 200, "Venue updated", venue);
});

const available = asyncHandler(async (req, res) => {
    const venues = await venueService.getAvailableVenues(req.query);
    sendSuccess(res, 200, "Available venues fetched", venues);
});

module.exports = {
    createVenue,
    listVenues,
    updateVenue,
    available
};
