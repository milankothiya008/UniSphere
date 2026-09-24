const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const Event = require("../models/Event");
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
const { CLUB_PERMISSIONS, CLUB_ROLE_PERMISSIONS } = require("../constants/Permissions");
const { escapeRegex, searchRegex, parsePagination, paginationMeta } = require("../utils/Query");
const {
    isAdmin,
    assertAdmin,
    getClubContext,
    contextHas,
    assertClubMentor
} = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify, notifyAllUsers } = require("./NotificationService");
const { withTransaction, maybeSession } = require("../utils/Transaction");
const { scopeIncludes, assertMentorMatchesScope, assertStudentsMatchScope } = require("../utils/DepartmentScope");
const { normalizeUrl, normalizeSocialLinks } = require("../utils/ClubLinks");
const { isSubscribed, followerCount } = require("./SubscriptionService");

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{6,18}[0-9]$/;

const ROLE_ORDER = Object.values(CLUB_ROLES);

const populateClub = (query) =>
    query.populate("president", "name email departmentCode batchCode").populate("mentor", "name email departmentCode");

const memberCounts = async (clubIds) => {
    const rows = await ClubMembership.aggregate([
        { $match: { club: { $in: clubIds }, status: MEMBERSHIP_STATUS.APPROVED } },
        { $group: { _id: "$club", count: { $sum: 1 } } }
    ]);
    return new Map(rows.map((row) => [String(row._id), row.count]));
};

const withCounts = async (clubs) => {
    const counts = await memberCounts(clubs.map((club) => club._id));
    return clubs.map((club) => ({ ...club.toObject(), memberCount: counts.get(String(club._id)) || 0 }));
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

    return { items: await withCounts(clubs), ...paginationMeta(pagination, total) };
};

const viewerSummary = (context, pendingMembership) => ({
    role: context.role,
    permissions: context.permissions,
    isMember: context.isMember,
    isMentor: context.isMentor,
    isAdmin: context.isAdmin,
    membershipStatus: context.isMember ? MEMBERSHIP_STATUS.APPROVED : pendingMembership?.status || null
});

const getClub = async (actor, clubId) => {
    const context = await getClubContext(actor, clubId);
    const { club } = context;

    // Admins may open any club (to change its status or mentor), but get no club permissions from it.
    if (club.status !== CLUB_STATUS.ACTIVE && !context.isAdmin && !context.isMentor && !context.isMember) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const [populated, counts, pendingMembership, upcomingEvents, followers, subscribed] = await Promise.all([
        populateClub(Club.findById(club._id)),
        memberCounts([club._id]),
        actor && !context.isMember ? ClubMembership.findOne({ club: club._id, user: actor._id }).select("status") : null,
        Event.countDocuments({ club: club._id, status: EVENT_STATUS.PUBLISHED, startAt: { $gte: new Date() } }),
        followerCount(club._id),
        actor ? isSubscribed(actor._id, club._id) : false
    ]);

    return {
        ...populated.toObject(),
        memberCount: counts.get(String(club._id)) || 0,
        followerCount: followers,
        upcomingEvents,
        viewer: actor ? { ...viewerSummary(context, pendingMembership), subscribed } : null
    };
};

const getMyClubs = async (actor) => {
    const [memberships, mentored] = await Promise.all([
        ClubMembership.find({ user: actor._id, status: { $in: [MEMBERSHIP_STATUS.APPROVED, MEMBERSHIP_STATUS.PENDING] } })
            .populate({ path: "club", populate: { path: "president", select: "name" } })
            .sort({ updatedAt: -1 }),
        populateClub(Club.find({ mentor: actor._id }).sort({ name: 1 }))
    ]);

    const valid = memberships.filter((membership) => membership.club);

    return {
        memberships: valid.map((membership) => ({
            _id: membership._id,
            role: membership.role,
            status: membership.status,
            joinedAt: membership.joinedAt,
            permissions: membership.status === MEMBERSHIP_STATUS.APPROVED ? CLUB_ROLE_PERMISSIONS[membership.role] : [],
            club: membership.club
        })),
        mentored: await withCounts(mentored)
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

const changeClubStatus = async (actor, clubId, status, reason = null) => {
    assertAdmin(actor);

    if (!Object.values(CLUB_STATUS).includes(status)) {
        throw new AppError("Invalid club status", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const club = await Club.findById(clubId);

    if (!club) {
        throw new AppError("Club not found", 404, ERROR_CODES.NOT_FOUND);
    }

    if (status === CLUB_STATUS.ACTIVE && !club.president) {
        throw new AppError("A president must be assigned before the club can become active", 409, ERROR_CODES.INVALID_STATE);
    }

    const from = club.status;
    club.status = status;
    await club.save();

    await recordAudit({
        action: AUDIT_ACTIONS.CLUB_STATUS_CHANGED,
        actor: actor._id,
        targetType: "Club",
        targetId: club._id,
        fromState: from,
        toState: status,
        reason
    });

    await notify([club.president, club.mentor], {
        type: NOTIFICATION_TYPES.CLUB_UPDATE,
        title: `${club.name} is now ${status.toLowerCase()}`,
        message: reason || "",
        link: `/clubs/${club._id}`
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

    if (!context.isMentor && !context.isMember) {
        throw new AppError("Only club members and the club's mentor can view the member list", 403, ERROR_CODES.FORBIDDEN);
    }

    const members = await ClubMembership.find({ club: context.club._id, status: MEMBERSHIP_STATUS.APPROVED })
        .populate("user", "name email departmentCode batchCode")
        .sort({ joinedAt: 1 });

    return members
        .filter((member) => member.user)
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
};

module.exports = {
    listClubs,
    getClub,
    getMyClubs,
    updateClub,
    changeClubStatus,
    setMentor,
    assignPresident,
    listClubMembers
};
