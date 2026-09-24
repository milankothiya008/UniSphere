import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Crown, Eye, EyeOff, ListOrdered, Lock, Megaphone, Plus, Save, Trash2, Trophy, UserPlus, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { Alert, ApiErrorAlert, AsyncContent, Badge, Button, Card, ConfirmDialog, ErrorState, Input, PageHeader, Select, Textarea } from "../../components/ui";
import { Standings, WinnersPodium } from "../../components/results/ResultParts";
import { formatDate, formatDateTime, plural, timeAgo } from "../../lib/format";

const PRESETS = ["Winner", "Runner-up", "Second runner-up", "Special mention"];
const QUALIFIED_OPTIONS = [
    { value: "", label: "—" },
    { value: "true", label: "Qualified" },
    { value: "false", label: "Eliminated" }
];

let keySeed = 0;
const nextKey = () => `row-${++keySeed}`;

// ---------------------------------------------------------------- rounds

const blankRow = (overrides = {}) => ({ key: nextKey(), rank: "", recipientUser: "", recipientName: "", teamName: "", score: "", qualified: "", note: "", ...overrides });

const rowsFromRound = (round) =>
    round.entries.map((entry) =>
        blankRow({
            rank: entry.rank ? String(entry.rank) : "",
            recipientUser: entry.recipientUser?._id || entry.recipientUser || "",
            recipientName: entry.recipientUser ? "" : entry.recipientName || "",
            teamName: entry.teamName || "",
            score: entry.score || "",
            qualified: entry.qualified === true ? "true" : entry.qualified === false ? "false" : "",
            note: entry.note || ""
        })
    );

const rowsPayload = (rows) =>
    rows
        .filter((row) => row.recipientUser || row.recipientName.trim() || row.teamName.trim())
        .map((row) => ({
            rank: row.rank ? Number(row.rank) : null,
            recipientUser: row.recipientUser || null,
            recipientName: row.recipientUser ? null : row.recipientName.trim() || null,
            teamName: row.teamName.trim() || null,
            score: row.score.trim() || null,
            qualified: row.qualified === "" ? null : row.qualified === "true",
            note: row.note.trim() || null
        }));

const RoundEditor = ({ eventId, round, index, participants, canPublish, onSaved }) => {
    const toast = useToast();
    const published = round.status === "PUBLISHED";
    const readOnly = published && !canPublish;
    const [name, setName] = useState(round.name);
    const [description, setDescription] = useState(round.description || "");
    const [rows, setRows] = useState(() => rowsFromRound(round));
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const [dialog, setDialog] = useState(null);

    useEffect(() => {
        setName(round.name);
        setDescription(round.description || "");
        setRows(rowsFromRound(round));
    }, [round]);

    const participantOptions = participants.map((row) => ({ value: row.user._id, label: `${row.user.name} (${row.user.email})` }));
    const listed = new Set(rows.map((row) => row.recipientUser).filter(Boolean));

    const update = (key, field, value) => setRows((list) => list.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

    const addEveryone = () => {
        const missing = participants.filter((row) => !listed.has(row.user._id)).map((row) => blankRow({ recipientUser: row.user._id }));
        setRows((list) => [...list.filter((row) => row.recipientUser || row.recipientName || row.teamName), ...missing]);
    };

    const run = async (label, action, message) => {
        setPending(label);
        setError(null);
        try {
            const response = await action();
            onSaved(response.data);
            if (message) {
                toast.success(message);
            }
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setPending(null);
        }
    };

    const save = () => run("save", () => eventApi.updateRound(eventId, round._id, { name, description, entries: rowsPayload(rows) }), published ? "Correction published" : "Round saved");

    const publish = async () => {
        await run("publish", () => eventApi.updateRound(eventId, round._id, { name, description, entries: rowsPayload(rows) }));
        await run("publish", () => eventApi.publishRound(eventId, round._id), `${name} results published — participants are being notified`);
    };

    const entryCount = rowsPayload(rows).length;

    return (
        <Card
            className={`round-editor ${published ? "is-published" : ""}`}
            title={
                <h2 className="row">
                    <span className="round-number">{index + 1}</span> {round.name}
                </h2>
            }
            actions={
                published ? (
                    <Badge tone="success" title={`Published ${formatDateTime(round.publishedAt)}`}>
                        <Eye size={12} /> Published {timeAgo(round.publishedAt)}
                    </Badge>
                ) : (
                    <Badge tone="warning">Draft</Badge>
                )
            }
        >
            {readOnly ? (
                <div className="stack">
                    <Alert type="info">
                        <Lock size={14} style={{ verticalAlign: "-2px" }} /> This round is published. Only the club president can correct or withdraw it.
                    </Alert>
                    <Standings entries={round.entries} />
                </div>
            ) : (
                <div className="stack">
                    <div className="form-grid">
                        <Input label="Round name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
                        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="e.g. Top 10 teams go through to the finals" />
                    </div>

                    <div className="round-rows" role="table" aria-label={`${round.name} standings`}>
                        <div className="round-row round-row-head" role="row">
                            <span>Rank</span>
                            <span>Participant</span>
                            <span>Team / name</span>
                            <span>Score</span>
                            <span>Status</span>
                            <span>Note</span>
                            <span />
                        </div>
                        {rows.map((row, rowIndex) => (
                            <div key={row.key} className="round-row" role="row">
                                <Input aria-label={`Row ${rowIndex + 1} rank`} type="number" min={1} value={row.rank} onChange={(e) => update(row.key, "rank", e.target.value)} placeholder="#" />
                                <Select
                                    aria-label={`Row ${rowIndex + 1} participant`}
                                    value={row.recipientUser}
                                    onChange={(e) => update(row.key, "recipientUser", e.target.value)}
                                    placeholder="— Not registered —"
                                    options={participantOptions.map((option) => ({ ...option, disabled: option.value !== row.recipientUser && listed.has(option.value) }))}
                                />
                                <Input
                                    aria-label={`Row ${rowIndex + 1} team or name`}
                                    value={row.recipientUser ? row.teamName : row.teamName || row.recipientName}
                                    onChange={(e) => (row.recipientUser ? update(row.key, "teamName", e.target.value) : setRows((list) => list.map((r) => (r.key === row.key ? { ...r, teamName: e.target.value, recipientName: "" } : r))))}
                                    placeholder={row.recipientUser ? "Team (optional)" : "Team or name"}
                                    maxLength={120}
                                />
                                <Input aria-label={`Row ${rowIndex + 1} score`} value={row.score} onChange={(e) => update(row.key, "score", e.target.value)} placeholder="e.g. 87.5" maxLength={40} />
                                <Select aria-label={`Row ${rowIndex + 1} status`} value={row.qualified} onChange={(e) => update(row.key, "qualified", e.target.value)} options={QUALIFIED_OPTIONS} />
                                <Input aria-label={`Row ${rowIndex + 1} note`} value={row.note} onChange={(e) => update(row.key, "note", e.target.value)} placeholder="Optional" maxLength={200} />
                                <Button variant="ghost" size="sm" onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))} aria-label={`Remove row ${rowIndex + 1}`}>
                                    <Trash2 size={14} />
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="row">
                        <Button variant="secondary" size="sm" onClick={() => setRows((list) => [...list, blankRow({ rank: String(list.length + 1) })])}>
                            <Plus size={14} /> Add row
                        </Button>
                        {participants.length > listed.size && (
                            <Button variant="secondary" size="sm" onClick={addEveryone}>
                                <UserPlus size={14} /> Add all {participants.length} participants
                            </Button>
                        )}
                        <span className="subtle small">{plural(entryCount, "entry", "entries")}</span>
                    </div>

                    <ApiErrorAlert error={error} />

                    <div className="form-actions">
                        {!published && (
                            <Button variant="ghost" onClick={() => setDialog("delete")} disabled={Boolean(pending)}>
                                <Trash2 size={15} /> Delete round
                            </Button>
                        )}
                        {published && canPublish && (
                            <Button variant="ghost" onClick={() => setDialog("withdraw")} disabled={Boolean(pending)}>
                                <EyeOff size={15} /> Withdraw
                            </Button>
                        )}
                        <Button variant="secondary" onClick={() => save().catch(() => {})} loading={pending === "save"} disabled={Boolean(pending) || !name.trim()}>
                            <Save size={15} /> {published ? "Publish correction" : "Save draft"}
                        </Button>
                        {!published &&
                            (canPublish ? (
                                <Button variant="accent" onClick={() => setDialog("publish")} disabled={Boolean(pending) || !name.trim() || !entryCount}>
                                    <Megaphone size={15} /> Publish round
                                </Button>
                            ) : (
                                <span className="subtle small row" style={{ gap: 6 }}>
                                    <Crown size={14} /> The president publishes rounds
                                </span>
                            ))}
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={dialog === "publish"}
                onClose={() => setDialog(null)}
                onConfirm={publish}
                title={`Publish ${name}?`}
                description="The standings become public on the results page. Registered participants are notified, and qualifiers get a personal email."
                confirmLabel="Publish round"
                variant="accent"
            />
            <ConfirmDialog
                open={dialog === "withdraw"}
                onClose={() => setDialog(null)}
                onConfirm={() => run("withdraw", () => eventApi.unpublishRound(eventId, round._id), "Round withdrawn — it's a draft again")}
                title={`Withdraw ${round.name}?`}
                description="The standings disappear from the results page until you publish them again. Emails already sent can't be recalled."
                confirmLabel="Withdraw"
                variant="danger"
            />
            <ConfirmDialog
                open={dialog === "delete"}
                onClose={() => setDialog(null)}
                onConfirm={() => run("delete", () => eventApi.deleteRound(eventId, round._id), "Round deleted")}
                title={`Delete ${round.name}?`}
                description="This draft round and its standings will be removed."
                confirmLabel="Delete round"
                variant="danger"
            />
        </Card>
    );
};

const NewRound = ({ eventId, count, onSaved }) => {
    const toast = useToast();
    const [name, setName] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const create = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await eventApi.createRound(eventId, { name: name.trim() });
            onSaved(response.data);
            setName("");
            toast.success("Round added — fill in the standings");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <form className="new-round" onSubmit={create}>
            <Input
                label={count ? "Add another round" : "Add the first round"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. Round ${count + 1}: ${count ? "Finals" : "Idea screening"}`}
                maxLength={80}
            />
            <Button type="submit" loading={pending} disabled={!name.trim()}>
                <Plus size={15} /> Add round
            </Button>
            {error && (
                <div style={{ gridColumn: "1 / -1" }}>
                    <Alert type="error">{error.message}</Alert>
                </div>
            )}
        </form>
    );
};

// ---------------------------------------------------------------- final results

const emptyAward = (index) => ({
    key: nextKey(),
    title: PRESETS[index] || "",
    position: index < 3 ? String(index + 1) : "",
    recipientUser: "",
    recipientName: "",
    teamName: "",
    prize: "",
    recognition: ""
});

const awardsFromResult = (result) =>
    result.awards.map((award) => ({
        key: nextKey(),
        title: award.title,
        position: award.position ? String(award.position) : "",
        recipientUser: award.recipientUser?._id || "",
        recipientName: award.recipientUser ? "" : award.recipientName || "",
        teamName: award.teamName || "",
        prize: award.prize || "",
        recognition: award.recognition || ""
    }));

const FinalResultsEditor = ({ event, result, participants, canPublish, onSaved }) => {
    const toast = useToast();
    const published = result?.status === "PUBLISHED";
    const started = new Date(event.startAt) <= new Date();
    const readOnly = published && !canPublish;
    const [summary, setSummary] = useState(result?.summary || "");
    const [awards, setAwards] = useState(() => (result?.awards?.length ? awardsFromResult(result) : [emptyAward(0), emptyAward(1), emptyAward(2)]));
    const [pending, setPending] = useState(null);
    const [error, setError] = useState(null);
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
        if (result) {
            setSummary(result.summary || "");
            if (result.awards?.length) {
                setAwards(awardsFromResult(result));
            }
        }
    }, [result]);

    const updateAward = (key, field, value) => setAwards((list) => list.map((award) => (award.key === key ? { ...award, [field]: value } : award)));

    const payload = () => ({
        summary: summary.trim(),
        awards: awards
            .filter((award) => award.title.trim() && (award.recipientUser || award.recipientName.trim() || award.teamName.trim()))
            .map((award) => ({
                title: award.title.trim(),
                position: award.position ? Number(award.position) : null,
                recipientUser: award.recipientUser || null,
                recipientName: award.recipientUser ? null : award.recipientName.trim() || null,
                teamName: award.teamName.trim() || null,
                prize: award.prize.trim() || null,
                recognition: award.recognition.trim() || null
            }))
    });

    const save = async (message = published ? "Correction published" : "Final results draft saved") => {
        setPending("save");
        setError(null);
        try {
            const response = await eventApi.saveResult(event._id, payload());
            onSaved(response.data);
            if (message) {
                toast.success(message);
            }
        } catch (err) {
            setError(err);
            throw err;
        } finally {
            setPending(null);
        }
    };

    const publish = async () => {
        await save(null);
        const response = await eventApi.publishResult(event._id);
        onSaved(response.data);
        toast.success("Final results published — the campus is being notified");
    };

    const participantOptions = participants.map((row) => ({ value: row.user._id, label: `${row.user.name} (${row.user.email})` }));
    const tooShort = summary.trim().length < 5;

    return (
        <Card
            title={<h2 className="row"><Trophy size={18} color="var(--gold-600)" /> Final results</h2>}
            actions={published ? <Badge tone="success"><Eye size={12} /> Published {timeAgo(result.publishedAt)}</Badge> : result?.summary ? <Badge tone="warning">Draft</Badge> : null}
        >
            {!started ? (
                <Alert type="info">Final results open once the event starts ({formatDateTime(event.startAt)}). Until then, publish round results above.</Alert>
            ) : readOnly ? (
                <div className="stack">
                    <Alert type="info">
                        <Lock size={14} style={{ verticalAlign: "-2px" }} /> Final results are published. Only the club president can correct them.
                    </Alert>
                    <WinnersPodium awards={result.awards} />
                    <p className="pre-line">{result.summary}</p>
                </div>
            ) : (
                <div className="stack">
                    <Textarea
                        label="Summary"
                        hint="A short wrap-up shown above the winners"
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        rows={3}
                        maxLength={4000}
                        required
                    />
                    <div className="stack-sm">
                        {awards.map((award, index) => (
                            <div key={award.key} className="award-editor">
                                <div className="row-between">
                                    <strong>Award {index + 1}</strong>
                                    <Button variant="ghost" size="sm" onClick={() => setAwards((list) => list.filter((a) => a.key !== award.key))} aria-label={`Remove award ${index + 1}`}>
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                                <div className="form-grid">
                                    <Input label="Title" value={award.title} onChange={(e) => updateAward(award.key, "title", e.target.value)} list="award-presets" maxLength={120} />
                                    <Input label="Position" type="number" min={1} value={award.position} onChange={(e) => updateAward(award.key, "position", e.target.value)} placeholder="1" />
                                    <Select
                                        label="Participant"
                                        value={award.recipientUser}
                                        onChange={(e) => updateAward(award.key, "recipientUser", e.target.value)}
                                        placeholder="— Not a registered participant —"
                                        options={participantOptions}
                                    />
                                    <Input
                                        label={award.recipientUser ? "Team (optional)" : "Team or name"}
                                        value={award.recipientUser ? award.teamName : award.teamName || award.recipientName}
                                        onChange={(e) => (award.recipientUser ? updateAward(award.key, "teamName", e.target.value) : setAwards((list) => list.map((a) => (a.key === award.key ? { ...a, teamName: e.target.value, recipientName: "" } : a))))}
                                        maxLength={120}
                                    />
                                    <Input label="Prize" value={award.prize} onChange={(e) => updateAward(award.key, "prize", e.target.value)} placeholder="₹5,000, trophy, certificate…" maxLength={200} />
                                    <Input label="Recognition" value={award.recognition} onChange={(e) => updateAward(award.key, "recognition", e.target.value)} placeholder="Best UI, fastest solve…" maxLength={300} />
                                </div>
                            </div>
                        ))}
                        <datalist id="award-presets">
                            {PRESETS.map((preset) => (
                                <option key={preset} value={preset} />
                            ))}
                        </datalist>
                        <div>
                            <Button variant="secondary" size="sm" onClick={() => setAwards((list) => [...list, emptyAward(list.length)])}>
                                <Plus size={14} /> Add award
                            </Button>
                        </div>
                    </div>

                    <ApiErrorAlert error={error} />

                    <div className="form-actions">
                        <Button variant="secondary" onClick={() => save().catch(() => {})} loading={pending === "save"} disabled={tooShort || Boolean(pending)}>
                            <Save size={15} /> {published ? "Publish correction" : "Save draft"}
                        </Button>
                        {!published &&
                            (canPublish ? (
                                <Button variant="accent" onClick={() => setConfirming(true)} disabled={tooShort || Boolean(pending)}>
                                    <Megaphone size={15} /> Publish final results
                                </Button>
                            ) : (
                                <span className="subtle small row" style={{ gap: 6 }}>
                                    <Crown size={14} /> The president publishes final results
                                </span>
                            ))}
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={confirming}
                onClose={() => setConfirming(false)}
                onConfirm={publish}
                title="Publish final results?"
                description="Winners appear on the results page and the campus feed. Everyone is notified; winners, participants and club members are emailed."
                confirmLabel="Publish final results"
                variant="accent"
            />
        </Card>
    );
};

// ---------------------------------------------------------------- page

const ResultEditorPage = () => {
    const { id } = useParams();
    const eventState = useApi(() => eventApi.get(id), [id]);
    const participants = useApi(() => eventApi.participants(id, { limit: 500 }), [id]);
    const existing = useApi(() => eventApi.result(id), [id]);

    const event = eventState.data;
    const result = existing.data || null;
    const canPublish = Boolean(event?.viewer?.canPublishResults);
    const registered = useMemo(() => (participants.data || []).filter((row) => row.user), [participants.data]);

    if (eventState.error) {
        return <ErrorState error={eventState.error} />;
    }

    if (event && !event.viewer?.canManageResults) {
        return <ErrorState error={{ status: 403, message: "You don't have permission to manage results for this club." }} />;
    }

    const open = event && ["PUBLISHED", "COMPLETED"].includes(event.status);

    return (
        <AsyncContent loading={eventState.loading || existing.loading}>
            {event && (
                <>
                    <PageHeader
                        back={{ to: `/events/${id}`, label: "Back to event" }}
                        eyebrow={<><Trophy size={14} /> Results manager</>}
                        title={event.title}
                        description={`${event.club.name} · ${formatDate(event.startAt)} · ${plural(event.registeredCount, "participant")}`}
                        actions={
                            (result?.status === "PUBLISHED" || result?.rounds?.some((round) => round.status === "PUBLISHED")) && (
                                <Link to={`/results/${id}`} className="btn btn-secondary">
                                    <Eye size={15} /> View public page
                                </Link>
                            )
                        }
                    />

                    <div className="stack-lg" style={{ maxWidth: 1080 }}>
                        {!open && <Alert type="warning">Results can be added once the event is published.</Alert>}
                        {open && (
                            <Alert type="info" title={canPublish ? "You publish the results" : "You prepare the results"}>
                                {canPublish
                                    ? "Drafts are private. Publishing a round notifies its participants; publishing final results notifies the whole campus. Corrections after publishing are marked as updated."
                                    : "Save drafts here and the club president reviews and publishes them. Published results can only be corrected by the president."}
                            </Alert>
                        )}

                        {open && (
                            <>
                                <section className="stack">
                                    <div className="row-between">
                                        <h2 className="row" style={{ margin: 0 }}>
                                            <ListOrdered size={19} /> Rounds
                                        </h2>
                                        <span className="subtle small row" style={{ gap: 6 }}>
                                            <Users size={14} /> {plural(registered.length, "registered participant")}
                                        </span>
                                    </div>
                                    <p className="muted" style={{ margin: 0 }}>
                                        For multi-stage events like hackathons: publish each round's standings as soon as it's judged — even while the event is running.
                                    </p>
                                    {(result?.rounds || []).map((round, index) => (
                                        <RoundEditor key={round._id} eventId={id} round={round} index={index} participants={registered} canPublish={canPublish} onSaved={existing.setData} />
                                    ))}
                                    <Card>
                                        <NewRound eventId={id} count={result?.rounds?.length || 0} onSaved={existing.setData} />
                                    </Card>
                                </section>

                                <FinalResultsEditor event={event} result={result} participants={registered} canPublish={canPublish} onSaved={existing.setData} />
                            </>
                        )}
                    </div>
                </>
            )}
        </AsyncContent>
    );
};

export default ResultEditorPage;
