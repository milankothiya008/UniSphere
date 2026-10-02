const Team = require("../models/Team");
const Event = require("../models/Event");
const User = require("../models/User");
const EventRegistration = require("../models/EventRegistration");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { GLOBAL_ROLES, ACCOUNT_TYPES } = require("../constants/Roles");
const {
    EVENT_STATUS,
    REGISTRATION_STATUS,
    PARTICIPATION_MODES,
    TEAM_MEMBER_STATUS,
    TEAM_STATUS,
    AUDIT_ACTIONS,
    NOTIFICATION_TYPES
} = require("../constants/Statuses");
const { EMAIL_CATEGORIES } = require("../constants/EmailCategories");
const { escapeRegex } = require("../utils/Query");
const { formatDateKey } = require("../utils/UniversityRules");
const { assertVerified, assertStudent } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { withTicketRetry, sendTicketEmail } = require("./TicketService");

// Team registration, the way Unstop does it: the leader registers the team (which takes the team's place,
// or its spot on the waitlist) and invites teammates; each invitee accepts or declines. Accepted members get
// their own registration linked to the team, with the leader's status. A team reaching the minimum size is
// "complete"; organisers see incomplete teams flagged.

const ACTIVE = [REGISTRATION_STATUS.REGISTERED, REGISTRATION_STATUS.WAITLISTED];
const { LEADER, INVITED, ACCEPTED, DECLINED, CANCELLED, LEFT, REMOVED } = TEAM_MEMBER_STATUS;
const MEMBER_FIELDS = "name email departmentCode batchCode avatar";

const eventLink = (event) => `/events/${event._id}`;
const conflict = (message) => new AppError(message, 409, ERROR_CODES.INVALID_STATE);

const eligibilityProblem = (user, event) => {
    const departments = event.eligibility?.departments || [];
    const batches = event.eligibility?.batches || [];
    if (departments.length && !departments.includes(user.departmentCode)) {
        return `open to ${departments.join(", ")} students only`;
    }
    if (batches.length && !batches.includes(user.batchCode)) {
        return `open to batch ${batches.map((b) => `20${b}`).join(", ")} only`;
    }
    return null;
};

const findTeamEvent = async (eventId) => {
    const event = await Event.findById(eventId);
    if (!event) {
        throw new AppError("Event not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (event.participationMode !== PARTICIPATION_MODES.TEAM) {
        throw new AppError("This event takes individual registrations, not teams", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    return event;
};

// Teams can take shape until registration closes (organisers closing new sign-ups early doesn't stop
// existing teams from filling their places).
const assertTeamsOpen = (event, now = new Date()) => {
    if (event.status !== EVENT_STATUS.PUBLISHED) {
        throw conflict("Teams can only change for published events");
    }
    if (now > event.registrationEnd || now >= event.startAt) {
        throw conflict("Registration has closed, so teams can no longer change");
    }
};

const activeMembers = (team) => team.members.filter((member) => [LEADER, ACCEPTED].includes(member.status));
const pendingInvites = (team) => team.members.filter((member) => member.status === INVITED);

const normalizeTeamName = (name) => {
    const value = String(name || "").trim().replace(/\s+/g, " ");
    if (value.length < 2 || value.length > 60) {
        throw new AppError("Team name must be 2-60 characters", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    return value;
};

// Checks a list of students the leader wants to invite. Everyone must be a verified student eligible for the
// event, not already registered for it, and not already on this team.
const checkInvitees = async (event, leaderId, userIds, team = null) => {
    const ids = [...new Set((userIds || []).map(String))];
    if (ids.includes(String(leaderId))) {
        throw new AppError("You're already on your team — invite your teammates", 400, ERROR_CODES.VALIDATION_ERROR);
    }
    if (!ids.length) {
        return [];
    }

    const onTeam = new Set((team?.members || []).filter((member) => [LEADER, ACCEPTED, INVITED].includes(member.status)).map((member) => String(member.user)));
    const already = ids.filter((id) => onTeam.has(id));
    if (already.length) {
        throw new AppError("Some of these students are already on your team or invited", 409, ERROR_CODES.CONFLICT);
    }

    const taken = activeMembers(team || { members: [] }).length || 1;
    const room = event.maxTeamSize - taken - pendingInvites(team || { members: [] }).length;
    if (ids.length > room) {
        throw new AppError(
            room > 0 ? `Your team has room for ${room} more invite${room === 1 ? "" : "s"} (teams have up to ${event.maxTeamSize} members)` : `Your team is at the maximum of ${event.maxTeamSize} members, counting pending invites`,
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }

    const users = await User.find({ _id: { $in: ids } }).select(`${MEMBER_FIELDS} accountType globalRole isEmailVerified isActive`);
    if (users.length !== ids.length) {
        throw new AppError("Some of the invited students could not be found", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    for (const user of users) {
        if (user.globalRole !== GLOBAL_ROLES.STUDENT || user.accountType !== ACCOUNT_TYPES.STUDENT || !user.isEmailVerified || user.isActive === false) {
            throw new AppError(`${user.name} can't join teams (only verified student accounts can)`, 400, ERROR_CODES.VALIDATION_ERROR);
        }
        const problem = eligibilityProblem(user, event);
        if (problem) {
            throw new AppError(`${user.name} can't join: this event is ${problem}`, 403, ERROR_CODES.NOT_ELIGIBLE);
        }
    }

    const registered = await EventRegistration.find({ event: event._id, user: { $in: ids }, status: { $in: ACTIVE } }).populate("user", "name");
    if (registered.length) {
        throw new AppError(`${registered.map((row) => row.user?.name).join(", ")} ${registered.length === 1 ? "is" : "are"} already registered for this event`, 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }
    return users;
};

const sendInvites = async (team, event, leader, invitees) => {
    if (!invitees.length) {
        return;
    }
    await recordAudit({
        action: AUDIT_ACTIONS.TEAM_INVITE_SENT,
        actor: leader._id,
        targetType: "Team",
        targetId: team._id,
        metadata: { eventId: event._id, invited: invitees.map((user) => user._id) }
    });
    await notify(
        invitees.map((user) => user._id),
        {
            type: NOTIFICATION_TYPES.TEAM_INVITE,
            title: `${leader.name} invited you to join "${team.name}" for ${event.title}`,
            message: `Accept the invite to be registered with the team for ${formatDateKey(event.eventDate)} at ${event.startTime}. Invites can be answered until registration closes.`,
            link: eventLink(event),
            email: true,
            emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY
        }
    );
};

// Called by RegistrationService when the leader registers: creates the team before the leader's place is taken.
const createTeam = async (leader, event, { teamName, invitees = [] }) => {
    const name = normalizeTeamName(teamName);
    const users = await checkInvitees(event, leader._id, invitees);
    let team;
    try {
        team = await Team.create({
            event: event._id,
            name,
            nameKey: name.toLowerCase(),
            leader: leader._id,
            members: [{ user: leader._id, status: LEADER, respondedAt: new Date() }, ...users.map((user) => ({ user: user._id, status: INVITED }))],
            size: 1
        });
    } catch (error) {
        if (error.code === 11000) {
            throw new AppError(`A team called "${name}" is already registered for this event — pick another name`, 409, ERROR_CODES.CONFLICT);
        }
        throw error;
    }
    return { team, invitees: users };
};

const afterTeamCreated = async (team, event, leader, invitees) => {
    await recordAudit({ action: AUDIT_ACTIONS.TEAM_CREATED, actor: leader._id, targetType: "Team", targetId: team._id, metadata: { eventId: event._id, name: team.name } });
    await sendInvites(team, event, leader, invitees);
};

const discardTeam = (team) => Team.deleteOne({ _id: team._id });

const loadLeaderTeam = async (actor, event) => {
    const team = await Team.findOne({ event: event._id, leader: actor._id, status: TEAM_STATUS.ACTIVE });
    if (!team) {
        throw new AppError("Only the team leader can manage the team", 403, ERROR_CODES.FORBIDDEN);
    }
    return team;
};

const inviteMembers = async (actor, eventId, userIds) => {
    const event = await findTeamEvent(eventId);
    assertTeamsOpen(event);
    const team = await loadLeaderTeam(actor, event);
    const users = await checkInvitees(event, actor._id, userIds, team);
    if (!users.length) {
        throw new AppError("Choose at least one student to invite", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const now = new Date();
    users.forEach((user) => {
        const previous = team.members.find((member) => String(member.user) === String(user._id));
        if (previous) {
            previous.status = INVITED;
            previous.invitedAt = now;
            previous.respondedAt = null;
        } else {
            team.members.push({ user: user._id, status: INVITED, invitedAt: now });
        }
    });
    await team.save();
    await sendInvites(team, event, actor, users);
    return getTeamView(team._id);
};

// Removes a member (or withdraws an invite). Removing an accepted member cancels their registration.
const removeMember = async (actor, eventId, userId) => {
    const event = await findTeamEvent(eventId);
    assertTeamsOpen(event);
    const team = await loadLeaderTeam(actor, event);
    if (String(userId) === String(actor._id)) {
        throw new AppError("To leave, cancel the team's registration instead", 400, ERROR_CODES.VALIDATION_ERROR);
    }

    const member = team.members.find((entry) => String(entry.user) === String(userId) && [INVITED, ACCEPTED].includes(entry.status));
    if (!member) {
        throw new AppError("That student isn't on your team", 404, ERROR_CODES.NOT_FOUND);
    }

    const wasMember = member.status === ACCEPTED;
    const updated = await Team.findOneAndUpdate(
        { _id: team._id, members: { $elemMatch: { user: member.user, status: member.status } } },
        { $set: { "members.$.status": wasMember ? REMOVED : CANCELLED, "members.$.respondedAt": new Date() }, ...(wasMember ? { $inc: { size: -1 } } : {}) },
        { returnDocument: "after" }
    );
    if (!updated) {
        throw conflict("The team changed in the meantime — refresh and try again");
    }

    if (wasMember) {
        await EventRegistration.updateOne({ event: event._id, user: member.user, team: team._id, status: { $in: ACTIVE } }, { $set: { status: REGISTRATION_STATUS.CANCELLED } });
        await recordAudit({ action: AUDIT_ACTIONS.TEAM_MEMBER_REMOVED, actor: actor._id, targetType: "Team", targetId: team._id, metadata: { eventId: event._id, userId: member.user } });
        await notify(member.user, {
            type: NOTIFICATION_TYPES.TEAM_UPDATE,
            title: `You were removed from "${team.name}" for ${event.title}`,
            message: "Your registration through the team was cancelled and your ticket is no longer valid. You can register again on your own or with another team while registration is open.",
            link: eventLink(event),
            email: true,
            emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY
        });
    }
    return getTeamView(team._id);
};

// The invitee's answer. Accepting registers them with the team's status (registered or waitlisted).
const respondToInvite = async (actor, eventId, teamId, accept) => {
    assertVerified(actor);
    assertStudent(actor, "Only students can join teams");
    const event = await findTeamEvent(eventId);
    const team = await Team.findOne({ _id: teamId, event: event._id });
    const invite = team?.members.find((member) => String(member.user) === String(actor._id) && member.status === INVITED);
    if (!team || team.status !== TEAM_STATUS.ACTIVE || !invite) {
        throw new AppError("This invite is no longer available", 404, ERROR_CODES.NOT_FOUND);
    }
    const leader = await User.findById(team.leader).select("name");

    if (!accept) {
        await Team.updateOne(
            { _id: team._id, members: { $elemMatch: { user: actor._id, status: INVITED } } },
            { $set: { "members.$.status": DECLINED, "members.$.respondedAt": new Date() } }
        );
        await recordAudit({ action: AUDIT_ACTIONS.TEAM_INVITE_DECLINED, actor: actor._id, targetType: "Team", targetId: team._id, metadata: { eventId: event._id } });
        await notify(team.leader, {
            type: NOTIFICATION_TYPES.TEAM_UPDATE,
            title: `${actor.name} declined your invite to "${team.name}"`,
            message: `Invite someone else for ${event.title} while registration is open.`,
            link: eventLink(event)
        });
        return { accepted: false, team: await getTeamView(team._id) };
    }

    assertTeamsOpen(event);
    const problem = eligibilityProblem(actor, event);
    if (problem) {
        throw new AppError(`This event is ${problem}`, 403, ERROR_CODES.NOT_ELIGIBLE);
    }
    const existing = await EventRegistration.findOne({ event: event._id, user: actor._id });
    if (existing && ACTIVE.includes(existing.status)) {
        throw new AppError("You're already registered for this event. Cancel that registration first to join this team.", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
    }

    const leaderRegistration = await EventRegistration.findOne({ team: team._id, teamRole: "LEADER", status: { $in: ACTIVE } });
    if (!leaderRegistration) {
        throw new AppError("This team is no longer registered", 409, ERROR_CODES.INVALID_STATE);
    }

    // Claim a spot on the team atomically, so two people accepting at once can't overfill it.
    const now = new Date();
    const claimed = await Team.findOneAndUpdate(
        { _id: team._id, status: TEAM_STATUS.ACTIVE, size: { $lt: event.maxTeamSize }, members: { $elemMatch: { user: actor._id, status: INVITED } } },
        { $set: { "members.$.status": ACCEPTED, "members.$.respondedAt": now }, $inc: { size: 1 } },
        { returnDocument: "after" }
    );
    if (!claimed) {
        throw conflict(`"${team.name}" is already full`);
    }

    let registration;
    try {
        const fields = {
            status: leaderRegistration.status,
            team: team._id,
            teamRole: "MEMBER",
            registeredAt: now,
            waitlistedAt: leaderRegistration.status === REGISTRATION_STATUS.WAITLISTED ? leaderRegistration.waitlistedAt : null,
            promotedAt: null
        };
        // Joining a registered team issues the member's own ticket; a waitlisted team's members get theirs on promotion.
        const issueTicket = leaderRegistration.status === REGISTRATION_STATUS.REGISTERED;
        registration = await withTicketRetry((ticket) => {
            const doc = { ...fields, ...(issueTicket ? ticket : {}) };
            return existing
                ? EventRegistration.findOneAndUpdate({ _id: existing._id, status: REGISTRATION_STATUS.CANCELLED }, { $set: doc }, { returnDocument: "after" })
                : EventRegistration.create({ event: event._id, user: actor._id, ...doc });
        });
        if (!registration) {
            throw new AppError("You're already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
        }
    } catch (error) {
        await Team.updateOne({ _id: team._id, members: { $elemMatch: { user: actor._id, status: ACCEPTED } } }, { $set: { "members.$.status": INVITED, "members.$.respondedAt": null }, $inc: { size: -1 } });
        if (error.code === 11000) {
            throw new AppError("You're already registered for this event", 409, ERROR_CODES.DUPLICATE_REGISTRATION);
        }
        throw error;
    }

    // One team per event: other invites for the same event are withdrawn.
    const others = await Team.find({ event: event._id, _id: { $ne: team._id }, status: TEAM_STATUS.ACTIVE, members: { $elemMatch: { user: actor._id, status: INVITED } } }).select("_id leader name");
    if (others.length) {
        await Team.updateMany(
            { _id: { $in: others.map((other) => other._id) }, members: { $elemMatch: { user: actor._id, status: INVITED } } },
            { $set: { "members.$.status": DECLINED, "members.$.respondedAt": now } }
        );
    }

    await recordAudit({ action: AUDIT_ACTIONS.TEAM_INVITE_ACCEPTED, actor: actor._id, targetType: "Team", targetId: team._id, metadata: { eventId: event._id, registrationId: registration._id } });

    const complete = claimed.size >= event.minTeamSize;
    await notify(team.leader, {
        type: NOTIFICATION_TYPES.TEAM_UPDATE,
        title: `${actor.name} joined "${team.name}"`,
        message: complete ? `Your team now has ${claimed.size} members and is complete.` : `Your team has ${claimed.size} of the ${event.minTeamSize} members it needs.`,
        link: eventLink(event)
    });
    const waitlisted = registration.status === REGISTRATION_STATUS.WAITLISTED;
    await notify(actor._id, {
        type: NOTIFICATION_TYPES.REGISTRATION_CONFIRMED,
        title: waitlisted ? `You joined "${team.name}" — the team is on the waitlist for ${event.title}` : `You're registered for ${event.title} with "${team.name}"`,
        message: waitlisted
            ? "If a place opens up, the whole team is registered automatically and we'll email you."
            : `${leader?.name || "Your team leader"} leads the team. See you on ${formatDateKey(event.eventDate)} at ${event.startTime}. Your ticket is ready — show its QR code at the entrance.`,
        link: eventLink(event),
        email: waitlisted
    });
    if (!waitlisted) {
        await sendTicketEmail(registration._id, { reason: "team" });
    }

    return { accepted: true, waitlisted, registration, team: await getTeamView(team._id) };
};

// A member leaving on their own (called from RegistrationService.cancelRegistration).
const leaveTeam = async (actor, event, registration) => {
    const cancelled = await EventRegistration.findOneAndUpdate(
        { _id: registration._id, status: { $in: ACTIVE } },
        { $set: { status: REGISTRATION_STATUS.CANCELLED } },
        { returnDocument: "after" }
    );
    if (!cancelled) {
        throw new AppError("You are not registered for this event", 404, ERROR_CODES.NOT_FOUND);
    }
    const team = await Team.findOneAndUpdate(
        { _id: registration.team, members: { $elemMatch: { user: actor._id, status: ACCEPTED } } },
        { $set: { "members.$.status": LEFT, "members.$.respondedAt": new Date() }, $inc: { size: -1 } },
        { returnDocument: "after" }
    );
    await recordAudit({ action: AUDIT_ACTIONS.TEAM_MEMBER_LEFT, actor: actor._id, targetType: "Team", targetId: registration.team, metadata: { eventId: event._id } });
    if (team) {
        await notify(team.leader, {
            type: NOTIFICATION_TYPES.TEAM_UPDATE,
            title: `${actor.name} left "${team.name}"`,
            message: team.size < event.minTeamSize ? `Your team needs ${event.minTeamSize - team.size} more member${event.minTeamSize - team.size === 1 ? "" : "s"} to be complete.` : "Your team is still complete.",
            link: eventLink(event),
            email: true,
            emailCategory: EMAIL_CATEGORIES.EVENT_ACTIVITY
        });
    }
    return { leftTeam: true };
};

// Ends a team whose leader cancelled (or was removed): members' registrations and open invites are cancelled.
const disbandTeam = async (teamId, event, { actor, byOrganiser = false, reason = null } = {}) => {
    const team = await Team.findOneAndUpdate(
        { _id: teamId, status: TEAM_STATUS.ACTIVE },
        { $set: { status: TEAM_STATUS.DISBANDED, disbandedAt: new Date() } },
        { returnDocument: "after" }
    );
    if (!team) {
        return;
    }
    const members = await EventRegistration.find({ team: team._id, teamRole: "MEMBER", status: { $in: ACTIVE } }).select("user");
    await EventRegistration.updateMany({ _id: { $in: members.map((row) => row._id) } }, { $set: { status: REGISTRATION_STATUS.CANCELLED } });
    team.members.forEach((member) => {
        if (member.status === INVITED) {
            member.status = CANCELLED;
        }
    });
    await team.save();

    await recordAudit({ action: AUDIT_ACTIONS.TEAM_DISBANDED, actor: actor?._id || team.leader, targetType: "Team", targetId: team._id, reason, metadata: { eventId: event._id, byOrganiser } });
    await notify(
        members.map((row) => row.user),
        {
            type: NOTIFICATION_TYPES.TEAM_UPDATE,
            title: `"${team.name}" is no longer registered for ${event.title}`,
            message: byOrganiser
                ? `The organisers removed the team${reason ? `: ${reason}` : "."} Your ticket is no longer valid.`
                : "The team leader cancelled the team's registration, so your ticket is no longer valid. You can register again on your own or with another team while registration is open.",
            link: eventLink(event),
            email: true
        }
    );
};

// ---------------------------------------------------------------- Views

const memberView = (member, users) => {
    const user = users.get(String(member.user));
    return {
        user: user ? { _id: user._id, name: user.name, email: user.email, departmentCode: user.departmentCode, batchCode: user.batchCode } : { _id: member.user, name: "Former student" },
        status: member.status,
        invitedAt: member.invitedAt,
        respondedAt: member.respondedAt
    };
};

const getTeamView = async (teamId, event = null) => {
    const team = await Team.findById(teamId).lean();
    if (!team) {
        return null;
    }
    const teamEvent = event || (await Event.findById(team.event).select("minTeamSize maxTeamSize"));
    const shown = team.members.filter((member) => [LEADER, ACCEPTED, INVITED].includes(member.status));
    const users = new Map((await User.find({ _id: { $in: shown.map((member) => member.user) } }).select(MEMBER_FIELDS).lean()).map((user) => [String(user._id), user]));
    const leaderRegistration = await EventRegistration.findOne({ team: team._id, teamRole: "LEADER" }).select("status").lean();

    return {
        _id: team._id,
        name: team.name,
        status: team.status,
        registrationStatus: leaderRegistration?.status || null,
        leader: memberView({ user: team.leader, status: LEADER }, users).user,
        members: shown.filter((member) => member.status !== INVITED).map((member) => memberView(member, users)),
        invites: shown.filter((member) => member.status === INVITED).map((member) => memberView(member, users)),
        size: team.size,
        minSize: teamEvent.minTeamSize,
        maxSize: teamEvent.maxTeamSize,
        complete: team.size >= teamEvent.minTeamSize,
        createdAt: team.createdAt
    };
};

// Pending invites for one student, optionally for one event, with who sent them.
const invitesFor = async (user, { eventId = null } = {}) => {
    const teams = await Team.find({
        status: TEAM_STATUS.ACTIVE,
        members: { $elemMatch: { user: user._id, status: INVITED } },
        ...(eventId ? { event: eventId } : {})
    })
        .populate("leader", "name")
        .populate({ path: "event", select: "title startAt endAt startTime eventDate status registrationEnd minTeamSize maxTeamSize poster category club", populate: { path: "club", select: "name logo" } })
        .sort({ createdAt: -1 })
        .lean();

    const now = new Date();
    return teams
        .filter((team) => team.event && team.event.status === EVENT_STATUS.PUBLISHED && team.event.registrationEnd > now && team.event.startAt > now)
        .map((team) => ({
            team: { _id: team._id, name: team.name, size: team.size, leader: team.leader },
            event: team.event,
            invitedAt: team.members.find((member) => String(member.user) === String(user._id))?.invitedAt
        }));
};

// Students the leader can invite: verified, eligible, and not yet registered for the event.
const searchCandidates = async (actor, eventId, search) => {
    const event = await findTeamEvent(eventId);
    const text = String(search || "").trim();
    if (text.length < 2) {
        return [];
    }
    const pattern = new RegExp(escapeRegex(text).slice(0, 60), "i");
    const filter = {
        _id: { $ne: actor._id },
        globalRole: GLOBAL_ROLES.STUDENT,
        accountType: ACCOUNT_TYPES.STUDENT,
        isEmailVerified: true,
        isActive: { $ne: false },
        $or: [{ name: pattern }, { email: pattern }]
    };
    if (event.eligibility?.departments?.length) {
        filter.departmentCode = { $in: event.eligibility.departments };
    }
    if (event.eligibility?.batches?.length) {
        filter.batchCode = { $in: event.eligibility.batches };
    }

    const users = await User.find(filter).select(MEMBER_FIELDS).sort({ name: 1 }).limit(20).lean();
    const taken = new Set(
        (await EventRegistration.find({ event: event._id, user: { $in: users.map((user) => user._id) }, status: { $in: ACTIVE } }).select("user").lean()).map((row) => String(row.user))
    );
    return users.map((user) => ({ ...user, available: !taken.has(String(user._id)) })).slice(0, 10);
};

module.exports = {
    createTeam,
    afterTeamCreated,
    discardTeam,
    inviteMembers,
    removeMember,
    respondToInvite,
    leaveTeam,
    disbandTeam,
    getTeamView,
    invitesFor,
    searchCandidates,
    normalizeTeamName
};
