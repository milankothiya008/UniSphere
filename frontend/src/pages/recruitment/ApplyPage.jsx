import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, FileText, FileUp, Image as ImageIcon, Link2, PencilLine, Send, Trash2 } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Avatar, Button, Card, Field, PageHeader } from "../../components/ui";
import { Deadline } from "../../components/recruitment/RecruitmentParts";
import { uploadWithTicket, megabytes } from "../../lib/mediaUpload";
import { batchLabel, plural } from "../../lib/format";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_KIND = { "application/pdf": "DOCUMENT", "image/jpeg": "IMAGE", "image/png": "IMAGE", "image/webp": "IMAGE" };
const LIMITS = { SHORT: 300, PARAGRAPH: 5000, LINK: 500 };
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const CHOICE = ["SINGLE_CHOICE", "MULTI_CHOICE"];

const emptyAnswer = () => ({ text: "", choices: [], file: null, media: null, keepFile: false });

const fromApplication = (application) =>
    Object.fromEntries(
        application.pages.flatMap((page) => page.answers).map((answer) => [answer.question, { text: answer.text, choices: answer.choices, file: answer.file, media: null, keepFile: Boolean(answer.file) }])
    );

const isFilled = (question, answer) =>
    question.type === "FILE" ? Boolean(answer.media || answer.keepFile) : CHOICE.includes(question.type) ? answer.choices.length > 0 : answer.text.trim().length > 0;

// Problems on one page of the form.
const pageErrors = (page, answers) => {
    const errors = {};
    page.questions.forEach((question) => {
        const answer = answers[question._id] || emptyAnswer();
        if (question.required && !isFilled(question, answer)) errors[question._id] = "This question is required";
        if (question.type === "LINK" && answer.text.trim() && !URL_PATTERN.test(answer.text.trim())) errors[question._id] = "Paste the full link, starting with https://";
    });
    return errors;
};

// A file answer: pick → upload straight to storage with progress → chip with the file name.
const FileAnswer = ({ driveId, answer, onChange, disabled }) => {
    const toast = useToast();
    const [progress, setProgress] = useState(null);
    const current = answer.media ? { name: answer.media.name, kind: answer.media.kind } : answer.keepFile ? answer.file : null;

    const pick = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const kind = FILE_KIND[file.type];
        if (!kind) {
            toast.error("Attach a PDF, JPEG, PNG or WebP file");
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            toast.error(`Files must be ${megabytes(MAX_FILE_BYTES)} or smaller`);
            return;
        }
        setProgress(0);
        try {
            const { data: tickets } = await recruitmentApi.uploadTickets(driveId, [kind]);
            const media = await uploadWithTicket(file, tickets[0], { onProgress: setProgress });
            onChange({ ...answer, media: { ...media, kind, name: file.name }, keepFile: false });
        } catch (error) {
            toast.error(error);
        } finally {
            setProgress(null);
        }
    };

    return (
        <div className="recruit-file">
            {current ? (
                <div className="recruit-file-chip">
                    {current.kind === "IMAGE" ? <ImageIcon size={18} /> : <FileText size={18} />}
                    <span className="grow">{current.name || "Attached file"}</span>
                    <Check size={16} className="recruit-file-ok" />
                    {!disabled && (
                        <Button variant="ghost" size="sm" onClick={() => onChange({ ...answer, media: null, keepFile: false })} aria-label="Remove file">
                            <Trash2 size={14} />
                        </Button>
                    )}
                </div>
            ) : (
                <label className={`recruit-file-drop ${progress !== null ? "is-busy" : ""}`}>
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={pick} disabled={disabled || progress !== null} hidden />
                    <FileUp size={20} />
                    <span>{progress !== null ? `Uploading ${Math.round(progress * 100)}%` : "Choose a PDF or image (up to 5 MB)"}</span>
                    {progress !== null && <span className="recruit-file-bar" style={{ "--p": progress }} />}
                </label>
            )}
        </div>
    );
};

const QuestionField = ({ driveId, question, answer, onChange, error }) => {
    const set = (changes) => onChange({ ...answer, ...changes });
    const limit = LIMITS[question.type];
    return (
        <Field label={question.label} required={question.required} error={error} hint={question.help || (question.type === "PARAGRAPH" ? `${answer.text.length} / ${limit}` : undefined)}>
            {question.type === "SHORT" && <input className="input" value={answer.text} onChange={(event) => set({ text: event.target.value })} maxLength={limit} aria-label={question.label} />}
            {question.type === "PARAGRAPH" && <textarea className="textarea" rows={5} value={answer.text} onChange={(event) => set({ text: event.target.value })} maxLength={limit} aria-label={question.label} />}
            {question.type === "LINK" && (
                <div className="recruit-link-input">
                    <Link2 size={15} />
                    <input className="input" type="url" inputMode="url" placeholder="https://" value={answer.text} onChange={(event) => set({ text: event.target.value })} maxLength={limit} aria-label={question.label} />
                </div>
            )}
            {["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) && (
                <div className="recruit-choices" role={question.type === "SINGLE_CHOICE" ? "radiogroup" : "group"} aria-label={question.label}>
                    {question.options.map((option) => {
                        const on = answer.choices.includes(option);
                        const toggle = () =>
                            set({ choices: question.type === "SINGLE_CHOICE" ? [option] : on ? answer.choices.filter((item) => item !== option) : [...answer.choices, option] });
                        return (
                            <button key={option} type="button" role={question.type === "SINGLE_CHOICE" ? "radio" : "checkbox"} aria-checked={on} className={`recruit-choice ${on ? "is-on" : ""}`} onClick={toggle}>
                                <span className={question.type === "SINGLE_CHOICE" ? "recruit-radio" : "recruit-box"} aria-hidden="true">
                                    {on && <Check size={12} strokeWidth={3} />}
                                </span>
                                {option}
                            </button>
                        );
                    })}
                </div>
            )}
            {question.type === "FILE" && <FileAnswer driveId={driveId} answer={answer} onChange={onChange} />}
        </Field>
    );
};

// A read-only answer on the review step.
const AnswerSummary = ({ question, answer }) => {
    const filled = isFilled(question, answer);
    return (
        <div className="recruit-review-answer">
            <span className="recruit-answer-q">{question.label}</span>
            {!filled ? (
                <span className="subtle">Not answered</span>
            ) : question.type === "FILE" ? (
                <span className="recruit-file-chip">
                    <FileText size={16} /> {answer.media?.name || answer.file?.name || "Attached file"}
                </span>
            ) : CHOICE.includes(question.type) ? (
                <div className="recruit-chips">
                    {answer.choices.map((choice) => (
                        <span key={choice} className="recruit-chip">
                            {choice}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="pre-line" style={{ margin: 0 }}>
                    {answer.text}
                </p>
            )}
        </div>
    );
};

/**
 * The application for one role (/recruitment/:id/apply/:positionId), one page at a time: your details, each
 * page of the role's form, then a review before submitting. Also edits a submitted application.
 */
const ApplyPage = () => {
    const { id, positionId } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const drive = useApi(() => recruitmentApi.get(id), [id]);
    const existing = drive.data?.viewer?.applications?.find((application) => application.position === positionId);
    const editing = Boolean(existing);
    const mine = useApi(() => recruitmentApi.myApplication(id, positionId), [id, positionId], { enabled: editing });
    const [answers, setAnswers] = useState({});
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState("forward");
    const [touched, setTouched] = useState({});
    const [saving, setSaving] = useState(false);
    const top = useRef(null);

    useEffect(() => {
        if (mine.data) {
            setAnswers(fromApplication(mine.data));
        }
    }, [mine.data]);

    const data = drive.data;
    const position = data?.positions.find((item) => item._id === positionId);
    const pages = useMemo(() => position?.form?.pages || [], [position]);
    const steps = useMemo(() => [{ title: "Your details" }, ...pages.map((page) => ({ title: page.title })), { title: "Review" }], [pages]);
    const last = steps.length - 1;
    const page = step > 0 && step < last ? pages[step - 1] : null;
    const errors = useMemo(() => (page ? pageErrors(page, answers) : {}), [page, answers]);
    const shown = touched[step] ? errors : {};
    const answerOf = (questionId) => answers[questionId] || emptyAnswer();

    const go = (next) => {
        setDirection(next < step ? "back" : "forward");
        setStep(next);
        top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };
    const next = () => {
        if (page && Object.keys(errors).length) {
            setTouched((current) => ({ ...current, [step]: true }));
            toast.error("Please complete this page first");
            return;
        }
        go(step + 1);
    };

    const submit = async () => {
        // Every page is checked once more before sending.
        const broken = pages.findIndex((item) => Object.keys(pageErrors(item, answers)).length);
        if (broken !== -1) {
            setTouched((current) => ({ ...current, [broken + 1]: true }));
            go(broken + 1);
            toast.error("One of the pages still needs an answer");
            return;
        }
        setSaving(true);
        const body = {
            answers: pages
                .flatMap((item) => item.questions)
                .map((question) => {
                    const answer = answerOf(question._id);
                    return { question: question._id, text: answer.text.trim(), choices: answer.choices, ...(answer.media ? { media: answer.media } : answer.keepFile ? { keepFile: true } : {}) };
                })
        };
        try {
            if (editing) {
                await recruitmentApi.updateApplication(id, positionId, body);
                toast.success("Application updated");
            } else {
                await recruitmentApi.apply(id, positionId, body);
                toast.success(`Applied for ${position.title} — check your email for the confirmation`);
            }
            navigate(`/recruitment/${id}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setSaving(false);
        }
    };

    if (data && !positionId) {
        return <Navigate to={data.positions.length === 1 ? `/recruitment/${id}/apply/${data.positions[0]._id}` : `/recruitment/${id}#roles`} replace />;
    }

    const blocked = data && !editing && !data.viewer?.canApply;
    const progress = steps.length > 1 ? step / last : 1;

    return (
        <AsyncContent loading={drive.loading || (editing && mine.loading)} error={drive.error || mine.error} onRetry={drive.reload}>
            {data && (
                <>
                    <div ref={top} />
                    <PageHeader
                        back={{ to: `/recruitment/${id}`, label: data.title }}
                        title={position ? `${editing ? "Edit your application" : "Apply"}: ${position.title}` : "Apply"}
                        actions={<Deadline drive={data} />}
                    />
                    {!position ? (
                        <Alert type="warning" title="This role isn't part of the drive">
                            Go back to the drive to see the roles you can apply for.
                        </Alert>
                    ) : blocked ? (
                        <Alert type="warning" title="You can't apply to this drive">
                            {data.viewer?.applyProblem}
                        </Alert>
                    ) : editing && !mine.data?.canEdit && mine.data ? (
                        <Alert type="info" title="This application can't be changed any more">
                            Applications can be edited until the deadline, before selection starts.
                        </Alert>
                    ) : (
                        <div className="recruit-wizard">
                            <div className="recruit-wizard-progress" aria-hidden="true">
                                <span style={{ "--p": progress }} />
                            </div>
                            <ol className="recruit-wizard-steps" aria-label="Application steps">
                                {steps.map((item, index) => (
                                    <li key={`${index}-${item.title}`} className={index < step ? "is-done" : index === step ? "is-current" : ""} aria-current={index === step ? "step" : undefined}>
                                        <button type="button" onClick={() => index < step && go(index)} disabled={index >= step} aria-label={`Step ${index + 1}: ${item.title}`}>
                                            <span className="recruit-step-dot">{index < step ? <Check size={12} strokeWidth={3} /> : index + 1}</span>
                                            <span className="recruit-step-label">{item.title}</span>
                                        </button>
                                    </li>
                                ))}
                            </ol>
                            <p className="subtle small recruit-wizard-count">
                                Step {step + 1} of {steps.length}
                            </p>

                            <div className={`recruit-wizard-page is-${direction}`} key={step}>
                                {step === 0 && (
                                    <div className="stack-lg">
                                        <Card title="Your details">
                                            <div className="recruit-profile">
                                                <Avatar name={user.name} />
                                                <div>
                                                    <strong>{user.name}</strong>
                                                    <span className="subtle small">
                                                        {user.email} · {user.departmentCode} · Batch {batchLabel(user.batchCode)}
                                                    </span>
                                                </div>
                                                <span className="subtle small recruit-profile-note">From your profile</span>
                                            </div>
                                        </Card>
                                        <Card title={`The role: ${position.title}`}>
                                            <div className="stack-sm">
                                                {position.description && <p style={{ margin: 0 }}>{position.description}</p>}
                                                <div className="recruit-chips">
                                                    {position.openings ? <span className="recruit-chip">{plural(position.openings, "opening")}</span> : null}
                                                    <span className="recruit-chip">{plural(pages.length, "page")}</span>
                                                    <span className="recruit-chip">{plural(position.questionCount, "question")}</span>
                                                </div>
                                                {data.positions.length > 1 && (
                                                    <p className="subtle small" style={{ margin: 0 }}>
                                                        You can apply for other roles too, each with its own application — but you can join the club in only one role.
                                                    </p>
                                                )}
                                            </div>
                                        </Card>
                                    </div>
                                )}

                                {page && (
                                    <Card title={page.title}>
                                        <div className="stack">
                                            {page.description && <p className="subtle" style={{ margin: 0 }}>{page.description}</p>}
                                            {page.questions.length ? (
                                                page.questions.map((question) => (
                                                    <QuestionField
                                                        key={question._id}
                                                        driveId={id}
                                                        question={question}
                                                        answer={answerOf(question._id)}
                                                        error={shown[question._id]}
                                                        onChange={(answer) => setAnswers((current) => ({ ...current, [question._id]: answer }))}
                                                    />
                                                ))
                                            ) : (
                                                <p className="subtle">Nothing to answer on this page.</p>
                                            )}
                                        </div>
                                    </Card>
                                )}

                                {step === last && (
                                    <div className="stack-lg">
                                        <Alert type="info" title={`Applying for ${position.title}`}>
                                            Check your answers. {editing ? "Your changes replace the saved application." : "You can edit your application until the deadline."}
                                        </Alert>
                                        {pages.map((item, index) => (
                                            <Card
                                                key={item._id}
                                                title={item.title}
                                                actions={
                                                    <Button variant="ghost" size="sm" onClick={() => go(index + 1)}>
                                                        <PencilLine size={14} /> Edit
                                                    </Button>
                                                }
                                            >
                                                <div className="stack">
                                                    {item.questions.map((question) => (
                                                        <AnswerSummary key={question._id} question={question} answer={answerOf(question._id)} />
                                                    ))}
                                                    {!item.questions.length && <span className="subtle">No questions</span>}
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="recruit-wizard-nav">
                                {step === 0 ? (
                                    <Button variant="secondary" onClick={() => navigate(`/recruitment/${id}`)}>
                                        Cancel
                                    </Button>
                                ) : (
                                    <Button variant="secondary" onClick={() => go(step - 1)} disabled={saving}>
                                        <ArrowLeft size={16} /> Back
                                    </Button>
                                )}
                                {step < last ? (
                                    <Button onClick={next}>
                                        {step === 0 ? "Start" : "Next"} <ArrowRight size={16} />
                                    </Button>
                                ) : (
                                    <Button onClick={submit} loading={saving}>
                                        <Send size={16} /> {editing ? "Save changes" : "Submit application"}
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </AsyncContent>
    );
};

export default ApplyPage;
