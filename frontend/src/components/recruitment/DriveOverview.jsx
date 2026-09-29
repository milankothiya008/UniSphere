import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Briefcase, CalendarClock, Gift, GraduationCap, Info, Layers, PartyPopper, Send, Users } from "lucide-react";
import { Badge, Card, Modal } from "../ui";
import { ApplicationBadge } from "./RecruitmentParts";
import { QuestionPreview } from "./QuestionPreview";
import { batchLabel, countdownParts, departmentsLabel, formatDate, formatDateTime, plural } from "../../lib/format";

// Where one role stands, for the club side.
export const STAGES = {
    APPLICATIONS: ["Taking applications", "success"],
    CLOSED: ["Ready for selection", "info"],
    ROUNDS: ["Selection rounds", "violet"],
    FINALIZED: ["Offers sent", "ink"]
};

const LIVE = ["PUBLISHED", "COMPLETED", "CANCELLED"];

// Counts up to `value` once, easing out; shows the value straight away for reduced motion.
const useCountUp = (value, duration = 700) => {
    const [shown, setShown] = useState(typeof value === "number" ? 0 : value);
    useEffect(() => {
        if (typeof value !== "number") {
            setShown(value);
            return undefined;
        }
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof requestAnimationFrame !== "function") {
            setShown(value);
            return undefined;
        }
        let frame;
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            setShown(Math.round(value * (1 - (1 - t) ** 3)));
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [value, duration]);
    return shown;
};

const initials = (title) =>
    title
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word[0].toUpperCase())
        .join("");

// ---------------------------------------------------------------- Key facts

const Fact = ({ icon: Icon, label, value, hint, index, live = false }) => {
    const shown = useCountUp(value);
    return (
        <div className={`drive-fact ${live ? "is-live" : ""}`} style={{ "--i": index }}>
            <span className="drive-fact-icon" aria-hidden="true">
                <Icon size={18} />
            </span>
            <span className="drive-fact-label">{label}</span>
            <strong className={`drive-fact-value ${typeof value === "string" && value.length > 8 ? "is-text" : ""}`}>{shown}</strong>
            {hint && <span className="drive-fact-hint">{hint}</span>}
        </div>
    );
};

const deadlineFact = (drive) => {
    if (drive.status === "COMPLETED") return { label: "Completed", value: formatDate(drive.completedAt), hint: "Recruitment has finished" };
    if (drive.status === "CANCELLED") return { label: "Cancelled", value: formatDate(drive.cancelledAt), hint: "This drive was cancelled" };
    if (!LIVE.includes(drive.status)) return { label: "Deadline", value: formatDate(drive.applicationEnd), hint: "Once published" };
    if (drive.phase === "UPCOMING") return { label: "Opens", value: formatDate(drive.applicationStart), hint: `Closes ${formatDateTime(drive.applicationEnd)}` };
    if (drive.phase === "OPEN") {
        const parts = countdownParts(new Date(drive.applicationEnd) - Date.now()).slice(0, 2);
        return { label: "Closes in", value: parts.map(([value, unit]) => `${value} ${unit}`).join(" "), hint: formatDateTime(drive.applicationEnd), live: true };
    }
    return { label: "Applications", value: "Closed", hint: formatDateTime(drive.closedAt || drive.applicationEnd) };
};

const FactsStrip = ({ drive }) => {
    const openings = drive.positions.every((position) => position.openings) ? drive.positions.reduce((sum, position) => sum + position.openings, 0) : null;
    const deadline = deadlineFact(drive);
    const batches = drive.eligibility?.batches?.length ? `Batch ${drive.eligibility.batches.map(batchLabel).join(", ")}` : "Every batch";
    return (
        <div className="drive-facts">
            <Fact index={0} icon={Briefcase} label={drive.positions.length === 1 ? "Role" : "Roles"} value={drive.positions.length} hint={drive.positions.map((position) => position.title).join(" · ")} />
            <Fact index={1} icon={Users} label="Openings" value={openings ?? "Open"} hint={openings ? "Seats across all roles" : "No fixed limit on some roles"} />
            <Fact index={2} icon={CalendarClock} label={deadline.label} value={deadline.value} hint={deadline.hint} live={deadline.live} />
            <Fact index={3} icon={GraduationCap} label="Who can apply" value={departmentsLabel(drive.club)} hint={batches} />
        </div>
    );
};

// ---------------------------------------------------------------- Journey (students)

const JOURNEY = [
    { label: "Apply", text: "Pick a role and fill its form, page by page", icon: Send },
    { label: "Selection", text: "Screening and interviews for each role", icon: Users },
    { label: "Offer", text: "Accept one offer before it expires", icon: Gift },
    { label: "Join the team", text: "Welcome email and your club role", icon: PartyPopper }
];

const journeyStep = (drive) => {
    if (drive.status === "COMPLETED") return 4;
    if (["UPCOMING", "OPEN"].includes(drive.phase)) return 0;
    return drive.positions.every((position) => position.finalizedAt) ? 2 : 1;
};

const Journey = ({ drive }) => {
    const current = journeyStep(drive);
    const progress = Math.min(current, JOURNEY.length - 1) / (JOURNEY.length - 1);
    return (
        <Card title="How it works" className="drive-journey-card">
            <ol className="drive-journey" style={{ "--progress": progress }} aria-label="Recruitment steps">
                {JOURNEY.map((step, index) => {
                    const Icon = step.icon;
                    const state = index < current ? "is-done" : index === current ? "is-current" : "";
                    return (
                        <li key={step.label} className={state} style={{ "--i": index }} aria-current={index === current ? "step" : undefined}>
                            <span className="drive-journey-dot">
                                <Icon size={17} />
                            </span>
                            <strong>{step.label}</strong>
                            <span>{step.text}</span>
                        </li>
                    );
                })}
            </ol>
        </Card>
    );
};

// ---------------------------------------------------------------- Pipeline (club side)

const PipelineRow = ({ label, value, max, index }) => {
    const shown = useCountUp(value);
    const share = max ? value / max : 0;
    return (
        <li style={{ "--i": index }} title={`${label}: ${value}${max ? ` (${Math.round(share * 100)}% of applicants)` : ""}`}>
            <span className="drive-pipeline-label">{label}</span>
            <span className="drive-pipeline-track">
                <span className="drive-pipeline-bar" style={{ "--share": share, "--min": value ? "6px" : "0px" }} />
            </span>
            <strong className="drive-pipeline-value">{shown}</strong>
        </li>
    );
};

const Pipeline = ({ counts }) => {
    const rows = [
        ["Applied", counts.total],
        ["In selection", counts.active],
        ["Offers out", counts.offered],
        ["Joined", counts.accepted]
    ];
    return (
        <Card title={<h2 className="row"><Layers size={18} /> Pipeline</h2>} actions={<span className="subtle small">All roles</span>}>
            <ul className="drive-pipeline" aria-label="Applications by stage">
                {rows.map(([label, value], index) => (
                    <PipelineRow key={label} label={label} value={value} max={counts.total} index={index} />
                ))}
            </ul>
        </Card>
    );
};

// ---------------------------------------------------------------- Roles

const RoleForm = ({ position }) => (
    <ol className="recruit-preview-pages is-compact">
        {position.form.pages.map((page, index) => (
            <li key={page._id}>
                <div className="recruit-preview-page-head">
                    <span className="recruit-step-dot">{index + 1}</span>
                    <div>
                        <strong>{page.title}</strong>
                        {page.description && <p className="subtle small">{page.description}</p>}
                    </div>
                </div>
                <div className="stack-sm">
                    {page.questions.map((question) => (
                        <QuestionPreview key={question._id} question={question} />
                    ))}
                </div>
            </li>
        ))}
    </ol>
);

// Seats for the club side: how many have joined against the openings.
const Seats = ({ position }) => {
    const counts = position.counts || { total: 0, active: 0, offered: 0, accepted: 0 };
    const share = position.openings ? Math.min(1, counts.accepted / position.openings) : 0;
    return (
        <div className="drive-seats">
            <div className="drive-seats-line">
                <span>
                    <strong>{counts.accepted}</strong> joined{position.openings ? ` of ${position.openings}` : ""}
                    {counts.offered ? ` · ${counts.offered} offer${counts.offered === 1 ? "" : "s"} out` : ""}
                </span>
                <span className="subtle">
                    {counts.total} applied · {counts.active} in selection
                </span>
            </div>
            {position.openings ? (
                <span className="drive-seats-track" aria-hidden="true">
                    <span style={{ "--share": share }} />
                </span>
            ) : null}
        </div>
    );
};

/**
 * One role in the drive. The whole card is the action: apply for it, jump to your application, open its
 * selection (club side), or preview its form before the drive is live.
 */
const RoleCard = ({ drive, position, index, staff, mine, onPreview, onOpenApplication }) => {
    const { viewer } = drive;
    const [stageLabel, stageTone] = STAGES[position.stage] || [];
    const live = LIVE.includes(drive.status);
    const closed = mine?.status === "WITHDRAWN" && mine.closedReason;

    const body = (
        <>
            <div className="recruit-role-card-head">
                <span className="drive-role-mark" aria-hidden="true">
                    {initials(position.title)}
                </span>
                <div className="grow">
                    <h3>{position.title}</h3>
                    <span className="drive-role-meta">
                        {position.openings ? plural(position.openings, "opening") : "Open seats"} · {plural(position.form.pages.length, "page")} · {plural(position.questionCount, "question")}
                    </span>
                </div>
            </div>
            {position.description && <p className="subtle small recruit-role-card-desc">{position.description}</p>}
            {staff && live && <Seats position={position} />}
        </>
    );
    const status =
        staff && stageLabel && live ? (
            <Badge tone={stageTone} dot>
                {stageLabel}
            </Badge>
        ) : !staff && mine ? (
            closed ? <Badge dot>Closed</Badge> : <ApplicationBadge status={mine.status} />
        ) : null;
    const cta = (label, accent = false) => (
        <span className="drive-role-foot">
            <span className={`recruit-role-card-cta ${accent ? "is-accent" : ""}`}>
                {label} <ArrowRight size={15} />
            </span>
            {status}
        </span>
    );
    const props = { className: `recruit-role-card is-action ${mine ? `is-${mine.status.toLowerCase()}` : ""}`, style: { "--i": index } };

    if (staff && live) {
        return (
            <Link {...props} to={`/recruitment/${drive._id}?tab=selection&role=${position._id}`}>
                {body}
                {cta("Open selection")}
            </Link>
        );
    }
    if (staff) {
        return (
            <button type="button" {...props} onClick={() => onPreview(position)}>
                {body}
                {cta("Preview form")}
            </button>
        );
    }
    if (mine) {
        return (
            <button type="button" {...props} onClick={() => onOpenApplication(mine._id)}>
                {body}
                {cta("Your application")}
            </button>
        );
    }
    if (viewer.canApply) {
        return (
            <Link {...props} to={`/recruitment/${drive._id}/apply/${position._id}`}>
                {body}
                {cta(`Apply for ${position.title}`, true)}
            </Link>
        );
    }
    return (
        <article className="recruit-role-card" style={{ "--i": index }}>
            {body}
            {status && <span className="drive-role-foot">{status}</span>}
        </article>
    );
};

// ---------------------------------------------------------------- Overview

/** The drive at a glance: key facts, where it stands, the roles and what the club is looking for. */
export const DriveOverview = ({ drive, staff, mine, onOpenApplication }) => {
    const [preview, setPreview] = useState(null);
    const live = LIVE.includes(drive.status);
    return (
        <div className="stack-lg drive-overview">
            <FactsStrip drive={drive} />
            {staff && live && drive.counts && <Pipeline counts={drive.counts} />}

            <Card title={<h2 className="row" id="roles"><Briefcase size={18} /> Roles</h2>} actions={<span className="subtle small">{plural(drive.positions.length, "role")}</span>}>
                <div className="stack">
                    {!staff && drive.positions.length > 1 && (
                        <p className="drive-note">
                            <Info size={15} /> Each role has its own application and selection. You can apply for more than one, but you'll join in only one role.
                        </p>
                    )}
                    <div className="recruit-role-cards">
                        {drive.positions.map((position, index) => (
                            <RoleCard
                                key={position._id}
                                drive={drive}
                                position={position}
                                index={index}
                                staff={staff}
                                mine={mine.find((application) => application.position === position._id)}
                                onPreview={setPreview}
                                onOpenApplication={onOpenApplication}
                            />
                        ))}
                    </div>
                </div>
            </Card>

            {!staff && drive.status !== "CANCELLED" && <Journey drive={drive} />}

            <Card title="About this recruitment" className="drive-about">
                <p className="prose">{drive.description}</p>
                <Link to={`/clubs/${drive.club._id}`} className="drive-about-club">
                    More about {drive.club.name} <ArrowRight size={14} />
                </Link>
            </Card>

            <Modal open={Boolean(preview)} onClose={() => setPreview(null)} size="lg" title={preview ? `${preview.title} · application form` : ""} description="What students see, one page at a time.">
                {preview && (preview.form.pages.length ? <RoleForm position={preview} /> : <p className="subtle">No questions — students confirm their details and submit.</p>)}
            </Modal>
        </div>
    );
};

