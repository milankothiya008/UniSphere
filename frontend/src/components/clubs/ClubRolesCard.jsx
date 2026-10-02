import { useEffect, useId, useState } from "react";
import { Check, Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Avatar, Button, Card, ConfirmDialog, Input, Modal, RoleBadge } from "../ui";
import { PERMISSION_GROUPS, PERMISSION_LABELS } from "../../lib/constants";
import { plural } from "../../lib/format";

const emptyRole = { name: "", description: "", permissions: [] };

/** Create or edit a role: its name, a short description and the authorities it grants. */
const RoleEditor = ({ club, role, presidentOnly, onClose, onSaved, onDelete }) => {
    const formId = useId();
    const toast = useToast();
    const creating = role === "new";
    const [form, setForm] = useState(emptyRole);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (role) {
            setForm(creating ? emptyRole : { name: role.name, description: role.description, permissions: role.permissions });
            setError(null);
        }
    }, [role, creating]);

    const toggle = (key) =>
        setForm((prev) => ({ ...prev, permissions: prev.permissions.includes(key) ? prev.permissions.filter((item) => item !== key) : [...prev.permissions, key] }));

    const nameProblem = form.name.trim().length < 2 ? "At least 2 characters" : null;

    const save = async (event) => {
        event.preventDefault();
        if (nameProblem) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            const body = { name: form.name.trim(), description: form.description.trim(), permissions: form.permissions };
            if (creating) {
                await clubApi.createRole(club._id, body);
                toast.success(`"${body.name}" role created`);
            } else {
                await clubApi.updateRole(club._id, role.key, role.renamable ? body : { description: body.description, permissions: body.permissions });
                toast.success(`"${role.name}" updated`);
            }
            onSaved();
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={Boolean(role)}
            onClose={pending ? undefined : onClose}
            size="lg"
            title={creating ? "New role" : `Edit ${role?.name}`}
            description="Choose what members with this role can do in the club. Everyone keeps member access."
            footer={
                <>
                    {!creating && role?.deletable && (
                        <Button variant="ghost" className="role-delete" onClick={() => onDelete(role)} disabled={pending}>
                            <Trash2 size={15} /> Delete role
                        </Button>
                    )}
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" form={formId} loading={pending} disabled={Boolean(nameProblem)}>
                        <Check size={16} /> {creating ? "Create role" : "Save role"}
                    </Button>
                </>
            }
        >
            <form id={formId} className="stack" onSubmit={save} noValidate>
                <div className="form-grid">
                    <Input
                        label="Role name"
                        value={form.name}
                        onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                        maxLength={40}
                        placeholder="e.g. Design lead"
                        disabled={!creating && !role?.renamable}
                        hint={!creating && !role?.renamable ? "Built-in role — the name is fixed" : `${form.name.length}/40`}
                        error={form.name && nameProblem ? nameProblem : undefined}
                        required
                    />
                    <Input
                        label="Description (optional)"
                        value={form.description}
                        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                        maxLength={200}
                        placeholder="What this person looks after"
                    />
                </div>
                <div className="authority-groups">
                    {PERMISSION_GROUPS.map((group) => (
                        <fieldset key={group.title} className="authority-group">
                            <legend>{group.title}</legend>
                            {group.items.map(([key, label, hint]) => {
                                const locked = presidentOnly.includes(key);
                                const checked = form.permissions.includes(key);
                                return (
                                    <label key={key} className={`authority ${checked ? "is-on" : ""} ${locked ? "is-locked" : ""}`}>
                                        <input type="checkbox" checked={checked} disabled={locked} onChange={() => toggle(key)} />
                                        <span className="authority-text">
                                            <strong>{label}</strong>
                                            <span>{locked ? "President only" : hint}</span>
                                        </span>
                                        {locked && <Lock size={14} aria-hidden="true" />}
                                    </label>
                                );
                            })}
                        </fieldset>
                    ))}
                </div>
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};

const AuthorityChips = ({ role }) => {
    if (role.key === "PRESIDENT") {
        return <span className="authority-chip is-all">Everything, including club settings, roles and recruitment</span>;
    }
    if (!role.permissions.length) {
        return <span className="subtle small">Member access only</span>;
    }
    return role.permissions.map((key) => (
        <span key={key} className="authority-chip">
            {PERMISSION_LABELS[key] || key}
        </span>
    ));
};

// Who holds the role: faces and names, or "Vacant".
const Holders = ({ role, holders }) => {
    const people = holders.length ? holders.map((membership) => membership.user) : role.holder ? [role.holder] : [];
    if (!people.length) {
        return <span className="role-holders is-vacant">{role.unique ? "Vacant" : "No one yet"}</span>;
    }
    const names = people.slice(0, 3).map((person) => person.name);
    return (
        <span className="role-holders">
            <span className="role-faces" aria-hidden="true">
                {people.slice(0, 4).map((person) => (
                    <Avatar key={person._id} name={person.name} src={person.avatar} size="xs" />
                ))}
            </span>
            <span className="small">
                {names.join(", ")}
                {people.length > 3 ? ` +${people.length - 3}` : ""}
            </span>
        </span>
    );
};

const RoleSummary = ({ role, holders, editable = false }) => (
    <>
        <span className="role-item-head">
            <RoleBadge role={role.key} label={role.name} />
            <span className="subtle small">
                {role.unique ? "1 seat" : plural(role.memberCount, "member")}
                {role.system && (
                    <>
                        {" "}
                        · <Lock size={11} aria-label="Built-in" /> built-in
                    </>
                )}
            </span>
            {editable && (
                <span className="role-item-edit" aria-hidden="true">
                    <Pencil size={14} /> Edit
                </span>
            )}
        </span>
        {role.description && <span className="small muted role-item-description">{role.description}</span>}
        {role.key !== "MEMBER" && <Holders role={role} holders={holders} />}
        <span className="authority-chips">
            <AuthorityChips role={role} />
        </span>
    </>
);

/**
 * The club's roles and what each can do. The president creates, edits and deletes roles; members and the
 * mentor see them read-only.
 */
export const ClubRolesCard = ({ club, roles, members = [], onChanged }) => {
    const toast = useToast();
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const data = roles.data;
    const canManage = Boolean(data?.canManage);

    const remove = async () => {
        await clubApi.deleteRole(club._id, deleting.key);
        toast.success(`"${deleting.name}" removed`);
        onChanged();
    };

    return (
        <Card
            title={
                <h2 className="row">
                    <ShieldCheck size={17} /> Roles & authorities
                </h2>
            }
            actions={
                canManage && (
                    <Button size="sm" onClick={() => setEditing("new")} disabled={(data?.roles.length || 0) >= 20}>
                        <Plus size={14} /> New role
                    </Button>
                )
            }
            padded={false}
        >
            {canManage && <p className="subtle roles-intro">Create the roles your club needs and choose what each can do — click a role to edit it. There is one president and at most one vice-president.</p>}
            <ul className="role-list role-grid">
                {data?.roles.map((role, index) => {
                    const holders = members.filter((membership) => membership.role === role.key);
                    return (
                        <li key={role.key} style={{ "--i": Math.min(index, 12) }} className={role.key === "PRESIDENT" ? "is-president" : ""}>
                            {canManage && role.editable ? (
                                <button type="button" className="role-item is-editable" onClick={() => setEditing(role)} aria-label={`Edit ${role.name}`}>
                                    <RoleSummary role={role} holders={holders} editable />
                                </button>
                            ) : (
                                <div className="role-item">
                                    <RoleSummary role={role} holders={holders} />
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            <RoleEditor
                club={club}
                role={editing}
                presidentOnly={data?.presidentOnly || []}
                onClose={() => setEditing(null)}
                onSaved={onChanged}
                onDelete={(role) => {
                    setEditing(null);
                    setDeleting(role);
                }}
            />
            <ConfirmDialog
                open={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                onConfirm={remove}
                title={`Delete the "${deleting?.name}" role?`}
                description={
                    deleting?.memberCount
                        ? `${plural(deleting.memberCount, "member")} with this role will become regular members and be notified.`
                        : "Nobody holds this role right now."
                }
                confirmLabel="Delete role"
                variant="danger"
            />
        </Card>
    );
};
