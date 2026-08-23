const Event = require("../models/Event");
const Club = require("../models/Club");
const User = require("../models/User");
const AppError = require("../utils/AppError");


// CREATE EVENT
const createEvent = async (eventData) => {

    const {
        name,
        description,
        date,
        time,
        venue,
        registrationDeadline,
        bannerImage,
        club,
        createdBy
    } = eventData;


    // Validate required fields
    if (!name || !description || !date || !time || !venue || !registrationDeadline || !club || !createdBy) {
        throw new AppError(
            "Name, description, date, time, venue, registrationDeadline, club and createdBy are required",
            400
        );
    }


    // Check club exists and is active
    const clubDoc = await Club.findById(club);

    if (!clubDoc) {
        throw new AppError("Club not found", 404);
    }

    if (clubDoc.status !== "ACTIVE") {
        throw new AppError(
            "Events can only be created for active clubs",
            400
        );
    }


    // Check creator exists
    const userDoc = await User.findById(createdBy);

    if (!userDoc) {
        throw new AppError("Creator user not found", 404);
    }


    // Create event with PENDING status (needs approval)
    const event = await Event.create({
        name,
        description,
        date,
        time,
        venue,
        registrationDeadline,
        bannerImage,
        club,
        createdBy,
        status: "PENDING"
    });


    return await event.populate([
        { path: "club", select: "name category" },
        { path: "createdBy", select: "name email" }
    ]);
};



// GET ALL EVENTS (with search, filter, pagination)
const getAllEvents = async (query) => {

    const {
        search,
        status,
        clubId,
        upcoming,
        page = 1,
        limit = 10
    } = query;

    const filter = {};


    // Search by event name
    if (search) {
        filter.name = {
            $regex: search,
            $options: "i"
        };
    }


    // Filter by status
    if (status) {
        filter.status = status.toUpperCase();
    }


    // Filter by club
    if (clubId) {
        filter.club = clubId;
    }


    // Filter upcoming events only
    if (upcoming === "true") {
        filter.date = { $gte: new Date() };
    }


    // Pagination
    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;


    const events = await Event.find(filter)
        .populate("club", "name category")
        .populate("createdBy", "name email")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNumber);


    const totalEvents = await Event.countDocuments(filter);


    return {
        events,
        totalEvents,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalEvents / limitNumber),
        limit: limitNumber
    };
};



// GET EVENT BY ID
const getEventById = async (eventId) => {

    const event = await Event.findById(eventId)
        .populate("club", "name category logo")
        .populate("createdBy", "name email")
        .populate("registeredUsers", "name email");

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    return event;
};



// UPDATE EVENT
const updateEvent = async (eventId, eventData) => {

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    const {
        name,
        description,
        date,
        time,
        venue,
        registrationDeadline,
        bannerImage,
        maxAttendees
    } = eventData;

    if (name !== undefined) event.name = name;
    if (description !== undefined) event.description = description;
    if (date !== undefined) event.date = date;
    if (time !== undefined) event.time = time;
    if (venue !== undefined) event.venue = venue;
    if (registrationDeadline !== undefined) event.registrationDeadline = registrationDeadline;
    if (bannerImage !== undefined) event.bannerImage = bannerImage;
    if (maxAttendees !== undefined) event.maxAttendees = maxAttendees;

    const updatedEvent = await event.save();

    return await updatedEvent.populate([
        { path: "club", select: "name category" },
        { path: "createdBy", select: "name email" }
    ]);
};



// APPROVE / REJECT EVENT (admin action)
const updateEventStatus = async (eventId, status) => {

    const validStatuses = ["APPROVED", "REJECTED", "CANCELLED"];

    if (!validStatuses.includes(status)) {
        throw new AppError(
            `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
            400
        );
    }

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    event.status = status;

    const updatedEvent = await event.save();

    return await updatedEvent.populate([
        { path: "club", select: "name category" },
        { path: "createdBy", select: "name email" }
    ]);
};



// DELETE EVENT
const deleteEvent = async (eventId) => {

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    await Event.findByIdAndDelete(eventId);

    return event;
};



// REGISTER USER FOR EVENT
const registerForEvent = async (eventId, userId) => {

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    if (event.status !== "APPROVED") {
        throw new AppError(
            "Can only register for approved events",
            400
        );
    }


    // Check registration deadline
    if (new Date() > event.registrationDeadline) {
        throw new AppError(
            "Registration deadline has passed",
            400
        );
    }


    // Check if user exists
    const user = await User.findById(userId);

    if (!user) {
        throw new AppError("User not found", 404);
    }


    // Check if already registered
    if (event.registeredUsers.includes(userId)) {
        throw new AppError(
            "User is already registered for this event",
            409
        );
    }


    // Check max attendees
    if (
        event.maxAttendees &&
        event.registeredUsers.length >= event.maxAttendees
    ) {
        throw new AppError(
            "Event has reached maximum number of attendees",
            400
        );
    }


    event.registeredUsers.push(userId);
    await event.save();

    return await event.populate([
        { path: "club", select: "name category" },
        { path: "registeredUsers", select: "name email" }
    ]);
};



// UNREGISTER USER FROM EVENT
const unregisterFromEvent = async (eventId, userId) => {

    const event = await Event.findById(eventId);

    if (!event) {
        throw new AppError("Event not found", 404);
    }

    const userIndex = event.registeredUsers.indexOf(userId);

    if (userIndex === -1) {
        throw new AppError(
            "User is not registered for this event",
            404
        );
    }

    event.registeredUsers.splice(userIndex, 1);
    await event.save();
};



// GET EVENTS BY CLUB
const getEventsByClub = async (clubId) => {

    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError("Club not found", 404);
    }

    const events = await Event.find({ club: clubId })
        .populate("createdBy", "name email")
        .sort({ date: 1 });

    return events;
};


module.exports = {
    createEvent,
    getAllEvents,
    getEventById,
    updateEvent,
    updateEventStatus,
    deleteEvent,
    registerForEvent,
    unregisterFromEvent,
    getEventsByClub
};
