const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const { CONVERSATION_TYPES: TYPES, MEMBER_ROLES } = require("../models/Conversation");
const Message = require("../models/Message");
const { MESSAGE_TYPES } = require("../models/Message");
const ChatReport = require("../models/ChatReport");
const User = require("../models/User");
const Club = require("../models/Club");
const ClubMembership = require("../models/ClubMembership");
const AppError = require("../utils/AppError");
const ERROR_CODES = require("../constants/ErrorCodes");
const { CLUB_STATUS, MEMBERSHIP_STATUS, NOTIFICATION_TYPES } = require("../constants/Statuses");
const { CLUB_PERMISSIONS } = require("../constants/Permissions");
const { GLOBAL_ROLES } = require("../constants/Roles");
const { permissionsFor } = require("../utils/ClubRoles");
const { TtlCache } = require("../utils/TtlCache");
const { userCache } = require("../utils/Caches");
const { env } = require("../config/env");
const media = require("./ChatMediaService");
const realtime = require("./ChatRealtime");
const links = require("./LinkPreviewService");
const logger = require("../utils/Logger");

// Chats: one-to-one, groups people create, and each club's own group (all approved members; the faculty
// mentor is not in it). Anyone can message any student or faculty member directly; blocking stops that.

const fail = (message, status = 400, code = ERROR_CODES.VALIDATION_ERROR) => new AppError(message, status, code);
const notFound = () => fail("Chat not found", 404, ERROR_CODES.NOT_FOUND);
const idOf = (value) => String(value?._id || value || "");
const isId = (value) => mongoose.isValidObjectId(value);

const USER_FIELDS = "name avatar accountType globalRole departmentCode batchCode isActive";
const userView = (user) =>
    user ? { _id: user._id, name: user.name, avatar: user.avatar || null, accountType: user.accountType, departmentCode: user.departmentCode || null, batchCode: user.batchCode || null } : null;

// ---------------------------------------------------------------- Club membership (who is in a club chat)

const clubMembersCache = new TtlCache(30 * 1000, 1000);
const clubMemberIds = (clubId) =>
    clubMembersCache.remember(String(clubId), async () => (await ClubMembership.find({ club: clubId, status: MEMBERSHIP_STATUS.APPROVED }).select("user").lean()).map((row) => String(row.user)));

/** Called when someone leaves or is removed from a club: they lose the club chat straight away. */
const clubMembershipChanged = async (clubId, userId) => {
    clubMembersCache.delete(String(clubId));
    const conversation = await Conversation.findOne({ club: clubId }).select("_id").lean();
    if (conversation && userId) realtime.emitToUsers([userId], "conversation:removed", { conversationId: String(conversation._id) });
};

// ---------------------------------------------------------------- Access

/**
 * What the actor may do in a conversation. CLUB chats are checked against the club's approved memberships
 * on every call; DIRECT and GROUP chats against the embedded member list.
 */
const accessFor = async (actor, conversation) => {
    const me = idOf(actor);
    let member = conversation.members.find((entry) => idOf(entry.user) === me) || null;
    let isAdmin = false;
    let club = null;

    if (conversation.type === TYPES.CLUB) {
        club = await Club.findById(conversation.club).select("name logo status roles").lean();
        if (!club || club.status !== CLUB_STATUS.ACTIVE) return null;
        const membership = await ClubMembership.findOne({ club: club._id, user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("role joinedAt createdAt").lean();
        if (!membership) return null;
        isAdmin = permissionsFor(club, membership.role).includes(CLUB_PERMISSIONS.MANAGE_CHAT);
        if (!member) {
            // First visit: remember them, with history from when they joined the club (or the chat began).
            member = { user: actor._id, role: MEMBER_ROLES.MEMBER, joinedAt: membership.joinedAt || membership.createdAt || new Date(), lastReadAt: null, clearedAt: null, mutedUntil: null };
            await Conversation.updateOne({ _id: conversation._id, "members.user": { $ne: actor._id } }, { $push: { members: member } });
            conversation.members.push(member);
        }
    } else {
        if (!member) return null;
        isAdmin = conversation.type === TYPES.GROUP && member.role === MEMBER_ROLES.ADMIN;
    }

    const visibleFrom = new Date(Math.max(new Date(member.joinedAt || 0).getTime(), new Date(member.clearedAt || 0).getTime()));
    return { member, isAdmin, club, visibleFrom };
};

const loadAccessible = async (actor, conversationId) => {
    if (!isId(conversationId)) throw notFound();
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) throw notFound();
    const access = await accessFor(actor, conversation);
    if (!access) throw notFound();
    return { conversation, access };
};

const recipientIds = async (conversation) =>
    conversation.type === TYPES.CLUB ? clubMemberIds(conversation.club) : conversation.members.map((entry) => idOf(entry.user));

const otherMemberId = (conversation, actor) => idOf(conversation.members.find((entry) => idOf(entry.user) !== idOf(actor))?.user);

/** Blocking in a one-to-one chat: either side blocking stops new messages. */
const blockState = async (actor, otherId) => {
    if (!otherId) return { iBlocked: false, blockedMe: false };
    const [me, other] = await Promise.all([User.findById(actor._id).select("blockedUsers").lean(), User.findById(otherId).select("blockedUsers isActive").lean()]);
    return {
        iBlocked: (me?.blockedUsers || []).some((id) => idOf(id) === idOf(otherId)),
        blockedMe: (other?.blockedUsers || []).some((id) => idOf(id) === idOf(actor)),
        inactive: !other?.isActive
    };
};

const sendBlockedReason = async (actor, conversation, access) => {
    if (conversation.announceOnly && !access.isAdmin) return conversation.type === TYPES.CLUB ? "Only club admins can send messages in this group" : "Only group admins can send messages";
    if (conversation.type === TYPES.DIRECT) {
        const state = await blockState(actor, otherMemberId(conversation, actor));
        if (state.iBlocked) return "You blocked this account. Unblock to send messages.";
        if (state.blockedMe || state.inactive) return "You can't message this account";
    }
    return null;
};

// ---------------------------------------------------------------- Views

const attachmentView = (attachment) => {
    const urls = media.mediaUrls(attachment);
    return {
        kind: attachment.kind,
        url: urls.url,
        thumb: urls.thumb,
        poster: urls.poster,
        name: attachment.name || "",
        format: attachment.format,
        bytes: attachment.bytes,
        width: attachment.width,
        height: attachment.height,
        duration: attachment.duration
    };
};

const KIND_LABEL = { IMAGE: ["📷 Photo", "photos"], VIDEO: ["🎥 Video", "videos"], AUDIO: ["🎤 Voice message", "voice messages"], DOCUMENT: ["📄 File", "files"] };

const previewOf = (message) => {
    if (message.deletedAt) return "Message unsent";
    if (message.type === MESSAGE_TYPES.SYSTEM) return message.text;
    if (message.text) return message.text.slice(0, 120);
    const [first] = message.attachments || [];
    if (!first) return "";
    if (first.kind === "DOCUMENT") return `📄 ${first.name || "File"}`;
    const count = message.attachments.length;
    return count > 1 ? `${KIND_LABEL[first.kind][0].split(" ")[0]} ${count} ${KIND_LABEL[first.kind][1]}` : KIND_LABEL[first.kind][0];
};

const loadUsers = async (ids) => {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    const users = unique.length ? await User.find({ _id: { $in: unique } }).select(USER_FIELDS).lean() : [];
    return new Map(users.map((user) => [String(user._id), user]));
};

/** Messages for the screen: sender, the message replied to (as a short quote), grouped reactions. */
const serializeMessages = async (messages, actor) => {
    const replyIds = messages.map((message) => message.replyTo).filter(Boolean);
    const replies = replyIds.length ? await Message.find({ _id: { $in: replyIds } }).select("sender text attachments type deletedAt").lean() : [];
    const replyMap = new Map(replies.map((reply) => [String(reply._id), reply]));
    const users = await loadUsers([...messages.map((message) => message.sender), ...replies.map((reply) => reply.sender)]);
    const me = idOf(actor);

    return messages.map((message) => {
        const reply = message.replyTo ? replyMap.get(String(message.replyTo)) : null;
        const grouped = {};
        (message.reactions || []).forEach((reaction) => {
            grouped[reaction.emoji] = grouped[reaction.emoji] || { emoji: reaction.emoji, users: [] };
            grouped[reaction.emoji].users.push(String(reaction.user));
        });
        return {
            _id: message._id,
            conversation: message.conversation,
            clientId: message.clientId || null,
            type: message.type,
            sender: userView(users.get(String(message.sender))),
            mine: idOf(message.sender) === me,
            text: message.deletedAt ? "" : message.text,
            attachments: message.deletedAt ? [] : (message.attachments || []).map(attachmentView),
            link: message.deletedAt ? null : message.link || null,
            replyTo: reply
                ? {
                      _id: reply._id,
                      sender: userView(users.get(String(reply.sender))),
                      text: reply.deletedAt ? "Message unsent" : previewOf(reply),
                      thumb: !reply.deletedAt && reply.attachments?.[0] && ["IMAGE", "VIDEO"].includes(reply.attachments[0].kind) ? attachmentView(reply.attachments[0]).thumb : null
                  }
                : null,
            forwarded: Boolean(message.forwarded),
            reactions: Object.values(grouped).map((group) => ({ ...group, count: group.users.length, mine: group.users.includes(me) })),
            editedAt: message.editedAt,
            deleted: Boolean(message.deletedAt),
            system: message.system || null,
            createdAt: message.createdAt
        };
    });
};

const serializeOne = async (message, actor) => (await serializeMessages([message.toObject ? message.toObject() : message], actor))[0];

const groupAvatar = (conversation) => (conversation.avatar ? media.mediaUrls({ ...conversation.avatar, kind: "IMAGE" }).thumb : null);

/** One row of the chat list (and the header of an open chat). */
const conversationView = async (conversation, actor, access, { users, club, unread = 0 } = {}) => {
    const me = idOf(actor);
    const member = access.member;
    let title = conversation.name;
    let avatar = groupAvatar(conversation);
    let other = null;

    if (conversation.type === TYPES.DIRECT) {
        const otherId = otherMemberId(conversation, actor);
        other = users?.get(otherId) || (await User.findById(otherId).select(USER_FIELDS).lean());
        title = other?.name || "CampusConnect user";
        avatar = other?.avatar || null;
    } else if (conversation.type === TYPES.CLUB) {
        const theClub = club || access.club;
        title = theClub?.name || conversation.name;
        avatar = theClub?.logo || null;
    }

    const last = conversation.lastMessage?.at && new Date(conversation.lastMessage.at) >= access.visibleFrom ? conversation.lastMessage : null;
    return {
        _id: conversation._id,
        type: conversation.type,
        title,
        avatar,
        other: other ? userView(other) : null,
        club: conversation.type === TYPES.CLUB ? idOf(conversation.club) : null,
        memberCount: conversation.type === TYPES.CLUB ? (await clubMemberIds(conversation.club)).length : conversation.members.length,
        lastMessage: last ? { preview: last.preview, at: last.at, mine: !last.system && idOf(last.sender) === me, system: Boolean(last.system), senderId: idOf(last.sender) } : null,
        lastMessageAt: last?.at || null,
        unread,
        muted: Boolean(member.mutedUntil && new Date(member.mutedUntil) > new Date()),
        mutedUntil: member.mutedUntil || null,
        announceOnly: conversation.announceOnly,
        isAdmin: access.isAdmin,
        createdAt: conversation.createdAt
    };
};

const unreadIn = async (conversation, actor, access) => {
    const since = new Date(Math.max(access.visibleFrom.getTime(), new Date(access.member.lastReadAt || 0).getTime()));
    if (!conversation.lastMessage?.at || new Date(conversation.lastMessage.at) <= since) return 0;
    return Message.countDocuments({ conversation: conversation._id, createdAt: { $gt: since }, sender: { $ne: actor._id }, hiddenFor: { $ne: actor._id }, type: { $ne: MESSAGE_TYPES.SYSTEM } }).limit(100);
};

// ---------------------------------------------------------------- Club chats

/** Makes sure each active club the actor belongs to has its group chat. */
const ensureClubChats = async (actor) => {
    const memberships = await ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club").lean();
    if (!memberships.length) return [];
    const clubs = await Club.find({ _id: { $in: memberships.map((row) => row.club) }, status: CLUB_STATUS.ACTIVE }).select("name logo status roles").lean();
    const existing = new Set((await Conversation.find({ club: { $in: clubs.map((club) => club._id) } }).select("club").lean()).map((row) => String(row.club)));
    for (const club of clubs.filter((item) => !existing.has(String(item._id)))) {
        try {
            await Conversation.create({ type: TYPES.CLUB, club: club._id, name: club.name, lastMessageAt: null });
        } catch (error) {
            if (error.code !== 11000) throw error; // created at the same moment by another request
        }
    }
    return clubs;
};

// ---------------------------------------------------------------- Listing

const FILTERS = { all: null, unread: "unread", groups: [TYPES.GROUP, TYPES.CLUB], clubs: [TYPES.CLUB], direct: [TYPES.DIRECT] };

const listConversations = async (actor, { filter = "all" } = {}) => {
    const clubs = await ensureClubChats(actor);
    const clubMap = new Map(clubs.map((club) => [String(club._id), club]));
    const conversations = await Conversation.find({
        $or: [{ type: { $in: [TYPES.DIRECT, TYPES.GROUP] }, "members.user": actor._id }, { type: TYPES.CLUB, club: { $in: clubs.map((club) => club._id) } }]
    })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(200);

    const directIds = conversations.filter((conversation) => conversation.type === TYPES.DIRECT).map((conversation) => otherMemberId(conversation, actor));
    const users = await loadUsers(directIds);
    const rows = [];
    for (const conversation of conversations) {
        const access = await accessFor(actor, conversation);
        if (!access) continue;
        // One-to-one chats show up once there's a message to show (or for whoever started them).
        const hasVisible = conversation.lastMessage?.at && new Date(conversation.lastMessage.at) >= access.visibleFrom;
        if (conversation.type === TYPES.DIRECT && !hasVisible) continue;
        const unread = await unreadIn(conversation, actor, access);
        rows.push(await conversationView(conversation, actor, access, { users, club: clubMap.get(idOf(conversation.club)), unread }));
    }
    rows.sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));

    // Opening the chat list counts as "delivered" for everything waiting.
    markDeliveredMany(actor, conversations).catch(() => {});

    const wanted = FILTERS[filter];
    if (wanted === "unread") return rows.filter((row) => row.unread > 0);
    if (Array.isArray(wanted)) return rows.filter((row) => wanted.includes(row.type));
    return rows;
};

/** Number of chats with unread messages (the badge on the Messages icon). */
const unreadSummary = async (actor) => {
    const rows = await listConversations(actor);
    return { chats: rows.filter((row) => row.unread > 0 && !row.muted).length, messages: rows.reduce((sum, row) => sum + (row.muted ? 0 : row.unread), 0) };
};

// ---------------------------------------------------------------- Starting chats

const assertChatUser = async (userId) => {
    if (!isId(userId)) throw fail("Choose someone to message");
    const user = await User.findById(userId).select(`${USER_FIELDS} isEmailVerified`).lean();
    if (!user || !user.isActive || !user.isEmailVerified) throw fail("This account can't receive messages", 404, ERROR_CODES.NOT_FOUND);
    return user;
};

const openDirect = async (actor, userId) => {
    if (idOf(userId) === idOf(actor)) throw fail("You can't message yourself");
    const other = await assertChatUser(userId);
    const key = [idOf(actor), idOf(other)].sort().join("_");
    let conversation = await Conversation.findOne({ directKey: key });
    if (!conversation) {
        try {
            conversation = await Conversation.create({
                type: TYPES.DIRECT,
                directKey: key,
                createdBy: actor._id,
                members: [
                    { user: actor._id, joinedAt: new Date(0) },
                    { user: other._id, joinedAt: new Date(0) }
                ]
            });
        } catch (error) {
            if (error.code !== 11000) throw error;
            conversation = await Conversation.findOne({ directKey: key });
        }
    }
    return getConversation(actor, conversation._id);
};

const systemMessage = async (conversation, actor, text, action) => {
    const message = await Message.create({ conversation: conversation._id, sender: actor._id, type: MESSAGE_TYPES.SYSTEM, text, system: { action, actor: actor.name } });
    await touchConversation(conversation, message);
    const recipients = await recipientIds(conversation);
    realtime.emitToUsers(recipients, "message:new", { conversationId: String(conversation._id), message: await serializeOne(message, { _id: null }) });
    return message;
};

const createGroup = async (actor, { name, members = [] }) => {
    const title = String(name || "").trim();
    if (title.length < 1) throw fail("Name the group");
    const ids = [...new Set((Array.isArray(members) ? members : []).map(String))].filter((id) => id !== idOf(actor));
    if (!ids.length) throw fail("Add at least one person");
    if (ids.length + 1 > env.chat.maxGroupMembers) throw fail(`Groups can have up to ${env.chat.maxGroupMembers} people`);
    const users = await Promise.all(ids.map(assertChatUser));
    const now = new Date();
    const conversation = await Conversation.create({
        type: TYPES.GROUP,
        name: title.slice(0, 80),
        createdBy: actor._id,
        members: [{ user: actor._id, role: MEMBER_ROLES.ADMIN, joinedAt: now, lastReadAt: now }, ...users.map((user) => ({ user: user._id, joinedAt: now, addedBy: actor._id }))]
    });
    await systemMessage(conversation, actor, `${actor.name} created the group "${conversation.name}"`, "CREATED");
    return getConversation(actor, conversation._id);
};

// ---------------------------------------------------------------- One conversation

const presenceFor = async (viewerId, userId) => {
    const [viewer, user] = await Promise.all([User.findById(viewerId).select("showActivityStatus").lean(), User.findById(userId).select("showActivityStatus lastSeenAt").lean()]);
    if (!user || viewer?.showActivityStatus === false) return null;
    return realtime.presencePayload(user, realtime.isOnline(userId));
};

const getConversation = async (actor, conversationId) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const view = await conversationView(conversation, actor, access, { unread: await unreadIn(conversation, actor, access) });

    let members = [];
    if (conversation.type === TYPES.CLUB) {
        const rows = await ClubMembership.find({ club: conversation.club, status: MEMBERSHIP_STATUS.APPROVED }).populate("user", USER_FIELDS).limit(500).lean();
        const club = access.club;
        members = rows
            .filter((row) => row.user)
            .map((row) => ({ ...userView(row.user), role: permissionsFor(club, row.role).includes(CLUB_PERMISSIONS.MANAGE_CHAT) ? MEMBER_ROLES.ADMIN : MEMBER_ROLES.MEMBER, clubRole: row.role }));
    } else {
        const users = await loadUsers(conversation.members.map((entry) => entry.user));
        members = conversation.members.map((entry) => ({ ...userView(users.get(idOf(entry.user))), role: entry.role }));
    }
    members.sort((a, b) => (a.role === b.role ? String(a.name).localeCompare(String(b.name)) : a.role === MEMBER_ROLES.ADMIN ? -1 : 1));

    const pinned = conversation.pinned.length ? await Message.find({ _id: { $in: conversation.pinned }, deletedAt: null }).lean() : [];

    // Read state of the others (for ticks and "Seen"), only in one-to-one chats and groups.
    const receipts =
        conversation.type === TYPES.CLUB
            ? []
            : conversation.members.filter((entry) => idOf(entry.user) !== idOf(actor)).map((entry) => ({ userId: idOf(entry.user), readAt: entry.lastReadAt, deliveredAt: entry.lastDeliveredAt }));

    const block = conversation.type === TYPES.DIRECT ? await blockState(actor, otherMemberId(conversation, actor)) : null;
    return {
        ...view,
        description: conversation.description,
        members,
        pinned: await serializeMessages(pinned, actor),
        receipts,
        block,
        presence: conversation.type === TYPES.DIRECT ? await presenceFor(actor._id, otherMemberId(conversation, actor)) : null,
        canSend: !(await sendBlockedReason(actor, conversation, access)),
        sendBlockedReason: await sendBlockedReason(actor, conversation, access),
        canEditInfo: conversation.type === TYPES.GROUP && access.isAdmin,
        canManageMembers: conversation.type === TYPES.GROUP && access.isAdmin,
        canPin: conversation.type === TYPES.DIRECT || access.isAdmin
    };
};

const PAGE = 40;

const listMessages = async (actor, conversationId, { before } = {}) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const filter = { conversation: conversation._id, createdAt: { $gte: access.visibleFrom }, hiddenFor: { $ne: actor._id } };
    if (before && isId(before)) {
        const anchor = await Message.findById(before).select("createdAt").lean();
        if (anchor) filter.createdAt.$lt = anchor.createdAt;
    }
    const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(PAGE + 1).lean();
    const hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE).reverse();
    return { items: await serializeMessages(page, actor), hasMore };
};

// ---------------------------------------------------------------- Sending

const touchConversation = async (conversation, message) => {
    const lastMessage = { message: message._id, sender: message.sender, preview: previewOf(message), system: message.type === MESSAGE_TYPES.SYSTEM, at: message.createdAt };
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessage, lastMessageAt: message.createdAt } });
    conversation.lastMessage = lastMessage;
    conversation.lastMessageAt = message.createdAt;
};

// A few messages a second is plenty for a person; this stops scripts flooding a club group.
const sendRate = new TtlCache(10 * 1000, 20000);
const checkRate = (actor) => {
    const key = idOf(actor);
    const used = (sendRate.get(key) || 0) + 1;
    if (used > 25) throw fail("You're sending messages too quickly — wait a few seconds", 429, ERROR_CODES.RATE_LIMITED || ERROR_CODES.VALIDATION_ERROR);
    sendRate.set(key, used);
};

const EMOJI = /^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|‍|️|\p{Emoji_Modifier}){1,10}$/u;

const typeOf = (attachments) => {
    if (!attachments.length) return MESSAGE_TYPES.TEXT;
    if (attachments[0].kind === "AUDIO") return MESSAGE_TYPES.VOICE;
    if (attachments[0].kind === "DOCUMENT") return MESSAGE_TYPES.FILE;
    return MESSAGE_TYPES.MEDIA;
};

const notifyPush = async (conversation, message, actor, recipients, view) => {
    const others = recipients.filter((id) => id !== idOf(actor) && !realtime.isOnline(id));
    if (!others.length) return;
    const muted = new Set(conversation.members.filter((entry) => entry.mutedUntil && new Date(entry.mutedUntil) > new Date()).map((entry) => idOf(entry.user)));
    const targets = others.filter((id) => !muted.has(id));
    if (!targets.length) return;
    const title = conversation.type === TYPES.DIRECT ? actor.name : `${view.title}`;
    const body = conversation.type === TYPES.DIRECT ? previewOf(message) : `${actor.name}: ${previewOf(message)}`;
    require("./PushService")
        .pushToUsers(targets, { title, body: body.slice(0, 140), url: `/messages/${conversation._id}`, tag: `chat-${conversation._id}` })
        ?.catch?.(() => {});
};

const attachLinkPreview = async (message, recipients) => {
    const url = links.firstLink(message.text);
    if (!url) return;
    const preview = await links.previewFor(url);
    if (!preview) return;
    await Message.updateOne({ _id: message._id, deletedAt: null }, { $set: { link: preview } });
    realtime.emitToUsers(recipients, "message:updated", { conversationId: String(message.conversation), messageId: String(message._id), patch: { link: preview } });
};

const sendMessage = async (actor, conversationId, { clientId = null, text = "", attachments = [], replyTo = null } = {}) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const blocked = await sendBlockedReason(actor, conversation, access);
    if (blocked) throw fail(blocked, 403, ERROR_CODES.FORBIDDEN);

    const body = String(text || "").trim().slice(0, 4000);
    const files = Array.isArray(attachments) ? attachments.slice(0, 10) : [];
    if (!body && !files.length) throw fail("Write a message or add a file");

    if (clientId) {
        const existing = await Message.findOne({ conversation: conversation._id, sender: actor._id, clientId: String(clientId).slice(0, 64) });
        if (existing) return serializeOne(existing, actor);
    }
    checkRate(actor);

    const verified = files.map((file) => ({ ...media.verifyUpload(file, String(conversation._id), idOf(actor)), name: String(file.name || "").slice(0, 160) }));
    if (verified.some((file) => file.kind === "AUDIO") && verified.length > 1) throw fail("Send a voice message on its own");

    let reply = null;
    if (replyTo) {
        reply = isId(replyTo) ? await Message.findOne({ _id: replyTo, conversation: conversation._id, createdAt: { $gte: access.visibleFrom } }).select("_id").lean() : null;
        if (!reply) throw fail("The message you're replying to isn't in this chat");
    }

    const message = await Message.create({
        conversation: conversation._id,
        sender: actor._id,
        type: typeOf(verified),
        text: body,
        attachments: verified,
        replyTo: reply?._id || null,
        clientId: clientId ? String(clientId).slice(0, 64) : null
    });
    await touchConversation(conversation, message);
    const now = new Date();
    await Conversation.updateOne({ _id: conversation._id, "members.user": actor._id }, { $set: { "members.$.lastReadAt": now } });

    const recipients = await recipientIds(conversation);
    const view = await serializeOne(message, actor);
    const conversationRow = await conversationView(conversation, actor, access);
    // Each person gets the message with "mine" set for them; the client works it out from sender id.
    realtime.emitToUsers(recipients, "message:new", { conversationId: String(conversation._id), message: { ...view, mine: undefined }, conversation: { _id: conversationRow._id, type: conversationRow.type } });
    notifyPush(conversation, message, actor, recipients, conversationRow).catch(() => {});
    if (body && !verified.length) attachLinkPreview(message, recipients).catch((error) => logger.warn("Link preview failed", { message: error.message }));
    return view;
};

// ---------------------------------------------------------------- Editing, unsending, reactions, forwarding

const loadMessage = async (actor, messageId) => {
    if (!isId(messageId)) throw fail("Message not found", 404, ERROR_CODES.NOT_FOUND);
    const message = await Message.findById(messageId);
    if (!message) throw fail("Message not found", 404, ERROR_CODES.NOT_FOUND);
    const { conversation, access } = await loadAccessible(actor, message.conversation);
    if (message.createdAt < access.visibleFrom || message.hiddenFor.some((id) => idOf(id) === idOf(actor))) throw fail("Message not found", 404, ERROR_CODES.NOT_FOUND);
    return { message, conversation, access };
};

const broadcastUpdate = async (conversation, message, patch) => {
    const recipients = await recipientIds(conversation);
    realtime.emitToUsers(recipients, "message:updated", { conversationId: String(conversation._id), messageId: String(message._id), patch });
};

const editMessage = async (actor, messageId, text) => {
    const { message, conversation } = await loadMessage(actor, messageId);
    if (idOf(message.sender) !== idOf(actor) || message.type === MESSAGE_TYPES.SYSTEM) throw fail("You can only edit your own messages", 403, ERROR_CODES.FORBIDDEN);
    if (message.deletedAt) throw fail("This message was unsent");
    if (Date.now() - message.createdAt.getTime() > env.chat.editMinutes * 60000) throw fail(`Messages can be edited for ${env.chat.editMinutes} minutes after sending`);
    const body = String(text || "").trim().slice(0, 4000);
    if (!body && !message.attachments.length) throw fail("A message can't be empty");
    message.text = body;
    message.editedAt = new Date();
    message.link = null;
    await message.save();
    if (idOf(conversation.lastMessage?.message) === idOf(message)) await touchConversation(conversation, message);
    await broadcastUpdate(conversation, message, { text: message.text, editedAt: message.editedAt, link: null });
    if (body && !message.attachments.length) attachLinkPreview(message, await recipientIds(conversation)).catch(() => {});
    return serializeOne(message, actor);
};

/** Removes stored files no other message still uses (a forwarded copy keeps them). */
const deleteFilesQuietly = async (message) => {
    for (const file of message.attachments) {
        const elsewhere = await Message.exists({ _id: { $ne: message._id }, "attachments.key": file.key });
        if (!elsewhere) await media.deleteMediaQuietly(file);
    }
};

const deleteMessage = async (actor, messageId, scope = "me") => {
    const { message, conversation, access } = await loadMessage(actor, messageId);
    if (scope === "everyone") {
        const own = idOf(message.sender) === idOf(actor);
        if (!own && !access.isAdmin) throw fail("You can only unsend your own messages", 403, ERROR_CODES.FORBIDDEN);
        if (message.type === MESSAGE_TYPES.SYSTEM) throw fail("This can't be unsent");
        const files = [...message.attachments];
        message.deletedAt = new Date();
        message.text = "";
        message.attachments = [];
        message.link = null;
        message.reactions = [];
        await message.save();
        await Conversation.updateOne({ _id: conversation._id }, { $pull: { pinned: message._id } });
        if (idOf(conversation.lastMessage?.message) === idOf(message)) await touchConversation(conversation, message);
        await broadcastUpdate(conversation, message, { deleted: true, text: "", attachments: [], link: null, reactions: [] });
        deleteFilesQuietly({ _id: message._id, attachments: files }).catch(() => {});
        return { deleted: "everyone" };
    }
    await Message.updateOne({ _id: message._id }, { $addToSet: { hiddenFor: actor._id } });
    return { deleted: "me" };
};

const react = async (actor, messageId, emoji) => {
    const { message, conversation } = await loadMessage(actor, messageId);
    if (message.deletedAt || message.type === MESSAGE_TYPES.SYSTEM) throw fail("You can't react to this message");
    const value = emoji ? String(emoji).trim() : null;
    if (value && !EMOJI.test(value)) throw fail("Choose an emoji");
    message.reactions = message.reactions.filter((reaction) => idOf(reaction.user) !== idOf(actor));
    if (value) message.reactions.push({ user: actor._id, emoji: value });
    await message.save();
    const view = await serializeOne(message, { _id: null });
    await broadcastUpdate(conversation, message, { reactions: view.reactions.map(({ mine, ...rest }) => rest) });
    return serializeOne(message, actor);
};

const forward = async (actor, messageId, conversationIds = []) => {
    const { message } = await loadMessage(actor, messageId);
    if (message.deletedAt || message.type === MESSAGE_TYPES.SYSTEM) throw fail("This message can't be forwarded");
    const targets = [...new Set((Array.isArray(conversationIds) ? conversationIds : []).map(String))].slice(0, 5);
    if (!targets.length) throw fail("Choose where to forward it");
    const sent = [];
    for (const target of targets) {
        const { conversation, access } = await loadAccessible(actor, target);
        const blocked = await sendBlockedReason(actor, conversation, access);
        if (blocked) throw fail(blocked, 403, ERROR_CODES.FORBIDDEN);
        checkRate(actor);
        const copy = await Message.create({
            conversation: conversation._id,
            sender: actor._id,
            type: message.type,
            text: message.text,
            attachments: message.attachments.map((file) => (file.toObject ? file.toObject() : file)),
            link: message.link,
            forwarded: true
        });
        await touchConversation(conversation, copy);
        const recipients = await recipientIds(conversation);
        realtime.emitToUsers(recipients, "message:new", { conversationId: String(conversation._id), message: { ...(await serializeOne(copy, actor)), mine: undefined } });
        sent.push(String(conversation._id));
    }
    return { forwardedTo: sent };
};

const MAX_PINS = 3;

const setPinned = async (actor, conversationId, messageId, pinned) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    if (!(conversation.type === TYPES.DIRECT || access.isAdmin)) throw fail("Only admins can pin messages here", 403, ERROR_CODES.FORBIDDEN);
    const message = isId(messageId) ? await Message.findOne({ _id: messageId, conversation: conversation._id, deletedAt: null }) : null;
    if (!message || message.type === MESSAGE_TYPES.SYSTEM) throw fail("Message not found", 404, ERROR_CODES.NOT_FOUND);
    const current = conversation.pinned.map(String).filter((id) => id !== idOf(message));
    // Like WhatsApp, three pins at most: a new pin replaces the oldest.
    conversation.pinned = pinned ? [...current, idOf(message)].slice(-MAX_PINS) : current;
    await conversation.save();
    if (pinned) await systemMessage(conversation, actor, `${actor.name} pinned a message`, "PINNED");
    realtime.emitToUsers(await recipientIds(conversation), "conversation:updated", { conversationId: String(conversation._id) });
    return getConversation(actor, conversation._id);
};

// ---------------------------------------------------------------- Read / delivered / typing

const markRead = async (actor, conversationId) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const now = new Date();
    await Conversation.updateOne({ _id: conversation._id, "members.user": actor._id }, { $set: { "members.$.lastReadAt": now, "members.$.lastDeliveredAt": now } });
    if (conversation.type !== TYPES.CLUB) {
        const others = conversation.members.map((entry) => idOf(entry.user)).filter((id) => id !== idOf(actor));
        realtime.emitToUsers(others, "receipt", { conversationId: String(conversation._id), userId: idOf(actor), readAt: now, deliveredAt: now });
    }
    realtime.emitToUsers([idOf(actor)], "conversation:read", { conversationId: String(conversation._id) });
    return { readAt: now, unread: 0, visibleFrom: access.visibleFrom };
};

const markDeliveredMany = async (actor, conversations) => {
    const now = new Date();
    const waiting = conversations.filter(
        (conversation) =>
            conversation.type !== TYPES.CLUB &&
            conversation.lastMessage?.at &&
            idOf(conversation.lastMessage.sender) !== idOf(actor) &&
            conversation.members.some((entry) => idOf(entry.user) === idOf(actor) && (!entry.lastDeliveredAt || entry.lastDeliveredAt < conversation.lastMessage.at))
    );
    for (const conversation of waiting) {
        await Conversation.updateOne({ _id: conversation._id, "members.user": actor._id }, { $set: { "members.$.lastDeliveredAt": now } });
        const others = conversation.members.map((entry) => idOf(entry.user)).filter((id) => id !== idOf(actor));
        realtime.emitToUsers(others, "receipt", { conversationId: String(conversation._id), userId: idOf(actor), deliveredAt: now });
    }
};

realtime.registerHandlers({
    typing: async (user, payload = {}) => {
        if (!isId(payload.conversationId)) return;
        const { conversation } = await loadAccessible(user, payload.conversationId);
        const recipients = (await recipientIds(conversation)).filter((id) => id !== idOf(user));
        realtime.emitToUsers(recipients, "typing", { conversationId: String(conversation._id), user: { _id: idOf(user), name: user.name }, recording: Boolean(payload.recording) });
    },
    delivered: async (user, payload = {}) => {
        if (!isId(payload.conversationId)) return;
        const conversation = await Conversation.findById(payload.conversationId);
        if (conversation && conversation.members.some((entry) => idOf(entry.user) === idOf(user))) await markDeliveredMany(user, [conversation]);
    }
});

// ---------------------------------------------------------------- Group settings and members

const updateConversation = async (actor, conversationId, { name, description, avatar, announceOnly } = {}) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    if (conversation.type === TYPES.DIRECT) throw fail("One-to-one chats have no settings");
    if (!access.isAdmin) throw fail("Only admins can change this", 403, ERROR_CODES.FORBIDDEN);
    const notes = [];
    if (conversation.type === TYPES.GROUP) {
        if (name !== undefined) {
            const title = String(name || "").trim().slice(0, 80);
            if (!title) throw fail("Name the group");
            if (title !== conversation.name) notes.push([`${actor.name} renamed the group to "${title}"`, "RENAMED"]);
            conversation.name = title;
        }
        if (description !== undefined) conversation.description = String(description || "").trim().slice(0, 500);
        if (avatar !== undefined) {
            if (avatar === null) conversation.avatar = null;
            else {
                const file = media.verifyUpload(avatar, String(conversation._id), idOf(actor));
                if (file.kind !== "IMAGE") throw fail("Choose a photo");
                conversation.avatar = { kind: "IMAGE", provider: file.provider, key: file.key, version: file.version, format: file.format };
                notes.push([`${actor.name} changed the group photo`, "PHOTO"]);
            }
        }
    }
    if (announceOnly !== undefined && Boolean(announceOnly) !== conversation.announceOnly) {
        conversation.announceOnly = Boolean(announceOnly);
        notes.push([conversation.announceOnly ? `${actor.name} changed settings so only admins can send messages` : `${actor.name} changed settings so everyone can send messages`, "ANNOUNCE"]);
    }
    await conversation.save();
    for (const [text, action] of notes) await systemMessage(conversation, actor, text, action);
    realtime.emitToUsers(await recipientIds(conversation), "conversation:updated", { conversationId: String(conversation._id) });
    return getConversation(actor, conversation._id);
};

const assertGroupAdmin = (conversation, access) => {
    if (conversation.type !== TYPES.GROUP) throw fail("Members of club chats follow the club's membership", 409, ERROR_CODES.INVALID_STATE);
    if (!access.isAdmin) throw fail("Only group admins can do this", 403, ERROR_CODES.FORBIDDEN);
};

const addMembers = async (actor, conversationId, userIds = []) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    assertGroupAdmin(conversation, access);
    const present = new Set(conversation.members.map((entry) => idOf(entry.user)));
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter((id) => !present.has(id));
    if (!ids.length) throw fail("Choose people to add");
    if (present.size + ids.length > env.chat.maxGroupMembers) throw fail(`Groups can have up to ${env.chat.maxGroupMembers} people`);
    const users = await Promise.all(ids.map(assertChatUser));
    const now = new Date();
    conversation.members.push(...users.map((user) => ({ user: user._id, joinedAt: now, addedBy: actor._id })));
    await conversation.save();
    await systemMessage(conversation, actor, `${actor.name} added ${users.map((user) => user.name).join(", ")}`, "ADDED");
    return getConversation(actor, conversation._id);
};

const leaveOrRemove = async (conversation, actor, userId, text, action) => {
    const leaving = conversation.members.find((entry) => idOf(entry.user) === idOf(userId));
    conversation.members = conversation.members.filter((entry) => idOf(entry.user) !== idOf(userId));
    // A group always keeps an admin: the longest-standing member takes over.
    if (leaving?.role === MEMBER_ROLES.ADMIN && conversation.members.length && !conversation.members.some((entry) => entry.role === MEMBER_ROLES.ADMIN)) {
        conversation.members.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
        conversation.members[0].role = MEMBER_ROLES.ADMIN;
    }
    await conversation.save();
    realtime.emitToUsers([idOf(userId)], "conversation:removed", { conversationId: String(conversation._id) });
    if (conversation.members.length) await systemMessage(conversation, actor, text, action);
};

const removeMember = async (actor, conversationId, userId) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    assertGroupAdmin(conversation, access);
    if (idOf(userId) === idOf(actor)) throw fail("Use Leave group to leave");
    const target = conversation.members.find((entry) => idOf(entry.user) === idOf(userId));
    if (!target) throw fail("They're not in this group", 404, ERROR_CODES.NOT_FOUND);
    const user = await User.findById(userId).select("name").lean();
    await leaveOrRemove(conversation, actor, userId, `${actor.name} removed ${user?.name || "a member"}`, "REMOVED");
    return getConversation(actor, conversation._id);
};

const setAdmin = async (actor, conversationId, userId, admin) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    assertGroupAdmin(conversation, access);
    const target = conversation.members.find((entry) => idOf(entry.user) === idOf(userId));
    if (!target) throw fail("They're not in this group", 404, ERROR_CODES.NOT_FOUND);
    if (!admin && idOf(userId) === idOf(actor) && conversation.members.filter((entry) => entry.role === MEMBER_ROLES.ADMIN).length === 1) throw fail("Make someone else an admin first");
    target.role = admin ? MEMBER_ROLES.ADMIN : MEMBER_ROLES.MEMBER;
    await conversation.save();
    realtime.emitToUsers(await recipientIds(conversation), "conversation:updated", { conversationId: String(conversation._id) });
    return getConversation(actor, conversation._id);
};

const leaveGroup = async (actor, conversationId) => {
    const { conversation } = await loadAccessible(actor, conversationId);
    if (conversation.type !== TYPES.GROUP) throw fail(conversation.type === TYPES.CLUB ? "You leave a club's chat by leaving the club" : "You can't leave a one-to-one chat — delete it instead", 409, ERROR_CODES.INVALID_STATE);
    await leaveOrRemove(conversation, actor, actor._id, `${actor.name} left`, "LEFT");
    return { left: true };
};

const MUTE_FOR = { "8h": 8 * 3600000, "1w": 7 * 86400000, always: 100 * 365 * 86400000 };

const mute = async (actor, conversationId, duration) => {
    const { conversation } = await loadAccessible(actor, conversationId);
    const until = duration && MUTE_FOR[duration] ? new Date(Date.now() + MUTE_FOR[duration]) : null;
    await Conversation.updateOne({ _id: conversation._id, "members.user": actor._id }, { $set: { "members.$.mutedUntil": until } });
    return { mutedUntil: until };
};

/** "Delete chat" / "Clear chat": hides everything so far, for the actor only. */
const clearChat = async (actor, conversationId) => {
    const { conversation } = await loadAccessible(actor, conversationId);
    const now = new Date();
    await Conversation.updateOne({ _id: conversation._id, "members.user": actor._id }, { $set: { "members.$.clearedAt": now, "members.$.lastReadAt": now } });
    return { clearedAt: now };
};

// ---------------------------------------------------------------- Media, links and docs in a chat

const sharedItems = async (actor, conversationId, kind = "media") => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const base = { conversation: conversation._id, createdAt: { $gte: access.visibleFrom }, hiddenFor: { $ne: actor._id }, deletedAt: null };
    const filter =
        kind === "links"
            ? { ...base, "link.url": { $exists: true, $ne: null } }
            : kind === "docs"
              ? { ...base, "attachments.kind": "DOCUMENT" }
              : { ...base, "attachments.kind": { $in: ["IMAGE", "VIDEO"] } };
    const rows = await Message.find(filter).sort({ createdAt: -1 }).limit(90).lean();
    return serializeMessages(rows, actor);
};

// ---------------------------------------------------------------- Uploads

const uploadTicket = async (actor, conversationId, { kind, ext }) => {
    const { conversation, access } = await loadAccessible(actor, conversationId);
    const blocked = await sendBlockedReason(actor, conversation, access);
    if (blocked && !(access.isAdmin && kind === "IMAGE")) throw fail(blocked, 403, ERROR_CODES.FORBIDDEN);
    return media.createUploadTicket(String(conversation._id), idOf(actor), kind, ext);
};

const uploadLocal = async (actor, conversationId, file, hint) => {
    const { conversation } = await loadAccessible(actor, conversationId);
    return { provider: "local", ...(await media.saveLocalFile(file, String(conversation._id), idOf(actor), hint)) };
};

// ---------------------------------------------------------------- People, blocking, settings

const searchPeople = async (actor, q = "") => {
    const term = String(q || "").trim();
    const base = { _id: { $ne: actor._id }, isActive: true, isEmailVerified: true, globalRole: { $in: [GLOBAL_ROLES.STUDENT, GLOBAL_ROLES.FACULTY] } };
    if (term.length >= 1) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const users = await User.find({ ...base, $or: [{ name: new RegExp(safe, "i") }, { email: new RegExp(`^${safe}`, "i") }] })
            .select(USER_FIELDS)
            .sort({ name: 1 })
            .limit(25)
            .lean();
        return users.map(userView);
    }
    // Suggestions: people you've chatted with, then members of your clubs.
    const recent = await Conversation.find({ type: TYPES.DIRECT, "members.user": actor._id, lastMessageAt: { $ne: null } }).sort({ lastMessageAt: -1 }).limit(12).lean();
    const recentIds = recent.map((conversation) => otherMemberId(conversation, actor));
    const myClubs = (await ClubMembership.find({ user: actor._id, status: MEMBERSHIP_STATUS.APPROVED }).select("club").lean()).map((row) => row.club);
    const mates = myClubs.length ? (await ClubMembership.find({ club: { $in: myClubs }, status: MEMBERSHIP_STATUS.APPROVED, user: { $ne: actor._id } }).select("user").limit(40).lean()).map((row) => String(row.user)) : [];
    const ids = [...new Set([...recentIds, ...mates])].slice(0, 25);
    const users = await loadUsers(ids);
    return ids.map((id) => users.get(id)).filter((user) => user?.isActive).map(userView);
};

const setBlocked = async (actor, userId, blocked) => {
    if (idOf(userId) === idOf(actor)) throw fail("You can't block yourself");
    await assertChatUser(userId).catch(() => {
        if (blocked) throw fail("Account not found", 404, ERROR_CODES.NOT_FOUND);
    });
    await User.updateOne({ _id: actor._id }, blocked ? { $addToSet: { blockedUsers: userId } } : { $pull: { blockedUsers: userId } });
    userCache.delete?.(idOf(actor));
    const key = [idOf(actor), idOf(userId)].sort().join("_");
    const conversation = await Conversation.findOne({ directKey: key }).select("_id").lean();
    if (conversation) realtime.emitToUsers([idOf(actor), idOf(userId)], "conversation:updated", { conversationId: String(conversation._id) });
    return { blocked: Boolean(blocked) };
};

const listBlocked = async (actor) => {
    const me = await User.findById(actor._id).select("blockedUsers").populate("blockedUsers", USER_FIELDS).lean();
    return (me?.blockedUsers || []).map(userView);
};

const getSettings = async (actor) => {
    const me = await User.findById(actor._id).select("showActivityStatus").lean();
    return { showActivityStatus: me?.showActivityStatus !== false };
};

const updateSettings = async (actor, { showActivityStatus }) => {
    const update = {};
    if (showActivityStatus !== undefined) update.showActivityStatus = Boolean(showActivityStatus);
    await User.updateOne({ _id: actor._id }, { $set: update });
    userCache.delete?.(idOf(actor));
    return getSettings(actor);
};

// ---------------------------------------------------------------- Reports (to the university admin)

const report = async (actor, messageId, reason = "") => {
    const { message, conversation } = await loadMessage(actor, messageId);
    if (idOf(message.sender) === idOf(actor)) throw fail("You can't report your own message");
    if (message.type === MESSAGE_TYPES.SYSTEM) throw fail("This can't be reported");
    try {
        await ChatReport.create({
            message: message._id,
            conversation: conversation._id,
            reporter: actor._id,
            sender: message.sender,
            reason: String(reason || "").trim().slice(0, 500),
            text: message.text,
            attachmentCount: message.attachments.length
        });
    } catch (error) {
        if (error.code === 11000) return { reported: true };
        throw error;
    }
    const admins = await User.find({ globalRole: GLOBAL_ROLES.ADMIN, isActive: true }).select("_id").lean();
    await require("./NotificationService").notify(
        admins.map((admin) => admin._id),
        { type: NOTIFICATION_TYPES.CHAT_REPORT, title: "A chat message was reported", message: String(reason || message.text || "").slice(0, 140), link: "/admin/chat-reports" }
    );
    return { reported: true };
};

const assertAdmin = (actor) => {
    if (actor.globalRole !== GLOBAL_ROLES.ADMIN) throw fail("Only the university admin can see reports", 403, ERROR_CODES.FORBIDDEN);
};

const listReports = async (actor, { status = "OPEN" } = {}) => {
    assertAdmin(actor);
    const rows = await ChatReport.find(status === "ALL" ? {} : { status }).sort({ createdAt: -1 }).limit(200).populate("reporter", USER_FIELDS).populate("sender", `${USER_FIELDS} email`).lean();
    return rows.map((row) => ({ ...row, reporter: userView(row.reporter), sender: row.sender ? { ...userView(row.sender), email: row.sender.email } : null }));
};

const resolveReport = async (actor, reportId, { note = "" } = {}) => {
    assertAdmin(actor);
    const row = isId(reportId) ? await ChatReport.findById(reportId) : null;
    if (!row) throw fail("Report not found", 404, ERROR_CODES.NOT_FOUND);
    row.status = "RESOLVED";
    row.resolvedBy = actor._id;
    row.resolvedAt = new Date();
    row.note = String(note || "").trim().slice(0, 500);
    await row.save();
    return row;
};

module.exports = {
    listConversations,
    unreadSummary,
    openDirect,
    createGroup,
    getConversation,
    listMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    react,
    forward,
    setPinned,
    markRead,
    updateConversation,
    addMembers,
    removeMember,
    setAdmin,
    leaveGroup,
    mute,
    clearChat,
    sharedItems,
    uploadTicket,
    uploadLocal,
    searchPeople,
    setBlocked,
    listBlocked,
    getSettings,
    updateSettings,
    report,
    listReports,
    resolveReport,
    clubMembershipChanged,
    previewOf
};
