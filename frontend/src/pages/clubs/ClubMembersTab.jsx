import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Crown, Phone, ShieldCheck, UserMinus, Users } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { ActionMenu, AsyncContent, Avatar, Card, ConfirmDialog, EmptyState, ErrorState, RoleBadge, SearchInput, Segmented, UserPicker } from "../../components/ui";
import { PERMISSIONS } from "../../lib/constants";
import { departmentsLabel, batchLabel, formatDate } from "../../lib/format";
import { scopeDepartments } from "../../lib/eligibility";
import { ClubRolesCard } from "../../components/clubs/ClubRolesCard";
import { formatPhone } from "../../lib/phone";

const PhoneLink = ({ person }) =>
    person.phone ? (
        <a className="member-phone" href={`tel:${person.phone}`} title={`Call ${person.name}`}>
            <Phone size={13} /> {formatPhone(person.phone)}
        </a>
    ) : (
        <span className="subtle small">No number yet</span>
    );

/** The people who hold a role, president first: who to contact for what. */
const CoreTeam = ({ team, me }) => (
    <Card
        title={
            <h2 className="row">
                <Crown size={17} /> Core team
            </h2>
        }
    >
        <div className="core-team">
            {team.map((membership, index) => (
                <div key={membership._id} className={`core-member ${membership.role === "PRESIDENT" ? "is-president" : ""}`} style={{ "--i": Math.min(index, 10) }}>
                    <Link to={`/people/${membership.user._id}`} className="core-member-who">
                        <Avatar name={membership.user.name} size="lg" />
                        <strong>
                            {membership.user.name}
                            {membership.user._id === me && <span className="subtle"> (you)</span>}
                        </strong>
                    </Link>
                    <RoleBadge role={membership.role} label={membership.roleName} />
                    <PhoneLink person={membership.user} />
                </div>
            ))}
        </div>
    </Card>
);

/**
 * Club → Members. "People": the core team, then everyone with search (officers add, remove and assign
 * roles here). "Roles & authority": each role, who holds it and what it can do. Members of any club,
 * mentors and the admin can see the people; roles stay inside the club.
 */
const ClubMembersTab = () => {
    const { club, reload: reloadClub } = useOutletContext();
    const { user } = useAuth();
    const toast = useToast();
    const viewer = club.viewer || {};
    const can = (permission) => viewer.permissions?.includes(permission);
    const canManage = can(PERMISSIONS.MANAGE_MEMBERS);
    const canAssign = can(PERMISSIONS.ASSIGN_ROLES);

    const insider = viewer.isMember || viewer.isMentor;
    const canSee = insider || Boolean(viewer.canSeeMembers);
    const [filters, setFilters] = useQueryState({ view: "people" });
    const view = insider && filters.view === "roles" ? "roles" : "people";
    const [search, setSearch] = useState("");
    const members = useApi(() => (canSee ? clubApi.members(club._id) : Promise.resolve({ data: [] })), [club._id, canSee]);
    const roles = useApi(() => (insider ? clubApi.roles(club._id) : Promise.resolve({ data: null })), [club._id, insider]);
    const [removing, setRemoving] = useState(null);

    const all = useMemo(() => members.data || [], [members.data]);
    const team = all.filter((membership) => membership.role !== "MEMBER");
    const shown = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return all;
        return all.filter((membership) =>
            [membership.user.name, membership.user.email, membership.user.departmentCode, membership.roleName].some((value) => String(value || "").toLowerCase().includes(term))
        );
    }, [all, search]);

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
            {insider && (
                <Segmented
                    label="Members view"
                    value={view}
                    onChange={(value) => setFilters({ view: value === "people" ? "" : value })}
                    options={[
                        {
                            value: "people",
                            label: (
                                <>
                                    <Users size={15} /> People{members.data ? ` · ${all.length}` : ""}
                                </>
                            )
                        },
                        {
                            value: "roles",
                            label: (
                                <>
                                    <ShieldCheck size={15} /> Roles & authority{roles.data ? ` · ${roles.data.roles.length}` : ""}
                                </>
                            )
                        }
                    ]}
                />
            )}

            {view === "roles" ? (
                roles.data && <ClubRolesCard club={club} roles={roles} members={all} onChanged={refresh} />
            ) : (
                <AsyncContent loading={members.loading} error={members.error} onRetry={members.reload}>
                    {team.length > 0 && <CoreTeam team={team} me={user._id} />}
                    <Card
                        title={`${all.length} ${all.length === 1 ? "member" : "members"}`}
                        padded={false}
                        actions={
                            <div className="members-tools">
                                {all.length > 6 && <SearchInput value={search} onChange={setSearch} placeholder="Search members" />}
                                {canManage && club.status === "ACTIVE" && (
                                    <UserPicker
                                        accountType="STUDENT"
                                        departments={scopeDepartments(club)}
                                        placeholder={club.allDepartments ? "Add a student directly" : `Add a ${departmentsLabel(club)} student`}
                                        onSelect={addMember}
                                        exclude={all.map((m) => m.user._id)}
                                    />
                                )}
                            </div>
                        }
                    >
                        {!all.length ? (
                            <EmptyState icon={Users} title="No members yet" />
                        ) : !shown.length ? (
                            <EmptyState icon={Users} title="No one matches" description="Try a name, department or role." />
                        ) : (
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
                                        {shown.map((membership) => (
                                            <tr key={membership._id}>
                                                <td>
                                                    <Link to={`/people/${membership.user._id}`} className="row member-who" style={{ flexWrap: "nowrap" }}>
                                                        <Avatar name={membership.user.name} size="sm" />
                                                        <span>
                                                            <strong>{membership.user.name}</strong>
                                                            {membership.user._id === user._id && <span className="subtle"> (you)</span>}
                                                            <span className="subtle member-email">{membership.user.email}</span>
                                                        </span>
                                                    </Link>
                                                </td>
                                                <td className="nowrap">
                                                    <PhoneLink person={membership.user} />
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
                        )}
                    </Card>
                </AsyncContent>
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
