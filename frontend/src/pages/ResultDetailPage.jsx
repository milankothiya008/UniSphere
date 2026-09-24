import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Award, CalendarDays, ChevronRight, Hourglass, ListOrdered, Pencil, Trophy } from "lucide-react";
import { eventApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { AsyncContent, Avatar, Badge, Card, EmptyState, PageHeader } from "../components/ui";
import { ResultStage, Standings, WinnersPodium } from "../components/results/ResultParts";
import { formatDate, formatDateTime, timeAgo } from "../lib/format";

const Corrected = ({ at }) =>
    at ? (
        <span className="subtle" title={formatDateTime(at)}>
            · Updated {timeAgo(at)}
        </span>
    ) : null;

// Rounds in the order they happened; the latest published round is opened by default.
const RoundsSection = ({ rounds }) => {
    const ordered = useMemo(() => [...rounds], [rounds]);
    const latestId = useMemo(() => {
        const published = ordered.filter((round) => round.status === "PUBLISHED").sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
        return (published[0] || ordered[ordered.length - 1])?._id;
    }, [ordered]);
    const [selected, setSelected] = useState(latestId);

    useEffect(() => setSelected(latestId), [latestId]);

    const round = ordered.find((item) => item._id === selected) || ordered[0];

    return (
        <Card title={<h2 className="row"><ListOrdered size={18} /> Rounds</h2>}>
            <div className="stack">
                <div className="round-steps" role="tablist" aria-label="Rounds">
                    {ordered.map((item, index) => (
                        <button
                            key={item._id}
                            type="button"
                            role="tab"
                            aria-selected={item._id === round._id}
                            className={`round-step ${item._id === round._id ? "active" : ""} ${item.status === "DRAFT" ? "draft" : ""}`}
                            onClick={() => setSelected(item._id)}
                        >
                            <span className="round-step-index">{index + 1}</span>
                            <span className="round-step-text">
                                <strong>{item.name}</strong>
                                <small>{item.status === "DRAFT" ? "Draft · not public" : `Published ${timeAgo(item.publishedAt)}`}</small>
                            </span>
                        </button>
                    ))}
                </div>
                <div className="stack-sm">
                    <div className="row-between">
                        <h3 style={{ margin: 0 }}>{round.name}</h3>
                        <span className="small">
                            {round.status === "DRAFT" ? <Badge tone="warning">Draft · not public</Badge> : <span className="subtle">{formatDateTime(round.publishedAt)}</span>}
                            <Corrected at={round.correctedAt} />
                        </span>
                    </div>
                    {round.description && <p className="muted pre-line" style={{ margin: 0 }}>{round.description}</p>}
                </div>
                <Standings entries={round.entries} />
            </div>
        </Card>
    );
};

const ResultDetailPage = () => {
    const { eventId } = useParams();
    const results = useApi(() => eventApi.result(eventId), [eventId]);
    const eventState = useApi(() => eventApi.get(eventId), [eventId]);

    const result = results.data;
    const event = eventState.data || result?.event;
    const final = result?.status === "PUBLISHED";
    const finalDraft = !final && result?.viewer?.canSeeDrafts && result?.summary;
    const latestRound = result?.rounds?.filter((round) => round.status === "PUBLISHED").sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];

    const notPublished = results.error?.status === 404;

    return (
        <AsyncContent loading={results.loading || eventState.loading} error={notPublished ? null : results.error || eventState.error} onRetry={results.reload}>
            {notPublished ? (
                <>
                    <PageHeader back={{ to: "/results", label: "All results" }} eyebrow={<><Trophy size={14} /> Results</>} title={event?.title || "Results"} />
                    <EmptyState
                        icon={Hourglass}
                        title="No results yet"
                        description="This event hasn't published any results. You'll be notified when they're out."
                        action={
                            <Link to={`/events/${eventId}`} className="btn btn-secondary btn-sm">
                                View event
                            </Link>
                        }
                    />
                </>
            ) : (
                result &&
                event && (
                    <>
                        <PageHeader
                            back={{ to: "/results", label: "All results" }}
                            eyebrow={
                                <Link to={`/clubs/${event.club?._id}`} className="row" style={{ gap: 6 }}>
                                    <Avatar name={event.club?.name} src={event.club?.logo} size="sm" square /> {event.club?.name}
                                </Link>
                            }
                            title={event.title}
                            description={
                                <span className="row" style={{ gap: 10 }}>
                                    <span className="row" style={{ gap: 6 }}>
                                        <CalendarDays size={14} /> {formatDate(event.startAt)}
                                    </span>
                                    <ResultStage final={final} latestRound={latestRound?.name} />
                                </span>
                            }
                            actions={
                                <>
                                    {result.viewer?.canEdit && (
                                        <Link to={`/events/${eventId}/results/edit`} className="btn btn-secondary">
                                            <Pencil size={15} /> Manage results
                                        </Link>
                                    )}
                                    <Link to={`/events/${eventId}`} className="btn btn-secondary">
                                        Event details <ChevronRight size={15} />
                                    </Link>
                                </>
                            }
                        />

                        <div className="stack-lg" style={{ maxWidth: 980 }}>
                            {final || finalDraft ? (
                                <Card
                                    className="final-results-card"
                                    title={<h2 className="row"><Trophy size={18} color="var(--gold-600)" /> Final results</h2>}
                                    actions={
                                        final ? (
                                            <span className="small subtle">
                                                Published {formatDateTime(result.publishedAt)}
                                                <Corrected at={result.correctedAt} />
                                            </span>
                                        ) : (
                                            <Badge tone="warning">Draft · not public</Badge>
                                        )
                                    }
                                >
                                    <div className="stack-lg">
                                        {result.awards.length > 0 && <WinnersPodium awards={result.awards} />}
                                        {result.summary && <p className="pre-line" style={{ margin: 0 }}>{result.summary}</p>}
                                    </div>
                                </Card>
                            ) : (
                                <div className="results-pending">
                                    <Award size={22} />
                                    <div>
                                        <strong>Final results are still to come</strong>
                                        <p className="muted" style={{ margin: 0 }}>
                                            {latestRound ? `${latestRound.name} results are out below.` : "Round results are below."} Participants are notified when the winners are announced.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {result.rounds.length > 0 && <RoundsSection rounds={result.rounds} />}
                        </div>
                    </>
                )
            )}
        </AsyncContent>
    );
};

export default ResultDetailPage;
