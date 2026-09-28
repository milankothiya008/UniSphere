import { useEffect, useState } from "react";
import { Building2, Lightbulb } from "lucide-react";
import { clubApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useQueryState } from "../../hooks/useQueryState";
import { useDebounce } from "../../hooks/useDebounce";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { ClubCard } from "../../components/clubs/ClubCard";
import { AsyncContent, ButtonLink, CardGridSkeleton, EmptyState, PageHeader, Pagination, SearchInput, Segmented } from "../../components/ui";
import { CLUB_CATEGORIES } from "../../lib/constants";
import { humanize } from "../../lib/format";

const ClubsPage = () => {
    const { isStudent, isAdmin } = useAuth();
    const { myClubs, reference } = useWorkspace();
    const [filters, setFilters] = useQueryState({ view: "all", search: "", category: "", department: "", page: "1" });
    // The university admin never belongs to or mentors a club, so there is no "My clubs" view for them.
    const view = isAdmin ? "all" : filters.view;
    const [search, setSearch] = useState(filters.search);
    const debounced = useDebounce(search, 350);

    useEffect(() => {
        if (debounced !== filters.search) {
            setFilters({ search: debounced });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debounced]);

    const { data, meta, loading, error, reload } = useApi(
        () => clubApi.list({ search: filters.search, category: filters.category, department: filters.department, page: filters.page, limit: 12 }),
        [filters.search, filters.category, filters.department, filters.page],
        { enabled: view === "all" }
    );

    const roleFor = (clubId) => myClubs.memberships.find((m) => m.club._id === clubId && m.status === "APPROVED")?.role;
    const mine = [
        ...myClubs.memberships.map((m) => ({ club: m.club, role: m.role })),
        ...myClubs.mentored.map((club) => ({ club, role: null, mentor: true }))
    ];

    return (
        <>
            <PageHeader
                eyebrow={<><Building2 size={14} /> Clubs</>}
                title="Clubs on campus"
                description={isAdmin ? "All active clubs on campus. Manage club status and mentors from All clubs in Administration." : "Find your people — join clubs to take part in their events and activities."}
                actions={
                    isStudent && (
                        <ButtonLink to="/club-requests/new" variant="secondary">
                            <Lightbulb size={16} /> Propose a new club
                        </ButtonLink>
                    )
                }
            />
            <div className="stack">
                {!isAdmin && (
                    <div className="row-between">
                        <Segmented
                            label="Club view"
                            value={view}
                            onChange={(next) => setFilters({ view: next })}
                            options={[
                                { value: "all", label: "All clubs" },
                                { value: "mine", label: `My clubs (${mine.length})` }
                            ]}
                        />
                    </div>
                )}

                {view === "all" ? (
                    <>
                        <div className="filter-bar">
                            <SearchInput value={search} onChange={setSearch} placeholder="Search clubs" />
                            <select className="select" value={filters.category} onChange={(e) => setFilters({ category: e.target.value })} aria-label="Category">
                                <option value="">All categories</option>
                                {CLUB_CATEGORIES.map((category) => (
                                    <option key={category} value={category}>
                                        {humanize(category)}
                                    </option>
                                ))}
                            </select>
                            <select className="select" value={filters.department} onChange={(e) => setFilters({ department: e.target.value })} aria-label="Department">
                                <option value="">All departments</option>
                                {reference.departments.map((department) => (
                                    <option key={department._id} value={department.code}>
                                        {department.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <AsyncContent
                            loading={loading}
                            error={error}
                            onRetry={reload}
                            isEmpty={!data?.length}
                            skeleton={<CardGridSkeleton height={190} />}
                            empty={<EmptyState icon={Building2} title="No clubs found" description="Try a different search, or propose a new club." />}
                        >
                            <div className="grid-cards">
                                {data?.map((club) => (
                                    <ClubCard key={club._id} club={club} role={roleFor(club._id)} />
                                ))}
                            </div>
                            <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
                        </AsyncContent>
                    </>
                ) : mine.length === 0 ? (
                    <EmptyState icon={Building2} title="You haven't joined any clubs" description="Browse clubs and apply when they open recruitment." />
                ) : (
                    <div className="grid-cards">
                        {mine.map(({ club, role, mentor }) => (
                            <div key={club._id} style={{ position: "relative" }}>
                                <ClubCard club={club} role={role} showStatus={!role} />
                                {mentor && (
                                    <span className="badge badge-warning" style={{ position: "absolute", top: 12, right: 12 }}>
                                        Faculty mentor
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};

export default ClubsPage;
