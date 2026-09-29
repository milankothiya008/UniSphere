import { Link, useOutletContext } from "react-router-dom";
import { ChevronRight, Megaphone, Plus } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { AsyncContent, ButtonLink, Card, EmptyState } from "../../components/ui";
import { Deadline, PhaseBadge, PositionChips } from "../../components/recruitment/RecruitmentParts";
import { formatDate, plural } from "../../lib/format";

const LIVE = ["UPCOMING", "OPEN", "CLOSED", "ROUNDS"];

/** Club page → Recruitment: the drive in progress, past drives, and "New drive" for the president. */
const ClubRecruitmentTab = () => {
    const { club } = useOutletContext();
    const { data, loading, error, reload } = useApi(() => recruitmentApi.forClub(club._id), [club._id]);
    const items = data?.items || [];
    const current = items.find((item) => LIVE.includes(item.phase) || ["DRAFT", "PENDING_APPROVAL", "NEEDS_CHANGES", "APPROVED"].includes(item.phase));
    const past = items.filter((item) => item !== current);

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            <div className="stack-lg">
                {data?.canCreate && (
                    <div className="recruit-cta-card">
                        <div>
                            <strong>Looking for new members?</strong>
                            <span className="subtle">Pick the roles you need, build a page-by-page form for each, get it approved by your faculty mentor — and every eligible student is invited to apply.</span>
                        </div>
                        <ButtonLink to={`/clubs/${club._id}/recruitment/new`} variant="accent">
                            <Plus size={16} /> New recruitment drive
                        </ButtonLink>
                    </div>
                )}

                {current ? (
                    <Link to={`/recruitment/${current._id}`} className={`card card-link recruit-current is-${current.phase.toLowerCase()}`}>
                        <div className="recruit-current-head">
                            <span className="recruit-eyebrow">
                                <Megaphone size={14} /> {current.phase === "OPEN" ? "Recruiting now" : "Recruitment"}
                            </span>
                            <PhaseBadge phase={current.phase} />
                        </div>
                        <h2>{current.title}</h2>
                        <PositionChips positions={current.positions} />
                        <div className="recruit-current-foot">
                            {LIVE.includes(current.phase) ? <Deadline drive={current} /> : <span className="subtle small">Draft · not visible to students yet</span>}
                            {current.counts && <span className="subtle small">{plural(current.counts.total, "application")}</span>}
                            <span className="result-card-cta">
                                {current.phase === "OPEN" && !current.counts ? "Apply" : "Open"} <ChevronRight size={15} />
                            </span>
                        </div>
                    </Link>
                ) : (
                    !data?.canCreate && (
                        <Card>
                            <EmptyState icon={Megaphone} title="Not recruiting right now" description={`Turn on ${club.name}'s bell to hear as soon as they open applications.`} />
                        </Card>
                    )
                )}

                {past.length > 0 && (
                    <Card title="Past recruitment" padded={false}>
                        <ul className="recruit-past">
                            {past.map((item) => (
                                <li key={item._id}>
                                    <Link to={`/recruitment/${item._id}`} className="recruit-past-row">
                                        <span className="grow">
                                            <strong>{item.title}</strong>
                                            <span className="subtle small">
                                                {item.positions.join(", ")} · {formatDate(item.completedAt || item.applicationEnd)}
                                                {item.counts ? ` · ${plural(item.counts.accepted, "student")} joined` : ""}
                                            </span>
                                        </span>
                                        <PhaseBadge phase={item.phase} />
                                        <ChevronRight size={16} className="subtle" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </Card>
                )}
            </div>
        </AsyncContent>
    );
};

export default ClubRecruitmentTab;
