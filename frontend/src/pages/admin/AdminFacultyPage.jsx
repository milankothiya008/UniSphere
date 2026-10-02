import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { adminApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useDebounce } from "../../hooks/useDebounce";
import { AsyncContent, Avatar, Card, EmptyState, PageHeader, SearchInput, StatusBadge } from "../../components/ui";

const AdminFacultyPage = () => {
    const [search, setSearch] = useState("");
    const debounced = useDebounce(search, 350);
    const { data, loading, error, reload } = useApi(() => adminApi.faculty({ search: debounced }), [debounced]);

    return (
        <>
            <PageHeader
                title="Faculty & mentors"
            />
            <div className="stack">
                <div className="filter-bar">
                    <SearchInput value={search} onChange={setSearch} placeholder="Search faculty" />
                </div>
                <Card padded={false}>
                    <AsyncContent loading={loading} error={error} onRetry={reload} isEmpty={!data?.length} empty={<EmptyState icon={GraduationCap} title="No faculty found" />}>
                        <div className="table-wrap">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Faculty</th>
                                        <th>Department</th>
                                        <th>Mentored clubs</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data?.map((faculty) => (
                                        <tr key={faculty._id}>
                                            <td>
                                                <div className="row" style={{ flexWrap: "nowrap" }}>
                                                    <Avatar name={faculty.name} src={faculty.avatar} size="sm" />
                                                    <div>
                                                        <strong>{faculty.name}</strong>
                                                        <div className="subtle">{faculty.email}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td>{faculty.departmentCode}</td>
                                            <td>
                                                {faculty.mentoredClubs.length === 0 ? (
                                                    <span className="subtle">None</span>
                                                ) : (
                                                    <div className="row" style={{ gap: 6 }}>
                                                        {faculty.mentoredClubs.map((club) => (
                                                            <Link key={club._id} to={`/clubs/${club._id}`} className="chip" style={{ textDecoration: "none", paddingRight: 10 }}>
                                                                {club.name} <StatusBadge status={club.status} dot={false} />
                                                            </Link>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </AsyncContent>
                </Card>
            </div>
        </>
    );
};

export default AdminFacultyPage;
