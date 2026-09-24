import { Link } from "react-router-dom";
import { Award, CalendarDays, ChevronRight, ListOrdered, Trophy } from "lucide-react";
import { resultApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { useQueryState } from "../hooks/useQueryState";
import { useDebounce } from "../hooks/useDebounce";
import { AsyncContent, Avatar, EmptyState, PageHeader, Pagination, SearchInput, Segmented, Skeleton } from "../components/ui";
import { ResultStage } from "../components/results/ResultParts";
import { formatDate, plural, timeAgo } from "../lib/format";
import { CategoryArt } from "../components/events/EventCard";
import { categoryVars } from "../lib/eventVisuals";

// One card per event: poster, where the results stand, and a teaser of the winners.
const ResultCard = ({ card }) => {
    const { event } = card;
    const winner = card.winners[0];

    return (
        <Link to={`/results/${event._id}`} className="card card-link result-card">
            <div className="result-card-media" style={categoryVars(event.category)}>
                {event.poster ? (
                    <img src={event.poster} alt="" loading="lazy" />
                ) : (
                    <div className="result-card-placeholder">
                        <CategoryArt category={event.category} size={150} />
                        <span className="result-trophy">
                            <Trophy size={30} />
                        </span>
                    </div>
                )}
                <div className="result-card-stage">
                    <ResultStage final={card.final} latestRound={card.rounds.latest?.name} />
                </div>
            </div>
            <div className="result-card-body">
                <div className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
                    <Avatar name={event.club?.name} src={event.club?.logo} size="sm" square />
                    <span className="subtle result-card-club">{event.club?.name}</span>
                </div>
                <h3>{event.title}</h3>
                <span className="subtle row" style={{ gap: 6 }}>
                    <CalendarDays size={13} /> {formatDate(event.startAt)}
                </span>
                {winner ? (
                    <p className="result-card-winner">
                        <Trophy size={14} /> <strong>{winner.teamName || winner.recipientName || winner.recipientUser?.name}</strong>
                        <span className="subtle"> · {winner.title}</span>
                    </p>
                ) : (
                    <p className="result-card-winner muted">
                        <ListOrdered size={14} /> {plural(card.rounds.published, "round")} published · final results to come
                    </p>
                )}
                <div className="result-card-foot">
                    <span className="subtle">Updated {timeAgo(card.lastPublishedAt)}</span>
                    <span className="result-card-cta">
                        View results <ChevronRight size={15} />
                    </span>
                </div>
            </div>
        </Link>
    );
};

const ResultsPage = () => {
    const [filters, setFilters] = useQueryState({ stage: "all", search: "", page: "1" });
    const search = useDebounce(filters.search, 300);
    const { data, meta, loading, error, reload } = useApi(
        () => resultApi.list({ stage: filters.stage === "all" ? undefined : filters.stage, search: search || undefined, page: filters.page, limit: 12 }),
        [filters.stage, search, filters.page]
    );
    const counts = meta?.counts;

    return (
        <>
            <PageHeader
                eyebrow={<><Award size={14} /> Results</>}
                title="Results & winners"
                description="Round-by-round standings and final results published by clubs. Pick an event to see its results."
            />
            <div className="stack">
                <div className="filter-bar">
                    <Segmented
                        label="Result stage"
                        value={filters.stage}
                        onChange={(stage) => setFilters({ stage, page: "1" })}
                        options={[
                            { value: "all", label: `All${counts ? ` (${counts.all})` : ""}` },
                            { value: "live", label: `Live rounds${counts ? ` (${counts.live})` : ""}` },
                            { value: "final", label: `Final${counts ? ` (${counts.final})` : ""}` }
                        ]}
                    />
                    <SearchInput value={filters.search} onChange={(value) => setFilters({ search: value, page: "1" })} placeholder="Search events…" />
                </div>
                <AsyncContent
                    loading={loading}
                    error={error}
                    onRetry={reload}
                    isEmpty={!data?.length}
                    skeleton={
                        <div className="result-grid">
                            {[1, 2, 3, 4, 5, 6].map((key) => (
                                <Skeleton key={key} height={320} style={{ borderRadius: 14 }} />
                            ))}
                        </div>
                    }
                    empty={
                        <EmptyState
                            icon={Award}
                            title={filters.search ? "No events match your search" : filters.stage === "live" ? "No rounds in progress" : "No results published yet"}
                            description="Clubs publish round standings during their events and final results at the end."
                        />
                    }
                >
                    <div className="result-grid">
                        {data?.map((card) => (
                            <ResultCard key={card._id} card={card} />
                        ))}
                    </div>
                    <div style={{ marginTop: 16 }}>
                        <Pagination meta={meta} onPage={(page) => setFilters({ page })} />
                    </div>
                </AsyncContent>
            </div>
        </>
    );
};

export default ResultsPage;
