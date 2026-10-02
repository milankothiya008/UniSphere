import { useParams, Link } from "react-router-dom";
import { Check, AlertTriangle, CalendarDays, ChevronRight, Clock, Hourglass, Images, Mail, MapPin, Megaphone, Phone, ShieldCheck, Trophy, User, Users } from "lucide-react";
import { eventApi, feedApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { Alert, AsyncContent, Badge, ButtonLink, Card, PageHeader, StatusBadge, ZoomableMedia } from "../../components/ui";
import { EventActions } from "../../components/events/EventActions";
import { EventChanges } from "../../components/events/EventChanges";
import { RegistrationPanel } from "../../components/events/RegistrationPanel";
import { ScheduleCheck } from "../../components/events/ScheduleCheck";
import { CertificatesCard, FeedbackCard, HackathonSummary } from "../../components/events/EventExtras";
import { Podium } from "../../components/feed/FeedCard";
import { CategoryArt } from "../../components/events/EventCard";
import { categoryVars } from "../../lib/eventVisuals";
import { batchLabel, formatDateTime, formatEventDates, formatEventTimes, humanize, timeAgo, toDateInput } from "../../lib/format";

const WORKFLOW = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "COMPLETED"];
const WORKFLOW_LABELS = ["Draft", "Mentor review", "Approved", "Published", "Completed"];

const Workflow = ({ status }) => {
    const index = WORKFLOW.indexOf(status === "NEEDS_CHANGES" ? "DRAFT" : status);
    if (index === -1) {
        return null;
    }
    return (
        <ol className="workflow" aria-label="Event progress">
            {WORKFLOW_LABELS.map((label, i) => (
                <li key={label} className={`step ${i < index ? "done" : i === index ? "current" : ""}`} aria-current={i === index ? "step" : undefined}>
                    <span className="step-dot">{i < index ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                    <span className="step-label">{label}</span>
                </li>
            ))}
        </ol>
    );
};

// Before an event goes live, its club and the reviewing mentor see what else is on at that time.
const showsSchedule = (event) =>
    (event.viewer?.canManage || event.viewer?.canReview) && ["DRAFT", "NEEDS_CHANGES", "PENDING_APPROVAL", "APPROVED"].includes(event.status) && new Date(event.startAt) > new Date();

// Organiser updates and cancellation notices for this event (everyone is also notified when they're posted).
const UpdatesSection = ({ event }) => {
    const { data } = useApi(() => feedApi.list({ event: event._id, types: "EVENT_UPDATE", limit: 20 }), [event._id, event.updatedAt], {
        enabled: ["PUBLISHED", "COMPLETED", "CANCELLED"].includes(event.status)
    });

    if (!data?.length) {
        return null;
    }

    return (
        <Card title={<h2 className="row"><Megaphone size={18} /> Updates from the organisers</h2>}>
            <ul className="timeline">
                {data.map((update) => (
                    <li key={update._id}>
                        <span className="timeline-dot" />
                        <div>
                            <strong>{update.title}</strong>
                            <span className="subtle"> · {timeAgo(update.createdAt)}</span>
                            {update.body && <p className="small muted pre-line">{update.body}</p>}
                        </div>
                    </li>
                ))}
            </ul>
        </Card>
    );
};

// A preview of the results; the full standings live on /results/:id.
const ResultsSection = ({ event }) => {
    const canManage = event.viewer?.canManageResults;
    const open = ["PUBLISHED", "COMPLETED"].includes(event.status);
    const { data: result, loading, error } = useApi(() => eventApi.result(event._id), [event._id, event.status], { enabled: open });

    if (!open || loading) {
        return null;
    }

    if (error || !result) {
        return canManage ? (
            <Card title={<h2 className="row"><Trophy size={18} color="var(--gold-600)" /> Results</h2>}>
                <p className="subtle" style={{ margin: 0 }}>
                    No results yet. <Link to={`/events/${event._id}/results/edit`}>Add round standings or final results</Link> to share them with the campus.
                </p>
            </Card>
        ) : null;
    }

    const final = result.status === "PUBLISHED";
    const published = result.rounds.filter((round) => round.status === "PUBLISHED");
    const latest = [...published].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];

    return (
        <Card
            title={<h2 className="row"><Trophy size={18} color="var(--gold-600)" /> Results</h2>}
            actions={
                <div className="row">
                    {canManage && (
                        <Link to={`/events/${event._id}/results/edit`} className="btn btn-ghost btn-sm">
                            Manage
                        </Link>
                    )}
                    <Link to={`/results/${event._id}`} className="btn btn-secondary btn-sm">
                        Full results
                    </Link>
                </div>
            }
        >
            <div className="stack">
                {final ? (
                    <>
                        {result.awards.length > 0 && <Podium awards={result.awards} limit={3} />}
                        <p className="pre-line muted" style={{ margin: 0 }}>{result.summary}</p>
                    </>
                ) : (
                    <p style={{ margin: 0 }}>
                        {latest ? (
                            <>
                                <strong>{latest.name}</strong> results are out
                                <span className="subtle"> · {timeAgo(latest.publishedAt)}</span>. Final results are still to come.
                            </>
                        ) : (
                            <span className="subtle">Only drafts so far — nothing is public yet.</span>
                        )}
                    </p>
                )}
                {published.length > 0 && <span className="subtle small">{published.length === 1 ? "1 round published" : `${published.length} rounds published`}</span>}
            </div>
        </Card>
    );
};

const EventDetailPage = () => {
    const { id } = useParams();
    const { data: event, loading, error, reload, setData } = useApi(() => eventApi.get(id), [id]);

    return (
        <AsyncContent loading={loading} error={error} onRetry={reload}>
            {event && (
                <>
                    <PageHeader
                        back={{ to: "/feed", label: "Home" }}
                        club={event.club}
                        title={event.title}
                        actions={
                            <>
                                <Badge tone="ink">{humanize(event.category)}</Badge>
                                <StatusBadge status={event.status} />
                            </>
                        }
                    />

                    <div className="detail-layout aside-first-mobile">
                        <div className="stack-lg">
                            {event.poster ? (
                                <ZoomableMedia src={event.poster} alt={`${event.title} poster`} caption={event.title} className="poster" />
                            ) : (
                                <div className="poster poster-fallback" aria-hidden="true" style={categoryVars(event.category)}>
                                    <CategoryArt category={event.category} />
                                    <span>{humanize(event.category)}</span>
                                    <strong>{event.title}</strong>
                                    <span>{event.club.name}</span>
                                </div>
                            )}

                            {(event.viewer?.canManage || event.viewer?.isMentor) && <Workflow status={event.status} />}

                            {event.status === "NEEDS_CHANGES" && event.reviewComment && (
                                <Alert type="warning" title={`Changes requested by ${event.reviewedBy?.name || "your mentor"}`}>
                                    {event.reviewComment}
                                </Alert>
                            )}
                            {event.status === "REJECTED" && (
                                <Alert type="error" title="Rejected by the faculty mentor">
                                    {event.reviewComment}
                                </Alert>
                            )}
                            {event.status === "APPROVED" && (
                                <Alert type="info" title="Approved — not yet public">
                                    {event.reviewComment ? `Mentor note: ${event.reviewComment}. ` : ""}Publish the event to open registration and post it to the feed.
                                </Alert>
                            )}
                            {event.status === "PENDING_APPROVAL" && !event.viewer?.canReview && (
                                <Alert type="info" title="Waiting for mentor approval">
                                    Submitted {formatDateTime(event.submittedAt)}. You'll be notified when it's reviewed.
                                </Alert>
                            )}
                            {event.onHold && event.status === "PUBLISHED" && (
                                <Alert type="warning" title="This event is on hold">
                                    {event.club.name} has been {String(event.club.status).toLowerCase()} by the university. Registrations are kept but closed; if the club is reactivated before the event, it goes ahead and registered students are emailed.
                                </Alert>
                            )}
                            {event.status === "CANCELLED" && (
                                <Alert type="error" title="This event was cancelled">
                                    {event.cancellationReason}
                                </Alert>
                            )}

                            {showsSchedule(event) && (
                                <ScheduleCheck
                                    dateKey={toDateInput(event.startAt)}
                                    endDate={event.endDate ? toDateInput(event.endAt) : null}
                                    startTime={event.startTime}
                                    endTime={event.endTime}
                                    audience={event.eligibility?.departments?.length ? event.eligibility.departments : "ALL"}
                                    excludeId={event._id}
                                    title={event.viewer?.canReview ? "Other events at this time" : "Campus schedule that day"}
                                    reviewer={Boolean(event.viewer?.canReview)}
                                />
                            )}

                            <EventChanges event={event} onChange={(updated) => setData(updated)} />

                            <Card title="About this event">
                                <p className="prose">{event.description}</p>
                            </Card>

                            {event.rules && (
                                <Card title="Rules & guidelines">
                                    <p className="prose">{event.rules}</p>
                                </Card>
                            )}

                            <HackathonSummary event={event} />
                            <ResultsSection event={event} />
                            <FeedbackCard event={event} />
                            <UpdatesSection event={event} />
                        </div>

                        <aside className="stack">
                            <Card>
                                <dl className="meta-list">
                                    <div>
                                        <CalendarDays size={18} />
                                        <span>
                                            <dt>{event.endDate ? "Dates" : "Date"}</dt>
                                            <dd>{formatEventDates(event.startAt, event.endAt)}</dd>
                                        </span>
                                    </div>
                                    <div>
                                        <Clock size={18} />
                                        <span>
                                            <dt>Time</dt>
                                            <dd>{formatEventTimes(event.startAt, event.endAt)}</dd>
                                        </span>
                                    </div>
                                    <div>
                                        <MapPin size={18} />
                                        <span>
                                            <dt>Venue</dt>
                                            <dd>
                                                {event.venue?.name}
                                                <span className="subtle" style={{ display: "block" }}>
                                                    {event.venue?.location}
                                                </span>
                                            </dd>
                                        </span>
                                    </div>
                                    <div>
                                        <Hourglass size={18} />
                                        <span>
                                            <dt>Registration deadline</dt>
                                            <dd>{formatDateTime(event.registrationEnd)}</dd>
                                        </span>
                                    </div>
                                    <div>
                                        <Users size={18} />
                                        <span>
                                            <dt>{event.participationMode === "TEAM" ? "Teams" : "Capacity"}</dt>
                                            <dd>
                                                {event.participationMode === "TEAM"
                                                    ? `${event.maxParticipants ? `Up to ${event.maxParticipants} teams` : "No team limit"} · ${event.minTeamSize === event.maxTeamSize ? event.maxTeamSize : `${event.minTeamSize}–${event.maxTeamSize}`} members each`
                                                    : event.maxParticipants
                                                      ? `${event.maxParticipants} participants`
                                                      : "No limit"}
                                            </dd>
                                        </span>
                                    </div>
                                    <div>
                                        <ShieldCheck size={18} />
                                        <span>
                                            <dt>Eligibility</dt>
                                            <dd>
                                                {event.eligibility?.departments?.length ? event.eligibility.departments.join(", ") : "All departments"}
                                                {" · "}
                                                {event.eligibility?.batches?.length ? event.eligibility.batches.map((b) => `Batch ${batchLabel(b)}`).join(", ") : "All batches"}
                                                {event.eligibility?.notes && (
                                                    <span className="subtle" style={{ display: "block" }}>
                                                        {event.eligibility.notes}
                                                    </span>
                                                )}
                                            </dd>
                                        </span>
                                    </div>
                                </dl>
                            </Card>

                            <RegistrationPanel event={event} onChange={() => reload({ silent: true })} />
                            {["PUBLISHED", "COMPLETED"].includes(event.status) && (
                                <ButtonLink to={`/gallery/${event._id}`} variant="secondary" size="lg" block className="gallery-link">
                                    <Images size={17} /> Photo gallery
                                    {event.galleryCount > 0 && <span className="gallery-count">{event.galleryCount}</span>}
                                    <ChevronRight size={16} className="gallery-link-go" />
                                </ButtonLink>
                            )}
                            <EventActions event={event} onChange={(updated) => setData(updated)} />
                            <CertificatesCard event={event} onChange={(updated) => setData(updated)} />

                            {(event.contact?.name || event.contact?.email || event.contact?.phone || event.organizer) && (
                                <Card title="Contact">
                                    <dl className="meta-list">
                                        {(event.contact?.name || event.organizer) && (
                                            <div>
                                                <User size={16} />
                                                <dd>{event.contact?.name || event.organizer?.name}</dd>
                                            </div>
                                        )}
                                        {(event.contact?.email || event.organizer?.email) && (
                                            <div>
                                                <Mail size={16} />
                                                <dd>
                                                    <a href={`mailto:${event.contact?.email || event.organizer.email}`}>{event.contact?.email || event.organizer.email}</a>
                                                </dd>
                                            </div>
                                        )}
                                        {event.contact?.phone && (
                                            <div>
                                                <Phone size={16} />
                                                <dd>
                                                    <a href={`tel:${event.contact.phone}`}>{event.contact.phone}</a>
                                                </dd>
                                            </div>
                                        )}
                                    </dl>
                                </Card>
                            )}

                            {event.registrationClosed && event.status === "PUBLISHED" && (
                                <Alert type="warning">
                                    <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> Organisers closed registration.
                                </Alert>
                            )}
                        </aside>
                    </div>
                </>
            )}
        </AsyncContent>
    );
};

export default EventDetailPage;
