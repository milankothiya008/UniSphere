import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    Ban,
    Bell,
    BellOff,
    Camera,
    ExternalLink,
    FileText,
    Link2,
    LogOut,
    Megaphone,
    MoreHorizontal,
    Pencil,
    Shield,
    ShieldOff,
    Trash2,
    UserMinus,
    UserPlus,
    X
} from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, Avatar, Button, ConfirmDialog, Input, Modal, Switch, useLightbox } from "../ui";
import { PeoplePicker } from "./NewChatDialog";
import { MUTE_OPTIONS, fileSize, listTime, mutedLabel, uploadChatFile } from "../../lib/chat";

/** Photos and videos, links and documents shared in the chat. */
const Shared = ({ conversationId }) => {
    const lightbox = useLightbox();
    const [kind, setKind] = useState("media");
    const [items, setItems] = useState(null);
    useEffect(() => {
        setItems(null);
        chatApi
            .shared(conversationId, kind)
            .then((response) => setItems(response.data))
            .catch(() => setItems([]));
    }, [conversationId, kind]);

    const media = kind === "media" ? (items || []).flatMap((message) => message.attachments.filter((item) => ["IMAGE", "VIDEO"].includes(item.kind))) : [];
    return (
        <div className="info-shared">
            <div className="chat-filters" role="tablist">
                {[
                    ["media", "Media"],
                    ["links", "Links"],
                    ["docs", "Docs"]
                ].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={kind === value}
                        className={`chat-filter ${kind === value ? "active" : ""}`}
                        onClick={() => setKind(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {!items ? (
                <p className="subtle small">Loading…</p>
            ) : kind === "media" ? (
                media.length ? (
                    <div className="info-media">
                        {media.map((item, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => lightbox({ src: item.url, type: item.kind === "VIDEO" ? "video" : "image", poster: item.poster })}
                                aria-label="Open"
                            >
                                <img src={item.kind === "VIDEO" ? item.poster || item.thumb : item.thumb || item.url} alt="" loading="lazy" />
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="subtle small">No photos or videos yet.</p>
                )
            ) : items.length ? (
                <ul className="info-links">
                    {items.map((message) =>
                        kind === "links" ? (
                            <li key={message._id}>
                                <a href={message.link.url} target="_blank" rel="noreferrer noopener">
                                    <Link2 size={16} />
                                    <span>
                                        <strong>{message.link.title}</strong>
                                        <small>{message.link.site}</small>
                                    </span>
                                </a>
                            </li>
                        ) : (
                            message.attachments
                                .filter((file) => file.kind === "DOCUMENT")
                                .map((file, index) => (
                                    <li key={`${message._id}-${index}`}>
                                        <a href={file.url} target="_blank" rel="noreferrer noopener">
                                            <FileText size={16} />
                                            <span>
                                                <strong>{file.name || "Document"}</strong>
                                                <small>
                                                    {fileSize(file.bytes)} · {listTime(message.createdAt)}
                                                </small>
                                            </span>
                                        </a>
                                    </li>
                                ))
                        )
                    )}
                </ul>
            ) : (
                <p className="subtle small">{kind === "links" ? "No links yet." : "No documents yet."}</p>
            )}
        </div>
    );
};

/** Details of the open chat (side panel on computers, full screen on phones). */
export const ChatInfo = ({ detail, onClose, onUpdated, onCleared }) => {
    const { user } = useAuth();
    const toast = useToast();
    const navigate = useNavigate();
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(detail.title);
    const [adding, setAdding] = useState(false);
    const [picked, setPicked] = useState([]);
    const [confirm, setConfirm] = useState(null);
    const photoInput = useRef(null);

    const run = async (work, success) => {
        try {
            const result = await work();
            if (result?.data?._id) onUpdated(result.data);
            if (success) toast.success(success);
            return result;
        } catch (error) {
            toast.error(error);
            return null;
        }
    };

    const muteTo = async (duration) => {
        const result = await run(() => chatApi.mute(detail._id, duration), duration ? "Messages muted" : "Messages unmuted");
        if (result) onUpdated({ ...detail, muted: Boolean(duration), mutedUntil: result.data.mutedUntil });
    };

    const changePhoto = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast.error("Choose a JPEG, PNG or WebP photo");
        try {
            const media = await uploadChatFile(detail._id, file, { kind: "IMAGE" });
            await run(() => chatApi.update(detail._id, { avatar: media }), "Group photo updated");
        } catch (error) {
            toast.error(error);
        }
    };

    const isGroup = detail.type === "GROUP";
    const isClub = detail.type === "CLUB";
    const other = detail.other;

    return (
        <aside className="chat-info" aria-label="Chat details">
            <header className="chat-info-head">
                <strong>Details</strong>
                <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
                    <X size={22} />
                </button>
            </header>

            <div className="chat-info-body">
                <div className="info-hero">
                    <span className="info-avatar">
                        <Avatar name={detail.title} src={detail.avatar} size="xl" square={isClub} />
                        {detail.canEditInfo && (
                            <button type="button" className="info-avatar-edit" onClick={() => photoInput.current?.click()} aria-label="Change group photo">
                                <Camera size={15} />
                            </button>
                        )}
                    </span>
                    {renaming ? (
                        <form
                            className="info-rename"
                            onSubmit={async (event) => {
                                event.preventDefault();
                                if (await run(() => chatApi.update(detail._id, { name }), "Group renamed")) setRenaming(false);
                            }}
                        >
                            <Input label="Group name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
                            <div className="row">
                                <Button size="sm" type="submit" disabled={!name.trim()}>
                                    Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <h2>
                            {detail.title}
                            {detail.canEditInfo && (
                                <button type="button" className="icon-button" onClick={() => setRenaming(true)} aria-label="Rename group">
                                    <Pencil size={15} />
                                </button>
                            )}
                        </h2>
                    )}
                    <span className="subtle small">{isClub ? "Club group" : isGroup ? "Group" : other?.accountType === "FACULTY" ? "Faculty" : "Student"}</span>
                    {detail.muted && (
                        <span className="info-muted">
                            <BellOff size={13} /> {mutedLabel(detail.mutedUntil)}
                        </span>
                    )}
                    <div className="info-actions">
                        {other && (
                            <Link to={`/people/${other._id}`} className="info-action">
                                <ExternalLink size={18} />
                                Profile
                            </Link>
                        )}
                        {isClub && (
                            <Link to={`/clubs/${detail.club}`} className="info-action">
                                <ExternalLink size={18} />
                                Club page
                            </Link>
                        )}
                        <ActionMenu
                            items={
                                detail.muted
                                    ? [{ label: "Unmute messages", icon: Bell, onClick: () => muteTo(null) }]
                                    : MUTE_OPTIONS.map(([value, label]) => ({ label, icon: BellOff, onClick: () => muteTo(value) }))
                            }
                            label="Mute"
                            align="left"
                            trigger={({ toggle }) => (
                                <button type="button" className="info-action" onClick={toggle}>
                                    {detail.muted ? <BellOff size={18} /> : <Bell size={18} />}
                                    {detail.muted ? "Muted" : "Mute"}
                                </button>
                            )}
                        />
                    </div>
                </div>

                {(isGroup || isClub) && detail.isAdmin && (
                    <section className="info-section">
                        <Switch
                            checked={detail.announceOnly}
                            onChange={(value) =>
                                run(() => chatApi.update(detail._id, { announceOnly: value }), value ? "Only admins can send now" : "Everyone can send now")
                            }
                            label="Only admins can send"
                            description="For announcements. Members can still read and react."
                        />
                    </section>
                )}

                {(isGroup || isClub) && (
                    <section className="info-section">
                        <div className="info-section-head">
                            <strong>
                                {detail.memberCount} {detail.memberCount === 1 ? "member" : "members"}
                            </strong>
                            {detail.canManageMembers && (
                                <Button size="sm" variant="secondary" onClick={() => (setPicked([]), setAdding(true))}>
                                    <UserPlus size={15} /> Add
                                </Button>
                            )}
                        </div>
                        {isClub && <p className="subtle small">Everyone in the club is here automatically. The faculty mentor isn't part of the club group.</p>}
                        <ul className="info-members">
                            {detail.members.map((member) => {
                                const me = String(member._id) === String(user._id);
                                const menu =
                                    detail.canManageMembers && !me
                                        ? [
                                              member.role === "ADMIN"
                                                  ? {
                                                        label: "Remove as admin",
                                                        icon: ShieldOff,
                                                        onClick: () => run(() => chatApi.setAdmin(detail._id, member._id, false))
                                                    }
                                                  : {
                                                        label: "Make admin",
                                                        icon: Shield,
                                                        onClick: () => run(() => chatApi.setAdmin(detail._id, member._id, true))
                                                    },
                                              {
                                                  label: "Remove from group",
                                                  icon: UserMinus,
                                                  danger: true,
                                                  onClick: () => setConfirm({ type: "remove", member })
                                              }
                                          ]
                                        : null;
                                return (
                                    <li key={member._id}>
                                        <Link to={me ? "/profile" : `/people/${member._id}`} className="info-member">
                                            <Avatar name={member.name} src={member.avatar} />
                                            <span>
                                                <strong>{me ? `${member.name} (you)` : member.name}</strong>
                                                <small className="subtle">{member.accountType === "FACULTY" ? "Faculty" : member.departmentCode}</small>
                                            </span>
                                        </Link>
                                        {member.role === "ADMIN" && <span className="info-admin">Admin</span>}
                                        {menu && (
                                            <ActionMenu
                                                items={menu}
                                                label={`Options for ${member.name}`}
                                                trigger={({ toggle }) => (
                                                    <button type="button" className="icon-button" onClick={toggle} aria-label={`Options for ${member.name}`}>
                                                        <MoreHorizontal size={18} />
                                                    </button>
                                                )}
                                            />
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                <section className="info-section">
                    <Shared conversationId={detail._id} />
                </section>

                <section className="info-section info-danger">
                    {detail.type === "DIRECT" && other && (
                        <button type="button" className="info-danger-row" onClick={() => setConfirm({ type: detail.block?.iBlocked ? "unblock" : "block" })}>
                            <Ban size={18} /> {detail.block?.iBlocked ? `Unblock ${other.name.split(" ")[0]}` : `Block ${other.name.split(" ")[0]}`}
                        </button>
                    )}
                    <button type="button" className="info-danger-row" onClick={() => setConfirm({ type: "clear" })}>
                        <Trash2 size={18} /> {detail.type === "DIRECT" ? "Delete chat" : "Clear chat"}
                    </button>
                    {isGroup && (
                        <button type="button" className="info-danger-row" onClick={() => setConfirm({ type: "leave" })}>
                            <LogOut size={18} /> Leave group
                        </button>
                    )}
                    {isClub && (
                        <p className="subtle small">
                            <Megaphone size={13} /> You leave this chat by leaving the club.
                        </p>
                    )}
                </section>
            </div>

            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={changePhoto} />

            <Modal
                open={adding}
                onClose={() => setAdding(false)}
                title="Add people"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setAdding(false)}>
                            Cancel
                        </Button>
                        <Button
                            disabled={!picked.length}
                            onClick={async () => {
                                if (
                                    await run(
                                        () =>
                                            chatApi.addMembers(
                                                detail._id,
                                                picked.map((person) => person._id)
                                            ),
                                        "Added to the group"
                                    )
                                )
                                    setAdding(false);
                            }}
                        >
                            Add{picked.length ? ` (${picked.length})` : ""}
                        </Button>
                    </>
                }
            >
                <PeoplePicker
                    multiple
                    selected={picked}
                    exclude={detail.members.map((member) => String(member._id))}
                    onToggle={(person) =>
                        setPicked((current) =>
                            current.some((item) => item._id === person._id) ? current.filter((item) => item._id !== person._id) : [...current, person]
                        )
                    }
                />
            </Modal>

            <ConfirmDialog
                open={Boolean(confirm)}
                onClose={() => setConfirm(null)}
                onConfirm={async () => {
                    const action = confirm;
                    if (action.type === "remove") await run(() => chatApi.removeMember(detail._id, action.member._id), `${action.member.name} was removed`);
                    if (action.type === "block" || action.type === "unblock") {
                        await chatApi.setBlocked(other._id, action.type === "block");
                        toast.success(action.type === "block" ? `${other.name} is blocked` : `${other.name} is unblocked`);
                        onUpdated((await chatApi.get(detail._id)).data);
                    }
                    if (action.type === "clear") {
                        await chatApi.clear(detail._id);
                        if (detail.type === "DIRECT") navigate("/messages", { replace: true });
                        else onCleared?.();
                    }
                    if (action.type === "leave") {
                        await chatApi.leave(detail._id);
                        navigate("/messages", { replace: true });
                    }
                }}
                title={
                    confirm?.type === "remove"
                        ? `Remove ${confirm.member.name}?`
                        : confirm?.type === "block"
                          ? `Block ${other?.name}?`
                          : confirm?.type === "unblock"
                            ? `Unblock ${other?.name}?`
                            : confirm?.type === "leave"
                              ? "Leave this group?"
                              : detail.type === "DIRECT"
                                ? "Delete this chat?"
                                : "Clear this chat?"
                }
                description={
                    confirm?.type === "block"
                        ? "They won't be able to message you, and you won't be able to message them. They aren't told."
                        : confirm?.type === "unblock"
                          ? "You'll be able to message each other again."
                          : confirm?.type === "leave"
                            ? "You won't get new messages from this group. An admin can add you back."
                            : confirm?.type === "remove"
                              ? "They'll stop getting messages from this group."
                              : "Messages are removed for you only. Others keep their copy."
                }
                confirmLabel={
                    confirm?.type === "unblock"
                        ? "Unblock"
                        : confirm?.type === "leave"
                          ? "Leave"
                          : confirm?.type === "remove"
                            ? "Remove"
                            : confirm?.type === "block"
                              ? "Block"
                              : "Delete"
                }
                variant={confirm?.type === "unblock" ? "primary" : "danger"}
            />
        </aside>
    );
};
