import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2 } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useDebounce } from "../../hooks/useDebounce";
import { AsyncContent, Avatar, Card, EmptyState, PageHeader, Pagination, SearchInput, StatusBadge, Tabs } from "../../components/ui";
import { departmentsLabel, formatDate, humanize } from "../../lib/format";

const STATUSES = [
    { value: "ALL", label: "All" },
    { value: "ACTIVE", label: "Active" },
    { value: "APPROVED", label: "Awaiting president" },
    { value: "SUSPENDED", label: "Suspended" },
    { value: "ARCHIVED", label: "Archived" }
];

const AdminClubsPage = () => {
    const [filters, setFilters] = useQueryState({ status: "ALL", search: "", page: "1" });
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search, 350);

    useEffect(() => {
        if (debounced !== filters.search) {
            setFilters({ search: debounced });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    const { data, meta, loading, error, reload } = useApi(
        () => clubApi.list({ status: filters.status, search: filters.search, page: filters.page, limit: 20 }),
        [filters.status, filters.search, filters.page]
    );

    return (
        <>
            <PageHeader eyebrow={<><Building2 size={14} /> Administration</>} title="All clubs" description="Every club, including those awaiting a president, suspended or archived." />
            <div className="stack">
                <Tabs tabs={STATUSES} value={filters.status} onChange={(status) => setFilters({ status })} />
                <div className="filter-bar">
                    <SearchInput value={search} onChange={setSearch} placeholder="Search clubs" />
                </div>
                <Card padded={false}>
                    <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={Building2} title="No clubs" />}>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Club</th>
                                        <th>Mentor</th>
                                        <th>President</th>
                                        <th>Members</th>
                                        <th>Status</th>
                                        <th>Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.map((club) => (
                                        <tr key={club._id}>
                                            <td>
                                                <Link to={`/clubs/${club._id}`} className="row" style={{ flexWrap: "nowrap", color: "inherit" }}>
                                                    <Avatar name={club.name} src={club.logo} size="sm" square />
                                                    <span>
                                                        <strong>{club.name}</strong>
                                                        <div className="subtle">
                                                            {humanize(club.category)} · {departmentsLabel(club)}
                                                        </div>
                                                    </span>
                                                </Link>
                                            </td>
                                            <td>{club.mentor?.name || <span className="subtle">—</span>}</td>
                                            <td>{club.president?.name || <span className="subtle">Not appointed</span>}</td>
                                            <td>{club.memberCount}</td>
                                            <td>
                                                <StatusBadge status={club.status} />
                                            </td>
                                            <td className="subtle nowrap">{formatDate(club.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </AsyncContent>
                </Card>
                <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
            </div>
        </>
    );
};

export default AdminClubsPage;
