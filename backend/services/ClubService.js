const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const Event = require("../models/Event");
const RecruitmentApplication = require("../models/RecruitmentApplication");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const {
    CLUB_STATUS,
    MEMBERSHIP_STATUS,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES,
    EVENT_STATUS
} = require("../constants/Statuses");
const { GLOBAL_ROLES, ACCOUNT_TYPES, CLUB_ROLES } = require("../constants/Roles");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { permissionsFor, roleName, roleRank } = require("../utils/ClubRoles");
const { escapeRegex, searchRegex, parsePagination, paginationMeta } = require("../utils/Query");
const {
    isAdmin,
    assertAdmin,
    getClubContext,
    canSeeMemberDirectory,
    canSeeFacultyContacts,
    contextHas,
    assertClubMentor
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify, notifyAllUsers } = require("./NotificationService");
const { withTransaction, maybeSession } = require("../utils/Transaction");
const { scopeIncludes, assertMentorMatchesScope, assertStudentsMatchScope } = require("../utils/DepartmentScope");
const { normalizeUrl, normalizeSocialLinks } = require("../utils/ClubLinks");
const { isSubscribed, followerCount } = require("./SubscriptionService");
const { openDrivesByClub } = require("./RecruitmentService");

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,18}[0-9]$/;


// Phone numbers only for the single-club view, which then removes them for viewers who may not see them.
const populateClub = (query, { withPhones = false } = {}) =>
    query
        .populate("president", `name email departmentCode batchCode avatar${withPhones ? " phone" : ""}`)
        .populate("mentor", `name email departmentCode avatar${withPhones ? " phone" : ""}`);

const memberCounts = async (clubIds) => {
    const rows = await ClubMembership.aggregate([
        { $match: { club: { $in: clubIds }, status: MEMBERSHIP_STATUS.APPROVED } },
        { $group: { _id: "$club", count: { $sum: 1 } } }
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
};

const withCounts = async (clubs) => {
    const ids = clubs.map((club) => club._id);
    const [counts, open] = await Promise.all([memberCounts(ids), openDrivesByClub(ids)]);
    return clubs.map((club) => ({ ...club.toObject(), memberCount: counts.get(String(club._id)) || 0, recruiting: open.get(String(club._id)) || null }));
};

const listClubs = async (actor, query = {}) => {
    const pagination = parsePagination(query, { defaultLimit: 12 });
    const filter = {};

    // Only admins browse clubs that are not active; everyone else sees the public directory.
    if (isAdmin(actor) && query.status) {
        if (query.status !== "ALL") {
            filter.status = String(query.status).toUpperCase();
        }
    } else {
        filter.status = CLUB_STATUS.ACTIVE;
    }

    if (query.search) {
        filter.name = searchRegex(query.search);
    }
    if (query.category) {
        filter.category = String(query.category).toUpperCase();
    }
    if (query.department) {
        Object.assign(filter, scopeIncludes(query.department));
    }

    const [clubs, total] = await Promise.all([
        populateClub(Club.find(filter).sort({ name: 1 }).skip(pagination.skip).limit(pagination.limit)),
        Club.countDocuments(filter)
    ]);

    const items = await withCounts(clubs);
    // The admin's status notes are for the admin, the club's leaders and its mentor only.
    if (!isAdmin(actor)) {
        items.forEach((item) => delete item.statusNote);
    }
    return { items, ...paginationMeta(pagination, total) };
};

const viewerSummary = (context, applications = []) => ({
    role: context.role,
    roleName: context.roleName,
    permissions: context.permissions,
    isMember: context.isMember,
    isMentor: context.isMentor,
    isAdmin: context.isAdmin,
    membershipStatus: context.isMember ? MEMBERSHIP_STATUS.APPROVED : null,
    // The viewer's applications (one per role) to the club's current recruitment drive.
    applications: applications.map((application) => ({ _id: application._id, status: application.status, position: application.position }))
});

const getClub = async (actor, clubId) => {
    const context = await getClubContext(actor, clubId);
    const { club } = context;

    // Admins may open any club (to change its status or mentor), but get no club permissions from it.
    if (club.status !== CLUB_STATUS.ACTIVE && !context.isAdmin && !context.isMentor && !context.isMember) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const insider = context.isMember || context.isMentor || context.isAdmin;
    const [populated, counts, openDrives, upcomingEvents, followers, subscribed, canSeeMembers] = await Promise.all([
        populateClub(Club.findById(club._id), { withPhones: true }),
        memberCounts([club._id]),
        openDrivesByClub([club._id]),
        Event.countDocuments({ club: club._id, status: EVENT_STATUS.PUBLISHED, startAt: { $gte: new Date() } }),
        followerCount(club._id),
        actor ? isSubscribed(actor._id, club._id) : false,
        insider || canSeeMemberDirectory(actor)
    ]);

    const recruiting = openDrives.get(String(club._id)) || null;
    const applications =
        actor && recruiting ? await RecruitmentApplication.find({ drive: recruiting._id, applicant: actor._id, status: { $ne: "WITHDRAWN" } }).select("status position") : [];

    const clubView = populated.toObject();
    if (!insider) {
        delete clubView.statusNote;
    }
    // Contact numbers: the mentor's for club members anywhere, faculty and the admin; the president's like
    // any member's number (club members, mentors, the admin).
    if (clubView.mentor && !(actor && (await canSeeFacultyContacts(actor)))) delete clubView.mentor.phone;
    if (clubView.president && !canSeeMembers) delete clubView.president.phone;
    return {
        ...clubView,
        memberCount: counts.get(String(club._id)) || 0,
        followerCount: followers,
        upcomingEvents,
        recruiting,
        viewer: actor ? { ...viewerSummary(context, applications), subscribed, canSeeMembers } : null
    };
};

// A user joined in as { _id, ...fields } (or null), inside an aggregation.
const lookupUser = (field, fields) => [
    { $lookup: { from: User.collection.name, localField: field, foreignField: "_id", as: field, pipeline: [{ $project: Object.fromEntries(fields.split(" ").map((name) => [name, 1])) }] } },
    { $set: { [field]: { $ifNull: [{ $first: `$${field}` }, null] } } }
];

/**
 * The signed-in user's clubs (loaded on every visit): memberships with their clubs, and the clubs they
 * mentor with member counts. Each list is one aggregation, so the page waits for two round trips, not six.
 */
const getMyClubs = async (actor) => {
    const [memberships, mentored] = await Promise.all([
        ClubMembership.aggregate([
            { $match: { user: actor._id, status: MEMBERSHIP_STATUS.APPROVED } },
            { $sort: { updatedAt: -1 } },
            { $lookup: { from: Club.collection.name, localField: "club", foreignField: "_id", as: "club", pipeline: lookupUser("president", "name") } },
            { $unwind: "$club" }
        ]),
        Club.aggregate([
            { $match: { mentor: actor._id } },
            { $sort: { name: 1 } },
            ...lookupUser("president", "name email departmentCode batchCode"),
            ...lookupUser("mentor", "name email departmentCode"),
            {
                $lookup: {
                    from: ClubMembership.collection.name,
                    localField: "_id",
                    foreignField: "club",
                    as: "memberCount",
                    pipeline: [{ $match: { status: MEMBERSHIP_STATUS.APPROVED } }, { $count: "n" }]
                }
            },
            { $set: { memberCount: { $ifNull: [{ $first: "$memberCount.n" }, 0] } } }
        ])
    ]);
    const open = mentored.length ? await openDrivesByClub(mentored.map((club) => club._id)) : new Map();

    return {
        memberships: memberships.map((membership) => ({
            _id: membership._id,
            role: membership.role,
            roleName: roleName(membership.club, membership.role),
            status: membership.status,
            joinedAt: membership.joinedAt,
            permissions: permissionsFor(membership.club, membership.role),
            club: membership.club
        })),
        mentored: mentored.map((club) => ({ ...club, recruiting: open.get(String(club._id)) || null }))
    };
};

const updateClub = async (actor, clubId, data) => {
    const context = await getClubContext(actor, clubId);

    // Only the club's own leadership edits its profile — not the mentor and not the university admin.
    if (!contextHas(context, CLUB_PERMISSIONS.MANAGE_CLUB)) {
        throw new AppError("Only club members with the 'manage club' permission can edit club details", 403, ERROR_CODES.FORBIDDEN);
    }

    const { club } = context;
    const fields = ["description", "purpose", "logo", "category", "contactEmail"];
    const changed = [];

    fields.forEach((field) => {
        if (data[field] !== undefined) {
            club[field] = data[field] === "" ? null : data[field];
            changed.push(field);
        }
    });

    ["tagline", "meetingSchedule", "meetingLocation"].forEach((field) => {
        if (data[field] !== undefined) {
            club[field] = String(data[field] ?? "").trim();
            changed.push(field);
        }
    });

    if (data.coverImage !== undefined) {
        club.coverImage = data.coverImage || null;
        changed.push("coverImage");
    }

    if (data.website !== undefined) {
        club.website = normalizeUrl(data.website, { label: "Website" });
        changed.push("website");
    }

    if (data.contactPhone !== undefined) {
        const phone = String(data.contactPhone ?? "").trim();
        if (phone && !PHONE_PATTERN.test(phone)) {
            throw new AppError("Enter a valid phone number, e.g. +91 98765 43210", 400, ERROR_CODES.VALIDATION_ERROR);
        }
        club.contactPhone = phone || null;
        changed.push("contactPhone");
    }

    if (data.socialLinks !== undefined) {
        club.socialLinks = normalizeSocialLinks(data.socialLinks || {});
        changed.push("socialLinks");
    }

    if (data.name !== undefined && String(data.name).trim() !== club.name) {
        const name = String(data.name).trim();
        const exact = new RegExp(`^${escapeRegex(name)}$`, "i");
        if (await Club.exists({ name: exact, _id: { $ne: club._id } })) {
            throw new AppError("Another club already uses this name", 409, ERROR_CODES.CONFLICT);
        }
        club.name = name;
        changed.push("name");
    }

    await club.save();

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_UPDATED,
        actor: actor._id,
        targetType: "Club",
        targetId: club._id,
        metadata: { fields: changed }
    });

    return getClub(actor, club._id);
};

const setMentor = async (actor, clubId, mentorId) => {
    assertAdmin(actor);

    const club = await Club.findById(clubId);
    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const mentor = await User.findOne({ _id: mentorId, globalRole: GLOBAL_ROLES.FACULTY, isActive: true });
    if (!mentor) {
        throw new AppError("Mentor must be an active faculty member", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    assertMentorMatchesScope(mentor, club);

    const previous = club.mentor;
    club.mentor = mentor._id;
    await club.save();

    await recordAudit({
        action: AUDIT_ACTIONS.MENTOR_ASSIGNED,
        actor: actor._id,
        targetType: "Club",
        targetId: club._id,
        metadata: { previousMentor: previous, mentorId: mentor._id }
    });

    await notify(mentor._id, {
        type: NOTIFICATION_TYPES.CLUB_UPDATE,
        title: `You are now mentor of ${club.name}`,
        message: "You will review this club's events and can appoint its president.",
        link: `/clubs/${club._id}`,
        email: true
    });

    return getClub(actor, club._id);
};

const assignPresident = async (actor, clubId, userId) => {
    const { club } = await assertClubMentor(actor, clubId, "Only the club's faculty mentor can appoint the president");

    if (![CLUB_STATUS.APPROVED, CLUB_STATUS.ACTIVE].includes(club.status)) {
        throw new AppError("A president can only be appointed for an approved or active club", 409, ERROR_CODES.INVALID_STATE);
    }

    const user = await User.findById(userId);

    if (
        !user ||
        !user.isActive ||
        !user.isEmailVerified ||
        user.accountType !== ACCOUNT_TYPES.STUDENT ||
        user.globalRole !== GLOBAL_ROLES.STUDENT
    ) {
        throw new AppError("President must be an active, verified student", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    assertStudentsMatchScope([user], club, { clubName: club.name });

    if (club.president && String(club.president) === String(user._id)) {
        throw new AppError("This student is already the president", 409, ERROR_CODES.CONFLICT);
    }

    const previous = club.president;
    const firstActivation = club.status === CLUB_STATUS.APPROVED;

    await withTransaction(async (session) => {
        if (previous) {
            await ClubMembership.updateOne(
                { club: club._id, user: previous, role: CLUB_ROLES.PRESIDENT },
                { $set: { role: CLUB_ROLES.MEMBER } },
                maybeSession(session)
            );
        }

        await ClubMembership.findOneAndUpdate(
            { club: club._id, user: user._id },
            {
                $set: {
                    role: CLUB_ROLES.PRESIDENT,
                    status: MEMBERSHIP_STATUS.APPROVED,
                    decidedBy: actor._id,
                    decidedAt: new Date()
                },
                $setOnInsert: { joinedAt: new Date() }
            },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, ...maybeSession(session) }
        );

        await ClubMembership.updateOne(
            { club: club._id, user: user._id, joinedAt: null },
            { $set: { joinedAt: new Date() } },
            maybeSession(session)
        );

        club.president = user._id;
        if (firstActivation) {
            club.status = CLUB_STATUS.ACTIVE;
        }
        await club.save(maybeSession(session));

        await recordAudit({
            action: AUDIT_ACTIONS.PRESIDENT_ASSIGNED,
            actor: actor._id,
            targetType: "Club",
            targetId: club._id,
            fromState: firstActivation ? CLUB_STATUS.APPROVED : club.status,
            toState: club.status,
            metadata: { previousPresident: previous, presidentId: user._id },
            session
        });
    });

    await notify(user._id, {
        type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
        title: `You are now president of ${club.name}`,
        message: "You can now manage members, create events and publish updates for your club.",
        link: `/clubs/${club._id}`,
        email: true
    });

    if (previous) {
        await notify(previous, {
            type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
            title: `New president for ${club.name}`,
            message: `${user.name} has been appointed president. You remain a member.`,
            link: `/clubs/${club._id}`
        });
    }

    if (firstActivation) {
        await notifyAllUsers({
            type: NOTIFICATION_TYPES.NEW_CLUB,
            title: `New club: ${club.name}`,
            message: club.description.slice(0, 200),
            link: `/clubs/${club._id}`,
            exclude: [actor._id, user._id]
        });
    }

    return getClub(actor, club._id);
};

const listClubMembers = async (actor, clubId) => {
    const context = await getClubContext(actor, clubId);
    const insider = context.isMentor || context.isMember || context.isAdmin;

    // Members of any club, every club mentor and the admin can reach any club's members (and their
    // mobile numbers) to coordinate; students outside all clubs cannot.
    if (!insider && !(await canSeeMemberDirectory(actor))) {
        throw new AppError("Member lists are open to club members, mentors and the admin", 403, ERROR_CODES.FORBIDDEN);
    }
    if (!insider && context.club.status !== CLUB_STATUS.ACTIVE) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const members = await ClubMembership.find({ club: context.club._id, status: MEMBERSHIP_STATUS.APPROVED })
        .populate("user", "name email phone departmentCode batchCode avatar")
        .sort({ joinedAt: 1 });

    return members
        .filter((member) => member.user)
        .sort((a, b) => roleRank(context.club, a.role) - roleRank(context.club, b.role))
        .map((member) => ({ ...member.toObject(), roleName: roleName(context.club, member.role) }));
};

module.exports = {
    listClubs,
    getClub,
    getMyClubs,
    updateClub,
    setMentor,
    assignPresident,
    listClubMembers
};
