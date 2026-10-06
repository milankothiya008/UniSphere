const mongoose = require("mongoose");
const ClubElection = require("../models/ClubElection");
const ElectionBallot = require("../models/ElectionBallot");
const ClubMembership = require("../models/ClubMembership");
const User = require("../models/User");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { CLUB_STATUS, ELECTION_STATUS: S, MEMBERSHIP_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS } = require("../constants/Statuses");
const { SYSTEM, findRole, roleName } = require("../utils/ClubRoles");
const { getClubContext, contextHas, assertClubPermission } = require("./AuthorizationService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");
const { formatDate, formatTime } = require("../utils/CampusTime");
const logger = require("../utils/Logger");

// Club elections, like a student body vote:
// - Someone with "Run elections" (the president always) picks a role and 2–10 candidates from the members,
//   and sets when voting opens and closes. Until it opens, everything can still be edited.
// - Every member who was in the club when voting opened gets one secret vote. Votes are final. Only *that*
//   a member voted is recorded (ElectionBallot); the choice is just added to the candidate's count, which
//   nobody sees until voting closes. Turnout ("12 of 30 voted") is visible meanwhile.
// - When voting closes the counts are shown to the club. The result is advisory: the president still
//   appoints the role. A tie can go to a runoff between the tied candidates.
// The faculty mentor follows along (read-only) and hears the result; the election card and notices go to
// the club group chat, and only the club's members are notified — nobody else on campus.

const RUN = CLUB_PERMISSIONS.RUN_ELECTIONS;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 10;
const MIN_VOTING_MINUTES = 10;
const MAX_VOTING_DAYS = 14;
const LIVE = [S.SCHEDULED, S.OPEN];
const MINUTE = 60 * 1000;

const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.CONFLICT);
const notFound = () => new AppError("Election not found", 404, ERROR_CODES.NOT_FOUND);
const idOf = (value) => String(value?._id || value || "");
const joinedOf = (membership) => membership?.joinedAt || membership?.createdAt || null;
const USER_FIELDS = "name avatar departmentCode batchCode";
const userView = (user) =>
    user
        ? { _id: user._id, name: user.name, avatar: user.avatar || null, departmentCode: user.departmentCode || null, batchCode: user.batchCode || null }
        : null;
const chat = () => require("./ChatService");

const approvedMembers = (clubId) => ClubMembership.find({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED }).select("user role joinedAt createdAt").lean();

/** Members who may vote: in the club (approved) since before voting opened. */
const voterIds = async (election) =>
    (await approvedMembers(election.club)).filter((row) => joinedOf(row) && new Date(joinedOf(row)) <= new Date(election.opensAt)).map((row) => idOf(row.user));

const isVoter = (membership, election) =>
    Boolean(
        membership && membership.status === MEMBERSHIP_STATUS.APPROVED && joinedOf(membership) && new Date(joinedOf(membership)) <= new Date(election.opensAt)
    );

const loadElection = async (id) => {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const election = await ClubElection.findById(id);
    if (!election) throw notFound();
    return election;
};

/** Elections are internal to the club: its members and its faculty mentor. */
const viewContext = async (actor, clubId) => {
    const context = await getClubContext(actor, clubId);
    if (!context.isMember && !context.isMentor) throw notFound();
    return context;
};

const manageContext = async (actor, clubId) => {
    const context = await assertClubPermission(actor, clubId, RUN, "Only members who can run elections can do this");
    if (context.club.status !== CLUB_STATUS.ACTIVE) throw new AppError("Only active clubs can hold elections", 409, ERROR_CODES.CLUB_NOT_ACTIVE);
    return context;
};

// ---------------------------------------------------------------- Results

const standings = (election) => {
    const sorted = [...election.candidates].sort((a, b) => b.votes - a.votes);
    const top = sorted[0]?.votes || 0;
    const leaders = top > 0 ? sorted.filter((candidate) => candidate.votes === top) : [];
    return { sorted, top, leaders, tie: leaders.length > 1 };
};

const resultLine = async (election) => {
    const { leaders, top, tie } = standings(election);
    if (!leaders.length) return `No votes were cast in “${election.title}”.`;
    const names = (
        await User.find({ _id: { $in: leaders.map((candidate) => candidate.user) } })
            .select("name")
            .lean()
    ).map((user) => user.name);
    const of = `${top} of ${election.votesCast} vote${election.votesCast === 1 ? "" : "s"}`;
    return tie
        ? `“${election.title}” ended in a tie: ${names.join(" and ")} (${of} each).`
        : `${names[0]} received the most votes in “${election.title}” (${of}).`;
};

// ---------------------------------------------------------------- Opening and closing (also run by the sweeper)

const announceOpen = async (election) => {
    const voters = await voterIds(election);
    const clubName = (await require("../models/Club").findById(election.club).select("name").lean())?.name || "your club";
    await notify(voters, {
        type: NOTIFICATION_TYPES.ELECTION,
        title: `Vote now: ${election.title}`,
        message: `Choose ${clubName}'s next ${election.roleName}. Your vote is secret. Voting closes ${formatDate(election.closesAt)}, ${formatTime(election.closesAt)}.`,
        link: `/clubs/${election.club}/elections/${election._id}`
    });
    await chat().postClubNotice(election.club, `🗳️ Voting is open: ${election.title}`, "ELECTION_OPEN");
};

const announceResult = async (election, { early = false } = {}) => {
    const line = await resultLine(election);
    const Club = require("../models/Club");
    const club = await Club.findById(election.club).select("mentor").lean();
    const members = (await approvedMembers(election.club)).map((row) => idOf(row.user));
    await notify([...members, club?.mentor].filter(Boolean), {
        type: NOTIFICATION_TYPES.ELECTION,
        title: `Results: ${election.title}`,
        message: `${line} The president makes the appointment.`,
        link: `/clubs/${election.club}/elections/${election._id}`
    });
    await chat().postClubNotice(election.club, `🗳️ ${early ? "Voting was closed early. " : "Voting has closed. "}${line}`, "ELECTION_CLOSED");
};

/** Opens voting when its time has come. Safe to call any number of times, from anywhere. */
const openIfDue = async (election, now = new Date()) => {
    if (election.status !== S.SCHEDULED || new Date(election.opensAt) > now) return election;
    const eligibleCount = (await voterIds(election)).length;
    const claimed = await ClubElection.findOneAndUpdate(
        { _id: election._id, status: S.SCHEDULED },
        { $set: { status: S.OPEN, eligibleCount } },
        { returnDocument: "after" }
    );
    if (!claimed) return (await ClubElection.findById(election._id)) || election;
    await announceOpen(claimed).catch((error) => logger.warn("Election open notice failed", { message: error.message }));
    await chat()
        .clubSignal(claimed.club, "election:updated", { electionId: String(claimed._id) })
        .catch(() => {});
    return claimed;
};

const closeNow = async (election, { actor = null, early = false } = {}) => {
    const claimed = await ClubElection.findOneAndUpdate(
        { _id: election._id, status: S.OPEN },
        { $set: { status: S.CLOSED, closedAt: new Date(), closedBy: actor?._id || null } },
        { returnDocument: "after" }
    );
    if (!claimed) return (await ClubElection.findById(election._id)) || election;
    await recordAudit({
        action: AUDIT_ACTIONS.ELECTION_CLOSED,
        actor: actor?._id || claimed.createdBy,
        targetType: "ClubElection",
        targetId: claimed._id,
        metadata: { clubId: claimed.club, early }
    });
    await announceResult(claimed, { early }).catch((error) => logger.warn("Election result notice failed", { message: error.message }));
    await chat()
        .clubSignal(claimed.club, "election:updated", { electionId: String(claimed._id) })
        .catch(() => {});
    return claimed;
};

/** Brings an election up to date with the clock (opens or closes it when due). */
const settle = async (election, now = new Date()) => {
    let current = await openIfDue(election, now);
    if (current.status === S.OPEN && new Date(current.closesAt) <= now) current = await closeNow(current);
    return current;
};

/** Run by the event sweeper every minute. */
const sweepElections = async ({ now = new Date() } = {}) => {
    const due = await ClubElection.find({
        $or: [
            { status: S.SCHEDULED, opensAt: { $lte: now } },
            { status: S.OPEN, closesAt: { $lte: now } }
        ]
    }).limit(100);
    for (const election of due) {
        await settle(election, now);
    }
    return due.length;
};

// ---------------------------------------------------------------- Views

const viewOf = async (elections, actor, context) => {
    const ids = [...new Set(elections.flatMap((election) => [...election.candidates.map((candidate) => idOf(candidate.user)), idOf(election.createdBy)]))];
    const [users, members, ballots] = await Promise.all([
        User.find({ _id: { $in: ids } })
            .select(USER_FIELDS)
            .lean(),
        elections.length ? approvedMembers(elections[0].club) : [],
        actor
            ? ElectionBallot.find({ voter: actor._id, election: { $in: elections.map((election) => election._id) } })
                  .select("election")
                  .lean()
            : []
    ]);
    const userMap = new Map(users.map((user) => [idOf(user), user]));
    const memberSet = new Set(members.map((row) => idOf(row.user)));
    const voted = new Set(ballots.map((ballot) => idOf(ballot.election)));
    const canManage = contextHas(context, RUN) && context.club.status === CLUB_STATUS.ACTIVE;

    return elections.map((election) => {
        const closed = election.status === S.CLOSED;
        const { leaders, tie } = closed ? standings(election) : { leaders: [], tie: false };
        const hasVoted = voted.has(idOf(election._id));
        const eligible = isVoter(context.membership, election);
        return {
            _id: election._id,
            club: election.club,
            role: election.role,
            roleName: election.roleName,
            title: election.title,
            description: election.description,
            status: election.status,
            opensAt: election.opensAt,
            closesAt: election.closesAt,
            eligibleCount: election.status === S.SCHEDULED ? null : election.eligibleCount,
            votesCast: election.status === S.SCHEDULED ? 0 : election.votesCast,
            runoffOf: election.runoffOf,
            createdBy: userView(userMap.get(idOf(election.createdBy))),
            createdAt: election.createdAt,
            closedAt: election.closedAt,
            cancelledAt: election.cancelledAt,
            cancelReason: election.cancelReason || "",
            // Counts only once voting has closed, so nothing can be read from them while it's on.
            candidates: (closed ? standings(election).sorted : election.candidates).map((candidate) => ({
                user: userView(userMap.get(idOf(candidate.user))),
                statement: candidate.statement,
                stillMember: memberSet.has(idOf(candidate.user)),
                votes: closed ? candidate.votes : null,
                leading: closed && leaders.some((leader) => idOf(leader.user) === idOf(candidate.user))
            })),
            result: closed ? { tie, noVotes: !leaders.length, winners: leaders.map((leader) => idOf(leader.user)) } : null,
            viewer: {
                eligible,
                hasVoted,
                canVote: election.status === S.OPEN && eligible && !hasVoted,
                canManage,
                // A runoff makes sense only for a tie that isn't being decided already.
                canRunoff: canManage && closed && tie
            }
        };
    });
};

const viewOne = async (election, actor, context) => (await viewOf([election], actor, context))[0];

// ---------------------------------------------------------------- Validation

const parseCandidates = async (clubId, list) => {
    if (!Array.isArray(list)) throw invalid("Choose the candidates");
    const seen = new Set();
    const candidates = [];
    for (const entry of list) {
        const userId = idOf(entry?.user ?? entry);
        if (!mongoose.isValidObjectId(userId) || seen.has(userId)) continue;
        seen.add(userId);
        candidates.push({
            user: userId,
            statement: String(entry?.statement || "")
                .trim()
                .slice(0, 300)
        });
    }
    if (candidates.length < MIN_CANDIDATES) throw invalid(`Choose at least ${MIN_CANDIDATES} candidates`);
    if (candidates.length > MAX_CANDIDATES) throw invalid(`An election can have at most ${MAX_CANDIDATES} candidates`);
    const members = new Set((await approvedMembers(clubId)).map((row) => idOf(row.user)));
    if (candidates.some((candidate) => !members.has(candidate.user))) throw invalid("Every candidate must be a member of the club");
    return candidates;
};

const parseWindow = ({ opensAt, closesAt }, now = new Date()) => {
    const opens = opensAt ? new Date(opensAt) : now;
    const closes = new Date(closesAt);
    if (Number.isNaN(opens.getTime())) throw invalid("Choose when voting opens");
    if (Number.isNaN(closes.getTime())) throw invalid("Choose when voting closes");
    if (opens.getTime() < now.getTime() - MINUTE) throw invalid("Voting can't open in the past");
    const start = Math.max(opens.getTime(), now.getTime());
    if (closes.getTime() < start + MIN_VOTING_MINUTES * MINUTE) throw invalid(`Keep voting open for at least ${MIN_VOTING_MINUTES} minutes`);
    if (closes.getTime() > start + MAX_VOTING_DAYS * 24 * 60 * MINUTE) throw invalid(`Voting can stay open for at most ${MAX_VOTING_DAYS} days`);
    return { opensAt: opens.getTime() < now.getTime() ? now : opens, closesAt: closes };
};

const assertRole = (club, key) => {
    const role = findRole(club, key);
    if (!role || role.key === SYSTEM.MEMBER) throw invalid("Choose the role this election is for");
    return role;
};

const assertNoOtherLive = async (clubId, role, exceptId = null) => {
    const other = await ClubElection.findOne({ club: clubId, role, status: { $in: LIVE }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })
        .select("_id")
        .lean();
    if (other) throw conflict("There's already an election under way for this role");
};

// ---------------------------------------------------------------- Actions

const listElections = async (actor, clubId) => {
    const context = await viewContext(actor, clubId);
    const elections = await ClubElection.find({ club: context.club._id }).sort({ createdAt: -1 }).limit(50);
    const settled = [];
    for (const election of elections) settled.push(await settle(election));
    return {
        canManage: contextHas(context, RUN) && context.club.status === CLUB_STATUS.ACTIVE,
        items: await viewOf(settled, actor, context)
    };
};

const getElection = async (actor, electionId) => {
    const election = await settle(await loadElection(electionId));
    const context = await viewContext(actor, election.club);
    return viewOne(election, actor, context);
};

const createElection = async (actor, clubId, payload = {}, { runoffOf = null } = {}) => {
    const context = await manageContext(actor, clubId);
    const club = context.club;
    const role = assertRole(club, payload.role);
    await assertNoOtherLive(club._id, role.key);
    const candidates = await parseCandidates(club._id, payload.candidates);
    const window = parseWindow(payload);
    const name = roleName(club, role.key);

    const election = await ClubElection.create({
        club: club._id,
        role: role.key,
        roleName: name,
        title:
            String(payload.title || "")
                .trim()
                .slice(0, 120) || `${name} election`,
        description: String(payload.description || "")
            .trim()
            .slice(0, 1000),
        candidates,
        opensAt: window.opensAt,
        closesAt: window.closesAt,
        runoffOf,
        createdBy: actor._id
    });
    await recordAudit({
        action: AUDIT_ACTIONS.ELECTION_CREATED,
        actor: actor._id,
        targetType: "ClubElection",
        targetId: election._id,
        metadata: { clubId: club._id, role: role.key, runoffOf }
    });

    // The card goes into the club group straight away ("Voting opens at …" until it does).
    await chat()
        .postElectionCard(club._id, election, actor)
        .catch((error) => logger.warn("Election card failed", { message: error.message }));
    return viewOne(await settle(election), actor, context);
};

const updateElection = async (actor, electionId, payload = {}) => {
    const election = await settle(await loadElection(electionId));
    const context = await manageContext(actor, election.club);
    if (election.status !== S.SCHEDULED) throw conflict("An election can be changed only until voting opens");

    if (payload.role !== undefined && payload.role !== election.role) {
        const role = assertRole(context.club, payload.role);
        await assertNoOtherLive(election.club, role.key, election._id);
        election.role = role.key;
        election.roleName = roleName(context.club, role.key);
    }
    if (payload.title !== undefined)
        election.title =
            String(payload.title || "")
                .trim()
                .slice(0, 120) || `${election.roleName} election`;
    if (payload.description !== undefined)
        election.description = String(payload.description || "")
            .trim()
            .slice(0, 1000);
    if (payload.candidates !== undefined) election.candidates = await parseCandidates(election.club, payload.candidates);
    if (payload.opensAt !== undefined || payload.closesAt !== undefined) {
        // opensAt: null means "open it now".
        const window = parseWindow({
            opensAt: payload.opensAt === null ? null : (payload.opensAt ?? election.opensAt),
            closesAt: payload.closesAt ?? election.closesAt
        });
        election.opensAt = window.opensAt;
        election.closesAt = window.closesAt;
    }
    await election.save();
    await recordAudit({
        action: AUDIT_ACTIONS.ELECTION_UPDATED,
        actor: actor._id,
        targetType: "ClubElection",
        targetId: election._id,
        metadata: { clubId: election.club }
    });
    await chat()
        .clubSignal(election.club, "election:updated", { electionId: String(election._id) })
        .catch(() => {});
    return viewOne(await settle(election), actor, context);
};

const vote = async (actor, electionId, candidateId) => {
    const election = await settle(await loadElection(electionId));
    const context = await viewContext(actor, election.club);
    if (election.status !== S.OPEN) throw conflict(election.status === S.SCHEDULED ? "Voting hasn't opened yet" : "Voting has closed");
    if (!isVoter(context.membership, election)) {
        throw new AppError(
            context.isMember ? "Only members who were in the club when voting opened can vote" : "Only club members can vote",
            403,
            ERROR_CODES.FORBIDDEN
        );
    }
    const candidate = election.candidates.find((entry) => idOf(entry.user) === idOf(candidateId));
    if (!candidate) throw invalid("Choose one of the candidates");
    const stillMember = await ClubMembership.exists({ club: election.club, user: candidate.user, status: MEMBERSHIP_STATUS.APPROVED });
    if (!stillMember) throw invalid("This candidate has left the club");

    // One ballot per member (the unique index settles races), then the count goes to the candidate.
    let ballot;
    try {
        ballot = await ElectionBallot.create({ election: election._id, voter: actor._id });
    } catch (error) {
        if (error.code === 11000) throw conflict("You've already voted in this election");
        throw error;
    }
    const counted = await ClubElection.updateOne(
        { _id: election._id, status: S.OPEN, "candidates.user": candidate.user },
        { $inc: { "candidates.$.votes": 1, votesCast: 1 } }
    );
    if (!counted.modifiedCount) {
        await ElectionBallot.deleteOne({ _id: ballot._id });
        throw conflict("Voting has closed");
    }
    await chat()
        .clubSignal(election.club, "election:updated", { electionId: String(election._id) })
        .catch(() => {});
    return viewOne(await ClubElection.findById(election._id), actor, context);
};

const closeElection = async (actor, electionId) => {
    const election = await settle(await loadElection(electionId));
    const context = await manageContext(actor, election.club);
    if (election.status !== S.OPEN)
        throw conflict(election.status === S.SCHEDULED ? "Voting hasn't opened yet — cancel it instead" : "This election has already ended");
    return viewOne(await closeNow(election, { actor, early: true }), actor, context);
};

const cancelElection = async (actor, electionId, reason = "") => {
    const election = await settle(await loadElection(electionId));
    const context = await manageContext(actor, election.club);
    if (!LIVE.includes(election.status)) throw conflict("This election has already ended");
    const wasOpen = election.status === S.OPEN;
    const note = String(reason || "")
        .trim()
        .slice(0, 300);
    const claimed = await ClubElection.findOneAndUpdate(
        { _id: election._id, status: { $in: LIVE } },
        { $set: { status: S.CANCELLED, cancelledAt: new Date(), cancelReason: note } },
        { returnDocument: "after" }
    );
    if (!claimed) throw conflict("This election has already ended");
    await recordAudit({
        action: AUDIT_ACTIONS.ELECTION_CANCELLED,
        actor: actor._id,
        targetType: "ClubElection",
        targetId: claimed._id,
        metadata: { clubId: claimed.club, reason: note }
    });

    // Voters had been told to vote, so they hear it was called off; before opening, the group notice is enough.
    if (wasOpen) {
        await notify(await voterIds(claimed), {
            type: NOTIFICATION_TYPES.ELECTION,
            title: `Cancelled: ${claimed.title}`,
            message: note || "The election was cancelled. No result will be announced.",
            link: `/clubs/${claimed.club}/elections/${claimed._id}`,
            exclude: [actor._id]
        });
    }
    await chat()
        .postClubNotice(claimed.club, `🗳️ “${claimed.title}” was cancelled${note ? `: ${note}` : "."}`, "ELECTION_CANCELLED")
        .catch(() => {});
    await chat()
        .clubSignal(claimed.club, "election:updated", { electionId: String(claimed._id) })
        .catch(() => {});
    return viewOne(claimed, actor, context);
};

/** A new vote between the candidates who tied. */
const startRunoff = async (actor, electionId, payload = {}) => {
    const election = await settle(await loadElection(electionId));
    await manageContext(actor, election.club);
    if (election.status !== S.CLOSED) throw conflict("A runoff can start once voting has closed");
    const { tie, leaders } = standings(election);
    if (!tie) throw conflict("A runoff is only needed when candidates tie");
    return createElection(
        actor,
        election.club,
        {
            role: election.role,
            title: payload.title || `${election.title} — runoff`,
            description: payload.description ?? election.description,
            candidates: leaders.map((leader) => ({
                user: leader.user,
                statement: election.candidates.find((entry) => idOf(entry.user) === idOf(leader.user))?.statement || ""
            })),
            opensAt: payload.opensAt,
            closesAt: payload.closesAt
        },
        { runoffOf: election._id }
    );
};

module.exports = {
    listElections,
    getElection,
    createElection,
    updateElection,
    vote,
    closeElection,
    cancelElection,
    startRunoff,
    sweepElections,
    MIN_CANDIDATES,
    MAX_CANDIDATES
};
