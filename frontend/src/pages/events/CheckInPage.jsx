import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, BadgeCheck, Camera, CameraOff, CheckCircle2, Hash, KeyRound, Lock, PlayCircle, RotateCcw, ScanLine, Search, Undo2, UserCheck, Users, XCircle } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useDebounce } from "../../hooks/useDebounce";
import { useQrScanner } from "../../hooks/useQrScanner";
import { useToast } from "../../context/ToastContext";
import { Alert, AsyncContent, Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, SearchInput, Tabs } from "../../components/ui";
import { batchLabel, formatDateTime, formatTime, plural } from "../../lib/format";
import { spacedCode } from "../../components/events/TicketButton";

const POLL_MS = 30000;
const RESULT_MS = 3500;

// How each scan outcome is shown.
const TONES = {
    CHECKED_IN: ["ok", CheckCircle2],
    UNMARKED: ["info", Undo2],
    ALREADY_CHECKED_IN: ["warn", AlertTriangle],
    INVALID_TICKET: ["bad", XCircle],
    NOT_REGISTERED: ["bad", XCircle],
    WRONG_EVENT: ["bad", XCircle],
    NOT_FOUND: ["bad", XCircle]
};

const detail = (attendee) => [attendee.departmentCode, attendee.batchCode && `Batch ${batchLabel(attendee.batchCode)}`, attendee.team].filter(Boolean).join(" · ");

// The big green/amber/red card that appears after each scan.
const ScanResult = ({ result, onDismiss }) => {
    if (!result) {
        return null;
    }
    const [tone, Icon] = TONES[result.result] || TONES.NOT_FOUND;
    return (
        <div className={`scan-result is-${tone}`} role="status" onClick={onDismiss}>
            <Icon size={34} />
            <div className="grow">
                <strong>{result.message}</strong>
                {result.attendee && (
                    <span>
                        {result.attendee.email}
                        {detail(result.attendee) ? ` · ${detail(result.attendee)}` : ""}
                    </span>
                )}
            </div>
        </div>
    );
};

const ScanTab = ({ onDecode, active }) => {
    const { videoRef, state, error, start, stop, supported } = useQrScanner({ onDecode, enabled: active });

    useEffect(() => {
        if (!active) {
            stop();
        }
    }, [active, stop]);

    const scanning = state === "scanning" || state === "starting";

    return (
        <div className="checkin-scan">
            <div className={`checkin-viewport ${scanning ? "is-live" : ""}`}>
                <video ref={videoRef} autoPlay muted playsInline />
                {scanning && <span className="checkin-reticle" aria-hidden="true" />}
                {!scanning && (
                    <div className="checkin-viewport-idle">
                        {state === "idle" && (
                            <>
                                <span className="checkin-camera-icon">
                                    <Camera size={30} />
                                </span>
                                <strong>Scan tickets with the camera</strong>
                                <p>Point the back camera at a student's QR code. Each scan checks them in straight away.</p>
                                <Button size="lg" onClick={start} disabled={!supported}>
                                    <PlayCircle size={18} /> Start camera
                                </Button>
                                {!supported && <p className="subtle small">This browser has no camera access. Use the Search or Code tab instead.</p>}
                            </>
                        )}
                        {state === "denied" && (
                            <>
                                <CameraOff size={30} />
                                <strong>Camera access was blocked</strong>
                                <p>Allow the camera for this site in your browser settings, then try again — or use the Search or Code tab.</p>
                                <Button variant="secondary" onClick={start}>
                                    <RotateCcw size={16} /> Try again
                                </Button>
                            </>
                        )}
                        {(state === "unsupported" || state === "insecure" || state === "error") && (
                            <>
                                <CameraOff size={30} />
                                <strong>{state === "insecure" ? "Camera needs a secure (https) connection" : "No camera available"}</strong>
                                <p>{error || "Check students in from the Search or Code tab instead."}</p>
                            </>
                        )}
                    </div>
                )}
            </div>
            {scanning && (
                <div className="row-between">
                    <span className="subtle small">
                        <ScanLine size={14} /> Scanning… hold the QR code steady
                    </span>
                    <Button variant="ghost" size="sm" onClick={stop}>
                        Stop camera
                    </Button>
                </div>
            )}
        </div>
    );
};

const SearchTab = ({ eventId, onChange, busy }) => {
    const [search, setSearch] = useState("");
    const debounced = useDebounce(search.trim(), 300);
    const { data, loading, error, reload } = useApi(() => eventApi.checkInParticipants(eventId, debounced), [eventId, debounced]);

    const act = async (attendee, mark) => {
        await onChange(mark ? () => eventApi.markAttendance(eventId, attendee.registrationId) : () => eventApi.unmarkAttendance(eventId, attendee.registrationId));
        reload({ silent: true });
    };

    return (
        <div className="stack">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email" autoFocus />
            <AsyncContent loading={loading && !data} error={error} onRetry={reload} isEmpty={data && data.length === 0} empty={<EmptyState icon={Search} title={debounced ? "No registered student matches" : "Nobody is registered yet"} />}>
                <div className="checkin-list">
                    {data?.map((attendee) => (
                        <div key={attendee.registrationId} className={`checkin-row ${attendee.checkedInAt ? "is-checked" : ""}`}>
                            <Avatar name={attendee.name} size="sm" />
                            <div className="grow">
                                <strong>{attendee.name}</strong>
                                <span className="subtle small">
                                    {attendee.email}
                                    {detail(attendee) ? ` · ${detail(attendee)}` : ""}
                                </span>
                                {attendee.checkedInAt && (
                                    <span className="attendance-badge">
                                        <BadgeCheck size={13} /> Checked in {formatTime(attendee.checkedInAt)}
                                        {attendee.checkedInBy ? ` by ${attendee.checkedInBy}` : ""}
                                    </span>
                                )}
                            </div>
                            {attendee.checkedInAt ? (
                                <Button variant="ghost" size="sm" onClick={() => act(attendee, false)} disabled={busy}>
                                    <Undo2 size={14} /> Undo
                                </Button>
                            ) : (
                                <Button size="sm" onClick={() => act(attendee, true)} disabled={busy}>
                                    <UserCheck size={14} /> Mark attended
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            </AsyncContent>
        </div>
    );
};

const CodeTab = ({ onSubmit, busy }) => {
    const [code, setCode] = useState("");
    const submit = async (event) => {
        event.preventDefault();
        if (!code.trim()) {
            return;
        }
        await onSubmit(code.trim());
        setCode("");
    };
    return (
        <form className="checkin-code" onSubmit={submit}>
            <label className="field-label" htmlFor="ticket-code">
                Ticket code
            </label>
            <div className="checkin-code-row">
                <span className="checkin-code-prefix">
                    <Hash size={16} />
                </span>
                <input
                    id="ticket-code"
                    className="input checkin-code-input"
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="CC-7K3M 9QWA"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                />
                <Button type="submit" loading={busy} disabled={!code.trim()}>
                    <KeyRound size={16} /> Check in
                </Button>
            </div>
            <span className="field-hint">The code is printed under the QR on the student's ticket. Dashes and spaces don't matter.</span>
        </form>
    );
};

const TABS = [
    { value: "scan", label: "Scan QR", icon: ScanLine },
    { value: "search", label: "Search", icon: Search },
    { value: "code", label: "Enter code", icon: Hash }
];

/** The door: scan tickets, find students by name, and see who has arrived. */
const CheckInPage = () => {
    const { id } = useParams();
    const toast = useToast();
    const status = useApi(() => eventApi.checkIn(id), [id]);
    const [tab, setTab] = useState("scan");
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dialog, setDialog] = useState(null);
    const timer = useRef(null);
    const reloadRef = useRef(status.reload);
    reloadRef.current = status.reload;

    const data = status.data;
    const open = data?.checkIn?.status === "OPEN";

    // Several officers may be scanning at once: keep the counts in step.
    useEffect(() => {
        const poll = setInterval(() => document.visibilityState === "visible" && reloadRef.current({ silent: true }), POLL_MS);
        return () => clearInterval(poll);
    }, []);

    const show = useCallback((outcome) => {
        setResult(outcome);
        if (outcome.result === "CHECKED_IN") {
            navigator.vibrate?.(80);
        } else if (outcome.result !== "UNMARKED") {
            navigator.vibrate?.([60, 60, 60]);
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setResult(null), RESULT_MS);
        reloadRef.current({ silent: true });
    }, []);

    useEffect(() => () => clearTimeout(timer.current), []);

    // Runs one check-in action and shows its outcome; errors (e.g. check-in closed) go to a toast.
    const perform = useCallback(
        async (call) => {
            if (busy) {
                return;
            }
            setBusy(true);
            try {
                const response = await call();
                show(response.data);
            } catch (error) {
                toast.error(error);
                reloadRef.current({ silent: true });
            } finally {
                setBusy(false);
            }
        },
        [busy, show, toast]
    );

    const onDecode = useCallback((token) => perform(() => eventApi.scanTicket(id, { token })), [id, perform]);

    const toggle = async () => {
        const response = open ? await eventApi.closeCheckIn(id) : await eventApi.openCheckIn(id);
        toast.success(response.message);
        status.reload({ silent: true });
    };

    if (status.error) {
        return <ErrorState error={status.error} onRetry={status.reload} />;
    }

    return (
        <AsyncContent loading={status.loading && !data}>
            {data && (
                <>
                    <PageHeader
                        back={{ to: `/events/${id}`, label: "Back to event" }}
                        eyebrow={
                            <>
                                <ScanLine size={14} /> Check-in
                            </>
                        }
                        title={data.event.title}
                        description={`${formatDateTime(data.event.startAt)}${data.event.venue?.name ? ` · ${data.event.venue.name}` : ""}`}
                        actions={
                            <>
                                <Badge tone={open ? "success" : "neutral"}>{open ? "Check-in open" : data.checkIn?.status === "CLOSED" ? "Check-in closed" : "Not started"}</Badge>
                                {data.canManage && (
                                    <Button variant={open ? "secondary" : "accent"} onClick={() => setDialog(open ? "close" : "open")}>
                                        {open ? <Lock size={16} /> : <PlayCircle size={16} />} {open ? "Close check-in" : data.checkIn?.status === "CLOSED" ? "Reopen check-in" : "Start check-in"}
                                    </Button>
                                )}
                            </>
                        }
                    />

                    <div className="checkin-stats">
                        <div className="checkin-stat is-primary">
                            <span className="checkin-stat-value">{data.counts.attended}</span>
                            <span className="checkin-stat-label">checked in</span>
                        </div>
                        <div className="checkin-stat">
                            <span className="checkin-stat-value">{data.counts.registered}</span>
                            <span className="checkin-stat-label">registered</span>
                        </div>
                        <div className="checkin-stat">
                            <span className="checkin-stat-value">{data.counts.registered ? Math.round((data.counts.attended / data.counts.registered) * 100) : 0}%</span>
                            <span className="checkin-stat-label">turnout</span>
                        </div>
                        <div className="checkin-progress" aria-hidden="true">
                            <span style={{ width: `${data.counts.registered ? Math.min(100, (data.counts.attended / data.counts.registered) * 100) : 0}%` }} />
                        </div>
                    </div>

                    {!open ? (
                        <Card>
                            <EmptyState
                                icon={Lock}
                                title={data.checkIn?.status === "CLOSED" ? "Check-in is closed" : "Check-in hasn't started yet"}
                                description={
                                    data.canManage
                                        ? "Start check-in when the doors open. Every club officer can then scan tickets or mark students present."
                                        : "The club president starts check-in from the event page. You'll get a notification when it opens."
                                }
                                action={
                                    data.canManage ? (
                                        <Button variant="accent" onClick={() => setDialog("open")}>
                                            <PlayCircle size={16} /> {data.checkIn?.status === "CLOSED" ? "Reopen check-in" : "Start check-in"}
                                        </Button>
                                    ) : null
                                }
                            />
                        </Card>
                    ) : (
                        <div className="checkin-layout">
                            <div className="stack">
                                <Tabs tabs={TABS} value={tab} onChange={setTab} />
                                <ScanResult result={result} onDismiss={() => setResult(null)} />
                                {tab === "scan" && <ScanTab onDecode={onDecode} active={tab === "scan" && open} />}
                                {tab === "search" && <SearchTab eventId={id} onChange={perform} busy={busy} />}
                                {tab === "code" && <CodeTab onSubmit={(code) => perform(() => eventApi.scanTicket(id, { code }))} busy={busy} />}
                            </div>

                            <aside className="stack">
                                <Card title={<h2 className="row"><Users size={17} /> Recent check-ins</h2>} padded={false}>
                                    {data.recent.length ? (
                                        <div className="checkin-recent">
                                            {data.recent.map((attendee) => (
                                                <div key={attendee.registrationId} className="checkin-recent-row">
                                                    <Avatar name={attendee.name} size="sm" />
                                                    <div className="grow">
                                                        <strong>{attendee.name}</strong>
                                                        <span className="subtle small">
                                                            {formatTime(attendee.checkedInAt)} · {attendee.checkInMethod === "QR" ? "QR" : "manual"}
                                                            {attendee.checkedInBy ? ` · ${attendee.checkedInBy}` : ""}
                                                            {attendee.ticketCode ? ` · ${spacedCode(attendee.ticketCode)}` : ""}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="subtle small" style={{ margin: 0, padding: "16px 20px" }}>
                                            Nobody has been checked in yet. {plural(data.counts.registered, "student")} registered.
                                        </p>
                                    )}
                                </Card>
                                <Alert type="info">
                                    Scanning works from any phone: officers can open this page from the notification. Cancelled or replaced tickets are refused automatically.
                                </Alert>
                                <Link to={`/events/${id}/participants`} className="subtle small">
                                    Full participant list →
                                </Link>
                            </aside>
                        </div>
                    )}

                    <ConfirmDialog
                        open={dialog === "open"}
                        onClose={() => setDialog(null)}
                        onConfirm={toggle}
                        title={data.checkIn?.status === "CLOSED" ? "Reopen check-in?" : "Start check-in?"}
                        description="Every club officer will be notified and can scan tickets or mark students present from their phone."
                        confirmLabel={data.checkIn?.status === "CLOSED" ? "Reopen check-in" : "Start check-in"}
                        variant="accent"
                    />
                    <ConfirmDialog
                        open={dialog === "close"}
                        onClose={() => setDialog(null)}
                        onConfirm={toggle}
                        title="Close check-in?"
                        description="Scanning stops for everyone. You can reopen it later to make corrections."
                        confirmLabel="Close check-in"
                    />
                </>
            )}
        </AsyncContent>
    );
};

export default CheckInPage;
