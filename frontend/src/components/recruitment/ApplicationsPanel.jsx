import { useState } from "react";
import { ExternalLink, FileText, Inbox } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useDebounce } from "../../hooks/useDebounce";
import { Alert, AsyncContent, Avatar, Card, EmptyState, Modal, SearchInput, Select, Skeleton } from "../ui";
import { APPLICATION_STATUSES } from "../../lib/constants";
import { ApplicationBadge } from "./RecruitmentParts";
import { batchLabel, formatDateTime, timeAgo } from "../../lib/format";

const STATUS_FILTERS = [
    { value: "", label: "All applications" },
    { value: "active", label: "Still open" },
    { value: "OFFERED", label: "Offer sent" },
    { value: "ACCEPTED", label: "Joined" },
    { value: "RESERVE", label: "Reserve list" },
    { value: "ELIMINATED", label: "Not shortlisted" },
    { value: "NOT_SELECTED", label: "Not selected" },
    { value: "DECLINED", label: "Declined" },
    { value: "EXPIRED", label: "Offer expired" }
];

const Answer = ({ answer }) => (
    <div className="recruit-answer">
        <span className="recruit-answer-q">{answer.label}</span>
        {answer.type === "FILE" ? (
            answer.file ? (
                <a className="recruit-file-chip is-link" href={answer.file.url} target="_blank" rel="noreferrer">
                    <FileText size={18} /> <span className="grow">{answer.file.name || "Attached file"}</span> <ExternalLink size={14} />
                </a>
            ) : (
                <span className="subtle">No file</span>
            )
        ) : answer.type === "LINK" && answer.text ? (
            <a href={answer.text} target="_blank" rel="noreferrer" className="recruit-answer-link">
                {answer.text} <ExternalLink size={13} />
            </a>
        ) : answer.choices.length ? (
            <div className="recruit-chips">
                {answer.choices.map((choice) => (
                    <span key={choice} className="recruit-chip">
                        {choice}
                    </span>
                ))}
            </div>
        ) : (
            <p className="pre-line" style={{ margin: 0 }}>
                {answer.text || <span className="subtle">No answer</span>}
            </p>
        )}
    </div>
);

// One application's answers, for the president and the mentor.
const ApplicationDetail = ({ driveId, applicationId, onClose }) => {
    const { data, loading } = useApi(() => recruitmentApi.application(driveId, applicationId), [driveId, applicationId]);
    return (
        <Modal
            open
            onClose={onClose}
            size="lg"
            title={data ? `${data.applicant.name} · ${data.positionTitle}` : "Application"}
            description={data ? `${data.applicant.email} · applied ${formatDateTime(data.createdAt)}` : undefined}
        >
            {loading || !data ? (
                <Skeleton height={240} />
            ) : (
                <div className="stack">
                    <div className="row" style={{ gap: 8 }}>
                        <ApplicationBadge status={data.status} />
                        <span className="subtle small">
                            {data.applicant.departmentCode} · Batch {batchLabel(data.applicant.batchCode)}
                        </span>
                    </div>
                    {data.otherApplications.length > 0 && (
                        <Alert type="info" title="Also applied for">
                            {data.otherApplications.map((other) => `${other.positionTitle} (${(APPLICATION_STATUSES[other.status] || [other.status])[0].toLowerCase()})`).join(", ")}. A student can join in only one role.
                        </Alert>
                    )}
                    {data.pages.map((page, index) => (
                        <section key={page._id} className="recruit-answer-page">
                            <h3>
                                <span className="recruit-step-dot">{index + 1}</span> {page.title}
                            </h3>
                            {page.answers.map((answer) => (
                                <Answer key={answer.question} answer={answer} />
                            ))}
                        </section>
                    ))}
                    {!data.pages.length && <p className="subtle">This role's form has no questions.</p>}
                </div>
            )}
        </Modal>
    );
};

/** Applications tab: every applicant, searchable, with their answers one click away. */
export const ApplicationsPanel = ({ drive, initialPosition = "" }) => {
    const [search, setSearch] = useState("");
    const [status, setStatus] = useState("");
    const [position, setPosition] = useState(initialPosition);
    const [open, setOpen] = useState(null);
    const debounced = useDebounce(search.trim(), 300);
    const { data, loading, error, reload } = useApi(
        () => recruitmentApi.applications(drive._id, { search: debounced || undefined, status: status || undefined, position: position || undefined }),
        [drive._id, debounced, status, position]
    );

    return (
        <Card padded={false} title={<h2 className="row">{data ? `${data.length} applications` : "Applications"}</h2>}>
            <div className="recruit-filters">
                <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" />
                <Select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} options={STATUS_FILTERS} />
                <Select aria-label="Role" value={position} onChange={(event) => setPosition(event.target.value)} options={[{ value: "", label: "All roles" }, ...drive.positions.map((item) => ({ value: item._id, label: item.title }))]} />
            </div>
            <AsyncContent
                loading={loading && !data}
                error={error}
                onRetry={reload}
                isEmpty={data && !data.length}
                empty={<EmptyState icon={Inbox} title={debounced || status || position ? "No applications match" : "No applications yet"} description="Applications appear here as students submit them." />}
            >
                <ul className="recruit-app-list">
                    {data?.map((application, index) => (
                        <li key={application._id} style={{ "--i": Math.min(index, 12) }}>
                            <button type="button" className="recruit-app-row" onClick={() => setOpen(application._id)}>
                                <Avatar name={application.applicant.name} src={application.applicant.avatar} size="sm" />
                                <span className="grow">
                                    <strong>{application.applicant.name}</strong>
                                    <span className="subtle small">
                                        {application.applicant.email} · {application.applicant.departmentCode} · {batchLabel(application.applicant.batchCode)}
                                    </span>
                                </span>
                                <span className="recruit-app-positions small">
                                    {application.positionTitle}
                                    {application.otherRoles > 0 && <span className="subtle"> · +{application.otherRoles} other {application.otherRoles === 1 ? "role" : "roles"}</span>}
                                </span>
                                <ApplicationBadge status={application.status} />
                                <span className="subtle small recruit-app-when">{timeAgo(application.createdAt)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </AsyncContent>
            {open && <ApplicationDetail driveId={drive._id} applicationId={open} onClose={() => setOpen(null)} />}
        </Card>
    );
};
