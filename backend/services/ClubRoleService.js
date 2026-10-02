const User = require("../models/User");
const ClubMembership = require("../models/ClubMembership");
const RecruitmentDrive = require("../models/RecruitmentDrive");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { ACCOUNT_TYPES, GLOBAL_ROLES } = require("../constants/Roles");
const { MEMBERSHIP_STATUS, NOTIFICATION_TYPES, AUDIT_ACTIONS, RECRUITMENT_STATUS } = require("../constants/Statuses");
const { withTransaction, maybeSession } = require("../utils/Transaction");
const { SYSTEM, GRANTABLE, PRESIDENT_ONLY, DEFAULT_ROLES, rolesOf, findRole, roleName, newRoleKey, sortedRoles } = require("../utils/ClubRoles");
const { getClubContext, contextHas, assertClubPermission } = require("./AuthorizationService");
const { clubUsersWithPermission } = require("./MembershipService");
const { recordAudit } = require("./AuditService");
const { notify } = require("./NotificationService");

// The club's roles: the president creates roles with a name and the authorities they grant, edits and
// deletes them. The president, vice-president and member roles are built in. The presidency itself is
// handed over by the president to another member (or appointed by the faculty mentor when vacant).

const MAX_ROLES = 20;
const ASSIGN = CLUB_PERMISSIONS.ASSIGN_ROLES;
const invalid = (message) => new AppError(message, 400, ERROR_CODES.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, 409, ERROR_CODES.CONFLICT);
const LIVE_DRIVES = [RECRUITMENT_STATUS.DRAFT, RECRUITMENT_STATUS.PENDING_APPROVAL, RECRUITMENT_STATUS.NEEDS_CHANGES, RECRUITMENT_STATUS.APPROVED, RECRUITMENT_STATUS.PUBLISHED];

/** Each role with how many members hold it (and who holds the one-person roles). */
const listRoles = async (actor, clubId) => {
    const context = await getClubContext(actor, clubId);
    if (!context.isMember && !context.isMentor) {
        throw new AppError("Only club members and the club's mentor can see its roles", 403, ERROR_CODES.FORBIDDEN);
    }
    const memberships = await ClubMembership.find({ club: context.club._id, status: MEMBERSHIP_STATUS.APPROVED }).select("role user").populate("user", "name avatar");
    return {
        canManage: contextHas(context, ASSIGN),
        grantable: GRANTABLE,
        presidentOnly: PRESIDENT_ONLY,
        roles: sortedRoles(context.club).map((role) => {
            const holders = memberships.filter((membership) => membership.role === role.key);
            return {
                key: role.key,
                name: role.name,
                description: role.description || "",
                permissions: role.key === SYSTEM.PRESIDENT ? [...GRANTABLE, ...PRESIDENT_ONLY] : role.permissions,
                system: Boolean(role.system),
                editable: role.key !== SYSTEM.PRESIDENT && role.key !== SYSTEM.MEMBER,
                renamable: !role.system,
                deletable: !role.system,
                unique: role.key === SYSTEM.PRESIDENT || role.key === SYSTEM.VICE_PRESIDENT,
                memberCount: holders.length,
                holder: [SYSTEM.PRESIDENT, SYSTEM.VICE_PRESIDENT].includes(role.key) && holders[0] ? { _id: holders[0].user?._id, name: holders[0].user?.name } : null
            };
        })
    };
};

const readPermissions = (permissions) => {
    const list = [...new Set(Array.isArray(permissions) ? permissions.map(String) : [])];
    const refused = list.filter((permission) => !GRANTABLE.includes(permission));
    if (refused.some((permission) => PRESIDENT_ONLY.includes(permission))) {
        throw invalid("Club settings, roles, recruitment, publishing results and starting check-in stay with the president");
    }
    if (refused.length) {
        throw invalid("Unknown authority");
    }
    return list;
};

const readName = (club, name, exceptKey = null) => {
    const clean = String(name || "").trim().replace(/\s+/g, " ");
    if (clean.length < 2 || clean.length > 40) {
        throw invalid("Role names are 2 to 40 characters");
    }
    if (rolesOf(club).some((role) => role.key !== exceptKey && role.name.toLowerCase() === clean.toLowerCase())) {
        throw conflict(`There is already a "${clean}" role`);
    }
    return clean;
};

// Clubs stored before roles were per-club get their roles written down before the first change.
const ownRoles = (club) => {
    if (!club.roles?.length) {
        club.roles = DEFAULT_ROLES();
    }
    return club.roles;
};

const auditRole = (action, actor, club, role, metadata = {}) =>
    recordAudit({ action, actor: actor._id, targetType: "Club", targetId: club._id, metadata: { roleKey: role.key, roleName: role.name, ...metadata } });

const createRole = async (actor, clubId, { name, description, permissions }) => {
    const { club } = await assertClubPermission(actor, clubId, ASSIGN, "Only the president can manage club roles");
    const roles = ownRoles(club);
    if (roles.length >= MAX_ROLES) {
        throw conflict(`A club can have up to ${MAX_ROLES} roles`);
    }
    const role = {
        key: newRoleKey(),
        name: readName(club, name),
        description: String(description || "").trim().slice(0, 200),
        permissions: readPermissions(permissions),
        system: false,
        order: Math.max(...roles.filter((item) => item.key !== SYSTEM.MEMBER).map((item) => item.order ?? 0)) + 1
    };
    roles.push(role);
    club.markModified("roles");
    await club.save();
    await auditRole(AUDIT_ACTIONS.CLUB_ROLE_CREATED, actor, club, role, { permissions: role.permissions });
    return listRoles(actor, club._id);
};

const updateRole = async (actor, clubId, key, { name, description, permissions }) => {
    const { club } = await assertClubPermission(actor, clubId, ASSIGN, "Only the president can manage club roles");
    const role = ownRoles(club).find((item) => item.key === key);
    if (!role) {
        throw new AppError("Role not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (key === SYSTEM.PRESIDENT || key === SYSTEM.MEMBER) {
        throw conflict(`The ${role.name.toLowerCase()} role can't be changed`);
    }
    if (name !== undefined && !role.system) {
        role.name = readName(club, name, key);
    }
    if (description !== undefined) {
        role.description = String(description || "").trim().slice(0, 200);
    }
    if (permissions !== undefined) {
        role.permissions = readPermissions(permissions);
    }
    club.markModified("roles");
    await club.save();
    await auditRole(AUDIT_ACTIONS.CLUB_ROLE_UPDATED, actor, club, role, { permissions: role.permissions });
    return listRoles(actor, club._id);
};

/** Deletes a custom role; its holders become members. Not while a recruitment drive recruits for it. */
const deleteRole = async (actor, clubId, key) => {
    const { club } = await assertClubPermission(actor, clubId, ASSIGN, "Only the president can manage club roles");
    const role = ownRoles(club).find((item) => item.key === key);
    if (!role) {
        throw new AppError("Role not found", 404, ERROR_CODES.NOT_FOUND);
    }
    if (role.system) {
        throw conflict(`The ${role.name.toLowerCase()} role is built in and can't be deleted`);
    }
    const drive = await RecruitmentDrive.findOne({ club: club._id, status: { $in: LIVE_DRIVES }, "positions.role": key }).select("title");
    if (drive) {
        throw conflict(`"${drive.title}" is recruiting for this role. Finish or cancel that drive first.`);
    }

    const holders = await ClubMembership.find({ club: club._id, role: key, status: MEMBERSHIP_STATUS.APPROVED }).select("user");
    await ClubMembership.updateMany({ club: club._id, role: key }, { $set: { role: SYSTEM.MEMBER } });
    club.roles = club.roles.filter((item) => item.key !== key);
    club.markModified("roles");
    await club.save();
    await auditRole(AUDIT_ACTIONS.CLUB_ROLE_DELETED, actor, club, role, { membersMoved: holders.length });
    if (holders.length) {
        await notify(
            holders.map((holder) => holder.user),
            {
                type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
                title: `Your role in ${club.name} changed`,
                message: `The "${role.name}" role was removed, so you're now a member.`,
                link: `/clubs/${club._id}`
            }
        );
    }
    return listRoles(actor, club._id);
};

/**
 * The president hands the presidency to another member, effective immediately. The outgoing president
 * becomes a member; if the new president was vice-president, that seat becomes free.
 */
const transferPresidency = async (actor, clubId, userId) => {
    const context = await getClubContext(actor, clubId);
    const { club } = context;
    if (context.role !== SYSTEM.PRESIDENT) {
        throw new AppError("Only the president can hand over the presidency", 403, ERROR_CODES.FORBIDDEN);
    }
    if (String(userId) === String(actor._id)) {
        throw invalid("Choose another member");
    }
    const [user, membership] = await Promise.all([
        User.findById(userId),
        ClubMembership.findOne({ club: club._id, user: userId, status: MEMBERSHIP_STATUS.APPROVED })
    ]);
    if (!membership || !user) {
        throw invalid("The new president must be a member of the club");
    }
    if (!user.isActive || !user.isEmailVerified || user.accountType !== ACCOUNT_TYPES.STUDENT || user.globalRole !== GLOBAL_ROLES.STUDENT) {
        throw invalid("The new president must be an active, verified student");
    }
    const previousRole = membership.role;

    await withTransaction(async (session) => {
        await ClubMembership.updateOne({ club: club._id, user: actor._id, role: SYSTEM.PRESIDENT }, { $set: { role: SYSTEM.MEMBER } }, maybeSession(session));
        await ClubMembership.updateOne({ _id: membership._id }, { $set: { role: SYSTEM.PRESIDENT, decidedBy: actor._id, decidedAt: new Date() } }, maybeSession(session));
        club.president = user._id;
        await club.save(maybeSession(session));
        await recordAudit({
            action: AUDIT_ACTIONS.PRESIDENCY_TRANSFERRED,
            actor: actor._id,
            targetType: "Club",
            targetId: club._id,
            fromState: String(actor._id),
            toState: String(user._id),
            metadata: { newPresidentPreviousRole: previousRole },
            session
        });
    });

    await notify(user._id, {
        type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
        title: `You are now president of ${club.name}`,
        message: `${actor.name} handed the presidency over to you. You now hold every authority in the club.`,
        link: `/clubs/${club._id}`,
        email: true
    });
    await notify(actor._id, {
        type: NOTIFICATION_TYPES.CLUB_ROLE_CHANGED,
        title: `You handed over ${club.name}`,
        message: `${user.name} is the new president. You remain a member.`,
        link: `/clubs/${club._id}`
    });
    if (club.mentor) {
        await notify(club.mentor, {
            type: NOTIFICATION_TYPES.CLUB_UPDATE,
            title: `New president for ${club.name}`,
            message: `${actor.name} handed the presidency over to ${user.name}.`,
            link: `/clubs/${club._id}`,
            email: true
        });
    }
    const officers = await clubUsersWithPermission(club._id, CLUB_PERMISSIONS.MANAGE_EVENTS);
    await notify(officers, {
        type: NOTIFICATION_TYPES.CLUB_UPDATE,
        title: `${user.name} is the new president of ${club.name}`,
        message: `${actor.name} handed over the presidency.`,
        link: `/clubs/${club._id}`,
        exclude: [actor._id, user._id]
    });
    return { president: { _id: user._id, name: user.name }, previousRoleName: roleName(club, previousRole) };
};

module.exports = { listRoles, createRole, updateRole, deleteRole, transferPresidency, findRole };
