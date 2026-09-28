import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, FileText, FileUp, Image as ImageIcon, Link2, Megaphone, Send, Trash2, UserRound } from "lucide-react";
import { recruitmentApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Avatar, Button, Card, Field, PageHeader } from "../../components/ui";
import { Deadline } from "../../components/recruitment/RecruitmentParts";
import { uploadWithTicket, megabytes } from "../../lib/mediaUpload";
import { batchLabel } from "../../lib/format";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FILE_KIND = { "application/pdf": "DOCUMENT", "image/jpeg": "IMAGE", "image/png": "IMAGE", "image/webp": "IMAGE" };
const LIMITS = { SHORT: 300, PARAGRAPH: 5000, LINK: 500 };
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const emptyAnswer = () => ({ text: "", choices: [], file: null, media: null, keepFile: false });

const fromApplication = (application) =>
    Object.fromEntries(application.answers.map((answer) => [answer.question, { text: answer.text, choices: answer.choices, file: answer.file, media: null, keepFile: Boolean(answer.file) }]));

const validate = (drive, positions, answers) => {
    const errors = {};
    if (!positions.length) errors.positions = "Choose at least one position";
    drive.questions.forEach((question) => {
        const answer = answers[question._id] || emptyAnswer();
        const filled = question.type === "FILE" ? Boolean(answer.media || answer.keepFile) : ["SINGLE_CHOICE", "MULTI_CHOICE"].includes(question.type) ? answer.choices.length > 0 : answer.text.trim().length > 0;
        if (question.required && !filled) errors[question._id] = "This question is required";
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

/** The application form for a drive (/recruitment/:id/apply), also used to edit a submitted application. */
const ApplyPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useAuth();
    const drive = useApi(() => recruitmentApi.get(id), [id]);
    const hasApplication = Boolean(drive.data?.viewer?.application);
    const mine = useApi(() => recruitmentApi.myApplication(id), [id], { enabled: hasApplication });
    const [positions, setPositions] = useState([]);
    const [answers, setAnswers] = useState({});
    const [touched, setTouched] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (mine.data) {
            setPositions(mine.data.positions);
            setAnswers(fromApplication(mine.data));
        }
    }, [mine.data]);

    const errors = useMemo(() => (drive.data ? validate(drive.data, positions, answers) : {}), [drive.data, positions, answers]);
    const shown = touched ? errors : {};
    const answerOf = (questionId) => answers[questionId] || emptyAnswer();
    const togglePosition = (positionId) => setPositions((current) => (current.includes(positionId) ? current.filter((item) => item !== positionId) : [...current, positionId]));

    const submit = async (event) => {
        event.preventDefault();
        setTouched(true);
        if (Object.keys(errors).length) {
            toast.error("Please complete the highlighted questions");
            return;
        }
        setSaving(true);
        const body = {
            positions,
            answers: drive.data.questions.map((question) => {
                const answer = answerOf(question._id);
                return { question: question._id, text: answer.text.trim(), choices: answer.choices, ...(answer.media ? { media: answer.media } : answer.keepFile ? { keepFile: true } : {}) };
            })
        };
        try {
            if (hasApplication) {
                await recruitmentApi.updateApplication(id, body);
                toast.success("Application updated");
            } else {
                await recruitmentApi.apply(id, body);
                toast.success("Application submitted — check your email for the confirmation");
            }
            navigate(`/recruitment/${id}`);
        } catch (error) {
            toast.error(error);
        } finally {
            setSaving(false);
        }
    };

    const data = drive.data;
    const blocked = data && !hasApplication && !data.viewer?.canApply;

    return (
        <AsyncContent loading={drive.loading || (hasApplication && mine.loading)} error={drive.error || mine.error} onRetry={drive.reload}>
            {data && (
                <>
                    <PageHeader
                        back={{ to: `/recruitment/${id}`, label: data.title }}
                        eyebrow={
                            <>
                                <Megaphone size={14} /> {data.club.name} · recruitment
                            </>
                        }
                        title={hasApplication ? "Edit your application" : "Apply"}
                        description={data.title}
                        actions={<Deadline drive={data} />}
                    />
                    {blocked ? (
                        <Alert type="warning" title="You can't apply to this drive">
                            {data.viewer?.applyProblem}
                        </Alert>
                    ) : (
                        <form className="recruit-apply stack-lg" onSubmit={submit} noValidate>
                            <Card title={<h2 className="row"><UserRound size={18} /> Your details</h2>}>
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

                            <Card title="Positions you're applying for">
                                <p className="subtle small" style={{ marginTop: 0 }}>
                                    Pick one or more, in order of preference.
                                </p>
                                <div className="recruit-position-picker">
                                    {data.positions.map((position) => {
                                        const rank = positions.indexOf(position._id);
                                        return (
                                            <button key={position._id} type="button" aria-pressed={rank !== -1} className={`recruit-position-card ${rank !== -1 ? "is-on" : ""}`} onClick={() => togglePosition(position._id)}>
                                                <span className="recruit-position-rank">{rank !== -1 ? rank + 1 : ""}</span>
                                                <strong>{position.title}</strong>
                                                {position.description && <span className="subtle small">{position.description}</span>}
                                                {position.openings && <span className="recruit-chip">{position.openings} open</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                                {shown.positions && <span className="field-error">{shown.positions}</span>}
                            </Card>

                            {data.questions.length > 0 && (
                                <Card title="Questions from the club">
                                    <div className="stack">
                                        {data.questions.map((question) => (
                                            <QuestionField
                                                key={question._id}
                                                driveId={id}
                                                question={question}
                                                answer={answerOf(question._id)}
                                                error={shown[question._id]}
                                                onChange={(answer) => setAnswers((current) => ({ ...current, [question._id]: answer }))}
                                            />
                                        ))}
                                    </div>
                                </Card>
                            )}

                            <div className="form-actions">
                                <Button variant="secondary" onClick={() => navigate(`/recruitment/${id}`)}>
                                    Cancel
                                </Button>
                                <Button type="submit" size="lg" loading={saving}>
                                    <Send size={16} /> {hasApplication ? "Save changes" : "Submit application"}
                                </Button>
                            </div>
                        </form>
                    )}
                </>
            )}
        </AsyncContent>
    );
};

export default ApplyPage;
