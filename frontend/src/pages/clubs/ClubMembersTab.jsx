import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Phone, UserMinus, Users } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, AsyncContent, Avatar, Card, ConfirmDialog, EmptyState, ErrorState, RoleBadge, UserPicker } from "../../components/ui";
import { PERMISSIONS } from "../../lib/constants";
import { departmentsLabel, batchLabel, formatDate } from "../../lib/format";
import { scopeDepartments } from "../../lib/eligibility";
import { ClubRolesCard } from "../../components/clubs/ClubRolesCard";
import { formatPhone } from "../../lib/phone";

const ClubMembersTab = () => {
    const { club, reload: reloadClub } = useOutletContext();
    const { user } = useAuth();
    const toast = useToast();
    const viewer = club.viewer || {};
    const can = (permission) => viewer.permissions?.includes(permission);
    const canManage = can(PERMISSIONS.MANAGE_MEMBERS);
    const canAssign = can(PERMISSIONS.ASSIGN_ROLES);

    // Members of any club, club mentors and the admin can see the list; roles stay inside the club.
    const insider = viewer.isMember || viewer.isMentor;
    const canSee = insider || Boolean(viewer.canSeeMembers);
    const members = useApi(() => (canSee ? clubApi.members(club._id) : Promise.resolve({ data: [] })), [club._id, canSee]);
    const roles = useApi(() => (insider ? clubApi.roles(club._id) : Promise.resolve({ data: null })), [club._id, insider]);
    const [removing, setRemoving] = useState(null);

    const refresh = () => {
        members.reload({ silent: true });
        roles.reload({ silent: true });
        reloadClub();
    };

    const changeRole = async (membership, role) => {
        try {
            const response = await clubApi.changeRole(club._id, membership.user._id, role);
            const name = response.data?.roleName || roles.data?.roles.find((item) => item.key === role)?.name || "a member";
            toast.success(`${membership.user.name} is now ${role === "MEMBER" ? "a member" : name}`);
            members.reload({ silent: true });
            roles.reload({ silent: true });
        } catch (err) {
            toast.error(err);
        }
    };

    // Everyone but the president can be given any role; the vice-president seat only while it's free.
    const roleOptions = (membership) =>
        (roles.data?.roles || [])
            .filter((role) => role.key !== "PRESIDENT")
            .map((role) => {
                const taken = role.unique && role.holder && role.holder._id !== membership.user._id;
                return { value: role.key, label: taken ? `${role.name} — held by ${role.holder.name}` : role.name, disabled: taken };
            });

    const addMember = async (student) => {
        try {
            await clubApi.addMember(club._id, student._id);
            toast.success(`${student.name} added to the club`);
            refresh();
        } catch (err) {
            toast.error(err);
        }
    };

    const remove = async () => {
        await clubApi.removeMember(club._id, removing.user._id);
        toast.success(`${removing.user.name} was removed`);
        refresh();
    };

    if (!canSee) {
        return <ErrorState error={{ status: 403, message: "Member lists are open to club members, club mentors and the admin." }} />;
    }

    const canRemove = (membership) =>
        canManage && membership.role !== "PRESIDENT" && membership.user._id !== user._id && (membership.role === "MEMBER" || canAssign);

    return (
        <div className="stack-lg">
            <Card
                title={`${members.data?.length ?? ""} members`}
                padded={false}
                actions={
                    canManage &&
                    club.status === "ACTIVE" && (
                        <div style={{ width: 300, maxWidth: "100%" }}>
                            <UserPicker
                                accountType="STUDENT"
                                departments={scopeDepartments(club)}
                                placeholder={club.allDepartments ? "Add a student directly" : `Add a ${departmentsLabel(club)} student`}
                                onSelect={addMember}
                                exclude={(members.data || []).map((m) => m.user._id)}
                            />
                        </div>
                    )
                }
            >
                <AsyncContent
                    loading={members.loading}
                    error={members.error}
                    onRetry={members.reload}
                    isEmpty={!members.data?.length}
                    empty={<EmptyState icon={Users} title="No members yet" />}
                >
                    <div className="table-wrap">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Member</th>
                                    <th>Mobile</th>
                                    <th>Department</th>
                                    <th>Role</th>
                                    <th>Joined</th>
                                    {canManage && <th />}
                                </tr>
                            </thead>
                            <tbody>
                                {members.data?.map((membership) => (
                                    <tr key={membership._id}>
                                        <td>
                                            <div className="row" style={{ flexWrap: "nowrap" }}>
                                                <Avatar name={membership.user.name} size="sm" />
                                                <div>
                                                    <strong>{membership.user.name}</strong>
                                                    {membership.user._id === user._id && <span className="subtle"> (you)</span>}
                                                    <div className="subtle">{membership.user.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="nowrap">
                                            {membership.user.phone ? (
                                                <a className="member-phone" href={`tel:${membership.user.phone}`} title={`Call ${membership.user.name}`}>
                                                    <Phone size={13} /> {formatPhone(membership.user.phone)}
                                                </a>
                                            ) : (
                                                <span className="subtle small">Not added yet</span>
                                            )}
                                        </td>
                                        <td className="nowrap">
                                            {membership.user.departmentCode} · {batchLabel(membership.user.batchCode)}
                                        </td>
                                        <td>
                                            {canAssign && roles.data && membership.role !== "PRESIDENT" && membership.user._id !== user._id ? (
                                                <select
                                                    className="select"
                                                    style={{ minWidth: 200, height: 34, padding: "4px 30px 4px 10px" }}
                                                    value={membership.role}
                                                    onChange={(e) => changeRole(membership, e.target.value)}
                                                    aria-label={`Role for ${membership.user.name}`}
                                                >
                                                    {roleOptions(membership).map((option) => (
                                                        <option key={option.value} value={option.value} disabled={option.disabled}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <RoleBadge role={membership.role} label={membership.roleName} />
                                            )}
                                        </td>
                                        <td className="nowrap subtle">{formatDate(membership.joinedAt)}</td>
                                        {canManage && (
                                            <td className="actions">
                                                <ActionMenu
                                                    label={`Actions for ${membership.user.name}`}
                                                    items={[{ label: "Remove from club", icon: UserMinus, onClick: () => setRemoving(membership), danger: true, hidden: !canRemove(membership) }]}
                                                />
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </AsyncContent>
            </Card>

            {roles.data && <ClubRolesCard club={club} roles={roles} onChanged={refresh} />}

            <ConfirmDialog
                open={Boolean(removing)}
                onClose={() => setRemoving(null)}
                onConfirm={remove}
                title={`Remove ${removing?.user.name}?`}
                description="They lose access to member-only content and any club role."
                confirmLabel="Remove member"
                variant="danger"
            />
        </div>
    );
};

export default ClubMembersTab;
