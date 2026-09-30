const Event = require("../models/Event");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { EVENT_STATUS } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { env } = require("../config/env");
const { toDateKey, dateKeyToDate } = require("../utils/UniversityRules");
const { offsetMinutes } = require("../utils/CampusTime");
const { isAdmin, isFaculty } = require("./AuthorizationService");
const { clubIdsWithAnyPermission } = require("./MembershipService");
const { pausedClubIds } = require("./ClubStatusService");
const { audienceOf } = require("./VenueService");

const DAY = 86400000;
const offsetMs = () => offsetMinutes() * 60000;
const MAX_DAYS = 31;

// What takes up a slot: live and approved events, plus ones waiting for the mentor (shown as tentative).
// Drafts, returned, rejected and cancelled events don't hold time.
const CONFIRMED = [EVENT_STATUS.PUBLISHED, EVENT_STATUS.APPROVED, EVENT_STATUS.COMPLETED];
const TENTATIVE = [EVENT_STATUS.PENDING_APPROVAL];

// Clubs whose events the user plans (officers with event authority), or [] for others.
const plannerClubIds = (actor) => clubIdsWithAnyPermission(actor._id, [CLUB_PERMISSIONS.MANAGE_EVENTS, CLUB_PERMISSIONS.PUBLISH_EVENTS]);

/** The admin, faculty and club officers who plan events can see the whole campus schedule. */
const assertCanPlan = async (actor) => {
    if (isAdmin(actor) || isFaculty(actor)) return [];
    const clubs = await plannerClubIds(actor);
    if (!clubs.length) {
        throw new AppError("The event planner is for club officers, mentors and the admin", 403, ERROR_CODES.FORBIDDEN);
    }
    return clubs;
};

/**
 * Every event holding time between `from` (a university-calendar date, default today) and the following
 * `days` days, so clubs can see what's already on before they pick a slot. Times are UTC; the page
 * lays them out in the university's timezone (`timezoneOffset`).
 */
const getSchedule = async (actor, query = {}) => {
    const myClubs = await assertCanPlan(actor);
    const fromKey = query.from ? toDateKey(query.from) : toDateKey(new Date(Date.now() + offsetMs()));
    const days = Math.min(Math.max(Number.parseInt(query.days, 10) || 7, 1), MAX_DAYS);
    const from = new Date(dateKeyToDate(fromKey).getTime() - offsetMs());
    const to = new Date(from.getTime() + days * DAY);

    const paused = await pausedClubIds();
    const filter = {
        status: { $in: [...CONFIRMED, ...TENTATIVE] },
        startAt: { $lt: to },
        endAt: { $gt: from }
    };
    if (paused.length) filter.club = { $nin: paused };

    const events = await Event.find(filter)
        .select("title category status startAt endAt club venue eligibility registeredCount maxParticipants revision.status")
        .populate("club", "name logo allDepartments departmentCodes")
        .populate("venue", "name location")
        .sort({ startAt: 1 })
        .lean();

    const mine = new Set(myClubs.map(String));
    return {
        from: from.toISOString(),
        to: to.toISOString(),
        fromDate: fromKey,
        days,
        timezoneOffset: env.timezoneOffset,
        items: events
            .filter((event) => event.club)
            .map((event) => ({
                _id: event._id,
                title: event.title,
                category: event.category,
                status: event.status,
                tentative: TENTATIVE.includes(event.status),
                startAt: event.startAt,
                endAt: event.endAt,
                club: { _id: event.club._id, name: event.club.name, logo: event.club.logo },
                venue: event.venue ? { _id: event.venue._id, name: event.venue.name, location: event.venue.location } : null,
                audience: audienceOf(event.club, event.eligibility?.departments),
                batches: event.eligibility?.batches || [],
                registeredCount: event.registeredCount || 0,
                maxParticipants: event.maxParticipants ?? null,
                mine: mine.has(String(event.club._id))
            }))
    };
};

module.exports = { getSchedule, assertCanPlan };
