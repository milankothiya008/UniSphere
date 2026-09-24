import { useEffect, useState } from "react";
import { UserCheck, UserX, Users } from "lucide-react";
import { userApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, Pagination, SearchInput } from "../../components/ui";
import { ROLE_LABELS } from "../../lib/constants";
import { batchLabel, formatDate } from "../../lib/format";

const AdminUsersPage = () => {
    const { user: me } = useAuth();
    const toast = useToast();
    const [filters, setFilters] = useQueryState({ search: "", role: "", active: "", page: "1" });
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search, 350);
    const [target, setTarget] = useState(null);

    useEffect(() => {
        if (debounced !== filters.search) {
            setFilters({ search: debounced });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    const { data, meta, loading, error, reload, setData } = useApi(
        () => userApi.list({ search: filters.search, role: filters.role, active: filters.active, page: filters.page, limit: 20 }),
        [filters.search, filters.role, filters.active, filters.page]
    );

    const toggle = async () => {
        const response = await userApi.setStatus(target._id, !target.isActive);
        setData((list) => list.map((u) => (u._id === target._id ? response.data : u)));
        toast.success(response.data.isActive ? `${target.name} reactivated` : `${target.name} deactivated`);
    };

    return (
        <>
            <PageHeader eyebrow={<><Users size={14} /> Administration</>} title="Users" description="Everyone registered on CampusConnect." />
            <div className="stack">
                <div className="filter-bar">
                    <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" />
                    <select className="select" value={filters.role} onChange={(e) => setFilters({ role: e.target.value })} aria-label="Role">
                        <option value="">All roles</option>
                        {Object.entries(ROLE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <select className="select" value={filters.active} onChange={(e) => setFilters({ active: e.target.value })} aria-label="Status">
                        <option value="">Any status</option>
                        <option value="true">Active</option>
                        <option value="false">Deactivated</option>
                    </select>
                </div>
                <Card padded={false}>
                    <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={Users} title="No users match" />}>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Role</th>
                                        <th>Department</th>
                                        <th>Status</th>
                                        <th>Joined</th>
                                        <th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.map((user) => (
                                        <tr key={user._id}>
                                            <td>
                                                <div className="row" style={{ flexWrap: "nowrap" }}>
                                                    <Avatar name={user.name} size="sm" />
                                                    <div>
                                                        <strong>{user.name}</strong>
                                                        <div className="subtle">{user.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>
                                                <Badge tone={user.globalRole === "ADMIN" ? "gold" : user.globalRole === "FACULTY" ? "ink" : "neutral"}>{ROLE_LABELS[user.globalRole]}</Badge>
                                            </td>
                                            <td className="nowrap">
                                                {user.departmentCode || "—"}
                                                {user.batchCode ? ` · ${batchLabel(user.batchCode)}` : ""}
                                            </td>
                                            <td>
                                                {!user.isActive ? (
                                                    <Badge tone="danger" dot>Deactivated</Badge>
                                                ) : user.isEmailVerified ? (
                                                    <Badge tone="success" dot>Active</Badge>
                                                ) : (
                                                    <Badge tone="warning" dot>Unverified</Badge>
                                                )}
                                            </td>
                                            <td className="subtle nowrap">{formatDate(user.createdAt)}</td>
                                            <td className="actions">
                                                {user._id !== me._id && (
                                                    <Button size="sm" variant={user.isActive ? "ghost" : "secondary"} onClick={() => setTarget(user)}>
                                                        {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                                                        {user.isActive ? "Deactivate" : "Reactivate"}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </AsyncContent>
                </Card>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </div>
            <ConfirmDialog
                open={Boolean(target)}
                onClose={() => setTarget(null)}
                onConfirm={toggle}
                title={target?.isActive ? `Deactivate ${target?.name}?` : `Reactivate ${target?.name}?`}
                description={target?.isActive ? "They are signed out everywhere and cannot sign in until reactivated." : "They will be able to sign in again."}
                confirmLabel={target?.isActive ? "Deactivate" : "Reactivate"}
                variant={target?.isActive ? "danger" : "primary"}
            />
        </>
    );
};

export default AdminUsersPage;
