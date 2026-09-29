const Club = require("../models/Club");
const ClubCreationRequest = require("../models/ClubCreationRequest");
const ClubMembership = require("../models/ClubMembership");
const Event = require("../models/Event");
const EventMedia = require("../models/EventMedia");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const EventResult = require("../models/EventResult");
const Notification = require("../models/Notification");
const {
    CLUB_REQUEST_STATUS,
    CLUB_STATUS,
    EVENT_STATUS,
    MEMBERSHIP_STATUS,
    REGISTRATION_STATUS,
    RESULT_STATUS,
    GALLERY_STATUS
} = require("../constants/Statuses");
const { CLUB_ROLES } = require("../constants/Roles");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { permissionsFor, roleName } = require("../utils/ClubRoles");
const { isAdmin, isFaculty } = require("./AuthorizationService");
const { unreadCount } = require("./NotificationService");
const { getStats } = require("./AdminService");
const { getMyRegistrations } = require("./RegistrationService");
const { registrationWindowState, listEvents } = require("./EventService");
const { attendedCountsByEvent } = require("./CheckInService");
const { phaseOf, listDrivesToReview } = require("./RecruitmentService");
const { myApplications } = require("./ApplicationService");

const eventCard = "title startAt endAt startTime endTime status registeredCount maxParticipants waitlistCount poster club venue category registrationEnd registrationStart registrationClosed participationMode minTeamSize maxTeamSize";

const withState = (events) => events.map((event) => ({ ...event.toObject(), registrationState: registrationWindowState(event) }));

const INSIGHT_EVENTS = 12;
const round1 = (value) => Math.round(value * 10) / 10;

// The president's numbers for their club. "Events" are the ones that reached campus (published or
// completed); drafts and events in review are reported separately as the pipeline.
const clubInsights = async (clubId, memberCount, now = new Date()) => {
    const [hosted, pipeline] = await Promise.all([
        Event.find({ club: clubId, status: { $in: [EVENT_STATUS.PUBLISHED, EVENT_STATUS.COMPLETED] } })
            .select("title startAt endAt status registeredCount maxParticipants waitlistCount")
            .sort({ startAt: -1 })
            .lean(),
        Event.countDocuments({
            club: clubId,
            status: { $in: [EVENT_STATUS.DRAFT, EVENT_STATUS.NEEDS_CHANGES, EVENT_STATUS.PENDING_APPROVAL, EVENT_STATUS.APPROVED] }
        })
    ]);

    const attendedByEvent = await attendedCountsByEvent(hosted.map((event) => event._id));
    const attendedOf = (event) => attendedByEvent.get(String(event._id)) || 0;
    // Attendance rate over completed events: people who were checked in at the door out of those registered.
    const completed = hosted.filter((event) => event.status === EVENT_STATUS.COMPLETED && event.registeredCount);
    const completedRegistered = completed.reduce((sum, event) => sum + event.registeredCount, 0);
    const completedAttended = completed.reduce((sum, event) => sum + attendedOf(event), 0);

    const totalRegistrations = hosted.reduce((sum, event) => sum + (event.registeredCount || 0), 0);
    const capped = hosted.filter((event) => event.maxParticipants);
    const seats = capped.reduce((sum, event) => sum + event.maxParticipants, 0);
    const seatsTaken = capped.reduce((sum, event) => sum + (event.registeredCount || 0), 0);

    return {
        totalMembers: memberCount,
        totalEvents: hosted.length,
        eventsInPipeline: pipeline,
        totalRegistrations,
        upcomingEvents: hosted.filter((event) => event.status === EVENT_STATUS.PUBLISHED && event.startAt > now).length,
        completedEvents: hosted.filter((event) => event.status === EVENT_STATUS.COMPLETED).length,
        averageParticipation: hosted.length ? round1(totalRegistrations / hosted.length) : 0,
        // Share of offered seats that were taken, across events with a participant limit.
        seatFillRate: seats ? Math.round((seatsTaken / seats) * 100) : null,
        waitlisted: hosted.reduce((sum, event) => sum + (event.waitlistCount || 0), 0),
        attendanceRate: completedRegistered ? Math.round((completedAttended / completedRegistered) * 100) : null,
        totalAttended: hosted.reduce((sum, event) => sum + attendedOf(event), 0),
        eventWise: hosted.slice(0, INSIGHT_EVENTS).map((event) => ({
            _id: event._id,
            title: event.title,
            startAt: event.startAt,
            status: event.status,
            upcoming: event.status === EVENT_STATUS.PUBLISHED && event.startAt > now,
            registered: event.registeredCount || 0,
            capacity: event.maxParticipants || null,
            waitlist: event.waitlistCount || 0,
            attended: attendedOf(event)
        }))
    };
};

// The president's recruitment drive in progress, with what needs doing next for each role.
const recruitmentSummary = async (clubId, now) => {
    const drive = await RecruitmentDrive.findOne({ club: clubId, status: { $in: ["DRAFT", "PENDING_APPROVAL", "NEEDS_CHANGES", "APPROVED", "PUBLISHED"] } }).sort({ createdAt: -1 });
    if (!drive) {
        return null;
    }
    const applications = await RecruitmentApplication.find({ drive: drive._id, status: { $in: ["APPLIED", "IN_ROUNDS", "OFFERED", "RESERVE"] } }).select("position status pendingOutcome slots");
    const positions = drive.positions.map((position) => {
        const mine = applications.filter((application) => String(application.position) === String(position._id));
        const round = position.rounds[position.rounds.length - 1] || null;
        const active = mine.filter((application) => ["APPLIED", "IN_ROUNDS"].includes(application.status));
        const undecided = round && round.status !== "RESULTS_PUBLISHED" ? active.filter((application) => String(application.pendingOutcome?.round) !== String(round._id) || !application.pendingOutcome?.outcome).length : 0;
        const next = active
            .flatMap((application) => application.slots.filter((slot) => round && String(slot.round) === String(round._id) && slot.startAt > now))
            .sort((a, b) => a.startAt - b.startAt)[0];
        return {
            _id: position._id,
            title: position.title,
            finalizedAt: position.finalizedAt,
            applications: active.length,
            pendingOffers: mine.filter((application) => application.status === "OFFERED").length,
            round: round ? { _id: round._id, name: round.name, mode: round.mode, status: round.status, undecided } : null,
            nextInterviewAt: next ? next.startAt : null
        };
    });
    return {
        _id: drive._id,
        title: drive.title,
        status: drive.status,
        phase: phaseOf(drive, now),
        reviewComment: drive.reviewComment,
        applicationEnd: drive.applicationEnd,
        applications: applications.filter((application) => ["APPLIED", "IN_ROUNDS"].includes(application.status)).length,
        positions
    };
};

const clubWorkspace = async (membership) => {
    const clubId = membership.club._id;
    const permissions = permissionsFor(membership.club, membership.role);
    const has = (permission) => permissions.includes(permission);
    const now = new Date();

    const [recruitment, memberCount, events, completedIds] = await Promise.all([
        has(CLUB_PERMISSIONS.MANAGE_RECRUITMENT) ? recruitmentSummary(clubId, now) : Promise.resolve(null),
        ClubMembership.countDocuments({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED }),
        Event.find({
            club: clubId,
            status: {
                $in: [
                    EVENT_STATUS.DRAFT,
                    EVENT_STATUS.NEEDS_CHANGES,
                    EVENT_STATUS.PENDING_APPROVAL,
                    EVENT_STATUS.APPROVED,
                    EVENT_STATUS.PUBLISHED
                ]
            }
        })
            .select(eventCard + " reviewComment revision.status revision.fields revision.reviewComment")
            .populate("venue", "name")
            .sort({ startAt: 1 }),
        Event.find({ club: clubId, status: EVENT_STATUS.COMPLETED }).select("_id title startAt").sort({ startAt: -1 }).limit(20)
    ]);

    // Gallery uploads waiting for the president or vice-president, per event.
    const galleryReview = has(CLUB_PERMISSIONS.MODERATE_GALLERY)
        ? await EventMedia.aggregate([
              { $match: { club: clubId, status: GALLERY_STATUS.PENDING } },
              { $group: { _id: "$event", pending: { $sum: 1 } } },
              { $lookup: { from: "events", localField: "_id", foreignField: "_id", as: "event", pipeline: [{ $project: { title: 1 } }] } },
              { $unwind: "$event" },
              { $project: { _id: "$event._id", title: "$event.title", pending: 1 } },
              { $sort: { pending: -1 } }
          ])
        : [];

    const published = await EventResult.find({ event: { $in: completedIds.map((e) => e._id) } }).select("event status");
    const resultByEvent = new Map(published.map((r) => [String(r.event), r.status]));
    const byStatus = (status) => withState(events.filter((event) => event.status === status));

    return {
        club: membership.club,
        role: membership.role,
        roleName: roleName(membership.club, membership.role),
        permissions,
        memberCount,
        recruitment,
        drafts: byStatus(EVENT_STATUS.DRAFT),
        needsChanges: byStatus(EVENT_STATUS.NEEDS_CHANGES),
        pendingApproval: byStatus(EVENT_STATUS.PENDING_APPROVAL),
        readyToPublish: byStatus(EVENT_STATUS.APPROVED),
        // Edits to published events: waiting for the mentor, sent back, or approved and ready to go live.
        changesInReview: withState(events.filter((event) => event.revision?.status)),
        upcoming: byStatus(EVENT_STATUS.PUBLISHED).filter((event) => event.endAt > now),
        awaitingCompletion: byStatus(EVENT_STATUS.PUBLISHED).filter((event) => event.endAt <= now),
        resultsPending: has(CLUB_PERMISSIONS.MANAGE_RESULTS)
            ? completedIds
                  .filter((event) => resultByEvent.get(String(event._id)) !== RESULT_STATUS.PUBLISHED)
                  .map((event) => ({ ...event.toObject(), resultStatus: resultByEvent.get(String(event._id)) || null }))
            : [],
        galleryReview,
        insights: has(CLUB_PERMISSIONS.MANAGE_CLUB) ? await clubInsights(clubId, memberCount, now) : null
    };
};

// Every event appears in exactly one place on the student dashboard: the student's own schedule
// (registered), their club workspace (clubs they help run) or the recommendations (everything else
// they can still register for).
const studentDashboard = async (actor) => {
    const now = new Date();
    const memberships = await ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).populate(
        "club",
        "name logo category status president mentor allDepartments departmentCodes roles"
    );

    const valid = memberships.filter((m) => m.club);
    const approved = valid;
    // A workspace for every club where the student holds some authority.
    const officerships = approved.filter((m) => permissionsFor(m.club, m.role).length > 0 && m.club.status === CLUB_STATUS.ACTIVE);

    const [upcomingAll, pastRegistrations, clubRequests, recentNotifications, workspaces, applications] = await Promise.all([
        getMyRegistrations(actor, { timeframe: "upcoming", includeWaitlist: "true" }),
        getMyRegistrations(actor, { timeframe: "past" }),
        ClubCreationRequest.find({ $or: [{ requester: actor._id }, { foundingMembers: actor._id }] })
            .select("name status updatedAt reviewComment rejectionReason club")
            .sort({ updatedAt: -1 })
            .limit(5),
        Notification.find({ user: actor._id }).sort({ createdAt: -1 }).limit(5),
        Promise.all(officerships.map(clubWorkspace)),
        myApplications(actor)
    ]);

    const upcomingRegistrations = upcomingAll.filter((r) => r.status === REGISTRATION_STATUS.REGISTERED);
    const waitlistedRegistrations = upcomingAll.filter((r) => r.status === REGISTRATION_STATUS.WAITLISTED);
    // Events the student holds or queues for a seat at are never recommended again.
    const registeredIds = new Set([...upcomingAll, ...pastRegistrations].map((r) => String(r.event._id)));

    // Club workspaces manage their own events; events the student is attending live in their schedule.
    for (const workspace of workspaces) {
        workspace.upcoming = workspace.upcoming.filter((event) => !registeredIds.has(String(event._id)));
    }
    const managedClubIds = officerships.map((m) => m.club._id);
    const myClubIds = new Set(approved.map((m) => String(m.club._id)));

    const eligibleFor = (field, value) => ({ $or: [{ [`eligibility.${field}`]: { $size: 0 } }, { [`eligibility.${field}`]: value }] });

    const openEvents = await Event.find({
        status: EVENT_STATUS.PUBLISHED,
        startAt: { $gt: now },
        registrationClosed: false,
        registrationEnd: { $gte: now },
        _id: { $nin: [...registeredIds] },
        club: { $nin: managedClubIds },
        $and: [eligibleFor("departments", actor.departmentCode), eligibleFor("batches", actor.batchCode)]
    })
        .select(eventCard + " shortDescription eligibility")
        .populate("club", "name logo")
        .populate("venue", "name")
        .sort({ startAt: 1 })
        .limit(12);

    // Events from the student's own clubs first, then by date.
    const recommended = withState(openEvents)
        .filter((event) => event.registrationState === "OPEN")
        .map((event) => ({ ...event, fromMyClub: myClubIds.has(String(event.club?._id)) }))
        .sort((a, b) => Number(b.fromMyClub) - Number(a.fromMyClub) || a.startAt - b.startAt)
        .slice(0, 6);

    const pastEventIds = pastRegistrations.map((r) => r.event._id);
    const withResults = new Set(
        (await EventResult.find({ event: { $in: pastEventIds }, status: RESULT_STATUS.PUBLISHED }).select("event")).map((r) => String(r.event))
    );

    return {
        stats: {
            upcoming: upcomingRegistrations.length,
            attended: pastRegistrations.filter((r) => r.event.status === EVENT_STATUS.COMPLETED).length,
            clubs: approved.length,
            applications: applications.filter((application) => ["APPLIED", "IN_ROUNDS"].includes(application.status)).length,
            waitlisted: waitlistedRegistrations.length
        },
        upcomingRegistrations: upcomingRegistrations.slice(0, 6),
        waitlistedRegistrations: waitlistedRegistrations.slice(0, 6),
        pastRegistrations: pastRegistrations
            .sort((a, b) => b.event.startAt - a.event.startAt)
            .slice(0, 6)
            .map((r) => ({ ...r.toObject(), hasResults: withResults.has(String(r.event._id)) })),
        memberships: valid.map((m) => ({ _id: m._id, role: m.role, status: m.status, club: m.club })),
        clubWorkspaces: workspaces,
        // Applications still in play, plus results from the last month.
        applications: applications.filter((application) => ["APPLIED", "IN_ROUNDS"].includes(application.status) || now - new Date(application.createdAt) < 30 * 86400000).slice(0, 6),
        clubRequests,
        recommended,
        recentNotifications
    };
};

const facultyDashboard = async (actor) => {
    const mentored = await Club.find({ mentor: actor._id }).populate("president", "name email").sort({ name: 1 });
    const clubIds = mentored.map((club) => club._id);

    const [requestsToReview, verifiedRequests, eventsToReview, upcomingEvents, memberCounts, drivesToReview] = await Promise.all([
        ClubCreationRequest.find({
            status: CLUB_REQUEST_STATUS.PENDING_FACULTY_REVIEW,
            $or: [{ proposedMentor: actor._id }, { proposedMentor: null }]
        })
            .populate("requester", "name email departmentCode")
            .sort({ createdAt: 1 })
            .limit(20),
        ClubCreationRequest.find({ verifiedBy: actor._id, status: CLUB_REQUEST_STATUS.FACULTY_VERIFIED })
            .select("name status verifiedAt")
            .limit(10),
        Event.find({ club: { $in: clubIds }, $or: [{ status: EVENT_STATUS.PENDING_APPROVAL }, { "revision.status": "PENDING_APPROVAL" }] })
            .select(eventCard + " submittedAt revision.status revision.fields revision.requestedAt")
            .populate("club", "name logo")
            .populate("venue", "name")
            .sort({ submittedAt: 1 }),
        Event.find({ club: { $in: clubIds }, status: EVENT_STATUS.PUBLISHED, endAt: { $gt: new Date() } })
            .select(eventCard)
            .populate("club", "name logo")
            .populate("venue", "name")
            .sort({ startAt: 1 })
            .limit(10),
        ClubMembership.aggregate([
            { $match: { club: { $in: clubIds }, status: MEMBERSHIP_STATUS.APPROVED } },
            { $group: { _id: "$club", count: { $sum: 1 } } }
        ]),
        listDrivesToReview(actor)
    ]);

    const counts = new Map(memberCounts.map((row) => [String(row._id), row.count]));

    return {
        mentoredClubs: mentored.map((club) => ({ ...club.toObject(), memberCount: counts.get(String(club._id)) || 0 })),
        clubsAwaitingPresident: mentored.filter((club) => club.status === CLUB_STATUS.APPROVED && !club.president),
        requestsToReview,
        verifiedRequests,
        eventsToReview: withState(eventsToReview),
        drivesToReview,
        upcomingEvents: withState(upcomingEvents)
    };
};

const adminDashboard = async (actor) => {
    const [stats, awaitingApproval, recentClubs] = await Promise.all([
        getStats(actor),
        ClubCreationRequest.find({ status: CLUB_REQUEST_STATUS.FACULTY_VERIFIED })
            .populate("requester", "name email")
            .populate("verifiedBy", "name email")
            .sort({ verifiedAt: 1 })
            .limit(20),
        Club.find().populate("mentor", "name").populate("president", "name").sort({ createdAt: -1 }).limit(8)
    ]);

    return { stats, awaitingApproval, recentClubs };
};

const getDashboard = async (actor) => {
    const base = { role: actor.globalRole, unreadNotifications: await unreadCount(actor) };
    const campusEvents = async () => (await listEvents(actor, { timeframe: "upcoming", limit: 6 })).items;

    if (isAdmin(actor)) {
        return { ...base, campusEvents: await campusEvents(), admin: await adminDashboard(actor) };
    }

    if (isFaculty(actor)) {
        const faculty = await facultyDashboard(actor);
        // Events of the faculty's own clubs are already listed in their section.
        const own = new Set(faculty.upcomingEvents.map((event) => String(event._id)));
        return { ...base, campusEvents: (await campusEvents()).filter((event) => !own.has(String(event._id))), faculty };
    }

    return { ...base, student: await studentDashboard(actor) };
};

module.exports = { getDashboard };
