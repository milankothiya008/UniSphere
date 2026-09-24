import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Check, UserMinus, Users, X } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, RoleBadge, UserPicker } from "../../components/ui";
import { ASSIGNABLE_CLUB_ROLES, CLUB_ROLE_DESCRIPTIONS, PERMISSIONS } from "../../lib/constants";
import { departmentsLabel, batchLabel, formatDate, humanize, timeAgo } from "../../lib/format";
import { scopeDepartments } from "../../lib/eligibility";

const JoinRequests = ({ club, onChange }) => {
    const toast = useToast();
    const { data, loading, error, reload } = useApi(() => clubApi.membershipRequests(club._id), [club._id]);
    const [rejecting, setRejecting] = useState(null);
    const [busy, setBusy] = useState(null);

    const approve = async (request) => {
        setBusy(request._id);
        try {
            await clubApi.approveRequest(club._id, request._id);
            toast.success(`${request.user.name} joined the club`);
            reload({ silent: true });
            onChange();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    };

    const reject = async (reason) => {
        await clubApi.rejectRequest(club._id, rejecting._id, reason || undefined);
        toast.success("Request declined");
        reload({ silent: true });
    };

    return (
        <Card title={<h2 className="row">Membership requests {data?.length ? <Badge tone="warning">{data.length}</Badge> : null}</h2>} padded={false}>
            <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<p className="subtle card-body">No pending requests.</p>}>
                <div className="list-rows">
                    {data?.map((request) => (
                        <div key={request._id} className="list-row">
                            <Avatar name={request.user.name} />
                            <div className="grow">
                                <div className="title">{request.user.name}</div>
                                <div className="subtle">
                                    {request.user.email} · {request.user.departmentCode} · {batchLabel(request.user.batchCode)} · {timeAgo(request.createdAt)}
                                </div>
                                {request.requestMessage && <div className="small muted" style={{ marginTop: 4 }}>“{request.requestMessage}”</div>}
                            </div>
                            <div className="row">
                                <Button size="sm" variant="success" onClick={() => approve(request)} loading={busy === request._id}>
                                    <Check size={14} /> Approve
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setRejecting(request)} disabled={busy === request._id}>
                                    <X size={14} /> Decline
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </AsyncContent>
            <ConfirmDialog
                open={Boolean(rejecting)}
                onClose={() => setRejecting(null)}
                onConfirm={reject}
                title={`Decline ${rejecting?.user.name}'s request?`}
                confirmLabel="Decline"
                variant="danger"
                reasonLabel="Reason (shared with the student)"
            />
        </Card>
    );
};

const ClubMembersTab = () => {
    const { club, reload: reloadClub } = useOutletContext();
    const { user } = useAuth();
    const toast = useToast();
    const viewer = club.viewer || {};
    const can = (permission) => viewer.permissions?.includes(permission);
    const canManage = can(PERMISSIONS.MANAGE_MEMBERS);
    const canAssign = can(PERMISSIONS.ASSIGN_ROLES);

    const members = useApi(() => clubApi.members(club._id), [club._id]);
    const [removing, setRemoving] = useState(null);

    const refresh = () => {
        members.reload({ silent: true });
        reloadClub();
    };

    const changeRole = async (membership, role) => {
        try {
            await clubApi.changeRole(club._id, membership.user._id, role);
            toast.success(`${membership.user.name} is now ${humanize(role).toLowerCase()}`);
            members.reload({ silent: true });
        } catch (err) {
            toast.error(err);
        }
    };

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

    if (!viewer.isMember && !viewer.isMentor) {
        return <ErrorState error={{ status: 403, message: "Only club members and the club's mentor can see the member list." }} />;
    }

    const canRemove = (membership) =>
        canManage && membership.role !== "PRESIDENT" && membership.user._id !== user._id && (membership.role === "MEMBER" || canAssign);

    return (
        <div className="stack-lg">
            {canManage && club.status === "ACTIVE" && <JoinRequests club={club} onChange={refresh} />}

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
                                            {membership.user.departmentCode} · {batchLabel(membership.user.batchCode)}
                                        </td>
                                        <td>
                                            {canAssign && membership.role !== "PRESIDENT" && membership.user._id !== user._id ? (
                                                <select
                                                    className="select"
                                                    style={{ minWidth: 200, height: 34, padding: "4px 30px 4px 10px" }}
                                                    value={membership.role}
                                                    onChange={(e) => changeRole(membership, e.target.value)}
                                                    aria-label={`Role for ${membership.user.name}`}
                                                >
                                                    {ASSIGNABLE_CLUB_ROLES.map((role) => (
                                                        <option key={role} value={role}>
                                                            {humanize(role)}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <RoleBadge role={membership.role} />
                                            )}
                                        </td>
                                        <td className="nowrap subtle">{formatDate(membership.joinedAt)}</td>
                                        {canManage && (
                                            <td className="actions">
                                                {canRemove(membership) && (
                                                    <Button size="sm" variant="ghost" onClick={() => setRemoving(membership)}>
                                                        <UserMinus size={14} /> Remove
                                                    </Button>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </AsyncContent>
            </Card>

            {canAssign && (
                <Card title="What each role can do">
                    <div className="grid-2">
                        {Object.entries(CLUB_ROLE_DESCRIPTIONS).map(([role, description]) => (
                            <div key={role} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                                <RoleBadge role={role} />
                                <span className="small muted">{description}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

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
