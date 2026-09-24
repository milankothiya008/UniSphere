import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardList, Download, Hourglass, UserMinus } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Avatar, Button, CapacityBar, Card, ConfirmDialog, EmptyState, PageHeader, SearchInput, StatusBadge } from "../../components/ui";
import { batchLabel, formatDateTime } from "../../lib/format";

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

// Replaces the spreadsheet clubs used to maintain by hand.
const downloadCsv = (event, rows) => {
    const header = ["Name", "Email", "Department", "Batch", "Registered at"];
    const lines = rows.map((r) => [r.user.name, r.user.email, r.user.departmentCode, batchLabel(r.user.batchCode), formatDateTime(r.registeredAt)]);
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n");
    // Leading byte-order mark so Excel opens the UTF-8 file with the right encoding.
    const blob = new Blob([String.fromCharCode(0xfeff), csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${event.title.replace(/[^\w-]+/g, "_")}_participants.csv`;
    link.click();
    URL.revokeObjectURL(url);
};

const ParticipantsPage = () => {
    const { id } = useParams();
    const toast = useToast();
    const [search, setSearch] = useState("");
    const [removing, setRemoving] = useState(null);

    const eventState = useApi(() => eventApi.get(id), [id]);
    const participants = useApi(() => eventApi.participants(id), [id]);

    const event = eventState.data;
    const rows = useMemo(() => participants.data || [], [participants.data]);
    const waitlist = useMemo(() => participants.meta?.waitlist || [], [participants.meta]);
    const canManage = event?.viewer?.canManageParticipants && event?.status === "PUBLISHED";

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) {
            return rows;
        }
        return rows.filter((row) => row.user.name.toLowerCase().includes(term) || row.user.email.toLowerCase().includes(term));
    }, [rows, search]);

    const remove = async (reason) => {
        await eventApi.removeParticipant(id, removing._id, reason || undefined);
        toast.success(removing.status === "WAITLISTED" ? `${removing.user.name} was removed from the waitlist` : `${removing.user.name} was removed — the next student on the waitlist gets the seat`);
        participants.reload({ silent: true });
        eventState.reload({ silent: true });
    };

    return (
        <AsyncContent loading={eventState.loading} error={eventState.error || participants.error} onRetry={participants.reload}>
            {event && (
                <>
                    <PageHeader
                        back={{ to: `/events/${id}`, label: "Back to event" }}
                        eyebrow={<><ClipboardList size={14} /> Participants</>}
                        title={event.title}
                        description={`${event.club.name} · ${formatDateTime(event.startAt)}`}
                        actions={
                            <>
                                <StatusBadge status={event.status} />
                                <Button variant="secondary" onClick={() => downloadCsv(event, rows)} disabled={!rows.length}>
                                    <Download size={16} /> Export CSV
                                </Button>
                            </>
                        }
                    />

                    <div className="stack">
                        <Card>
                            <div className="stack-sm">
                                <CapacityBar registered={event.registeredCount} max={event.maxParticipants} />
                                {waitlist.length > 0 && (
                                    <span className="subtle row" style={{ gap: 6 }}>
                                        <Hourglass size={13} /> {waitlist.length} waiting · freed seats go to them automatically, in order
                                    </span>
                                )}
                            </div>
                        </Card>

                        <Card padded={false} title={`${rows.length} registered`} actions={<div style={{ width: 280, maxWidth: "100%" }}><SearchInput value={search} onChange={setSearch} placeholder="Search participants" /></div>}>
                            <AsyncContent
                                loading={participants.loading}
                                isEmpty={!filtered.length}
                                empty={<EmptyState icon={ClipboardList} title={rows.length ? "No matches" : "No registrations yet"} description={rows.length ? "Try a different search." : "Registrations appear here as students sign up."} />}
                            >
                                <div className="table-wrap">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Student</th>
                                                <th>Department</th>
                                                <th>Batch</th>
                                                <th>Registered</th>
                                                {canManage && <th />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filtered.map((row, index) => (
                                                <tr key={row._id}>
                                                    <td className="subtle">{index + 1}</td>
                                                    <td>
                                                        <div className="row" style={{ flexWrap: "nowrap" }}>
                                                            <Avatar name={row.user.name} size="sm" />
                                                            <div>
                                                                <strong>{row.user.name}</strong>
                                                                <div className="subtle">{row.user.email}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>{row.user.departmentCode}</td>
                                                    <td>{batchLabel(row.user.batchCode)}</td>
                                                    <td className="nowrap">{formatDateTime(row.registeredAt)}</td>
                                                    {canManage && (
                                                        <td className="actions">
                                                            <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
                                                                <UserMinus size={14} /> Remove
                                                            </Button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </AsyncContent>
                        </Card>

                        {waitlist.length > 0 && (
                            <Card padded={false} title={<h2 className="row"><Hourglass size={17} /> Waitlist · {waitlist.length}</h2>}>
                                <div className="table-wrap">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Place</th>
                                                <th>Student</th>
                                                <th>Department</th>
                                                <th>Batch</th>
                                                <th>Joined waitlist</th>
                                                {canManage && <th />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {waitlist.map((row) => (
                                                <tr key={row._id}>
                                                    <td>
                                                        <strong>#{row.position}</strong>
                                                    </td>
                                                    <td>
                                                        <div className="row" style={{ flexWrap: "nowrap" }}>
                                                            <Avatar name={row.user.name} size="sm" />
                                                            <div>
                                                                <strong>{row.user.name}</strong>
                                                                <div className="subtle">{row.user.email}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>{row.user.departmentCode}</td>
                                                    <td>{batchLabel(row.user.batchCode)}</td>
                                                    <td className="nowrap">{formatDateTime(row.waitlistedAt)}</td>
                                                    {canManage && (
                                                        <td className="actions">
                                                            <Button variant="ghost" size="sm" onClick={() => setRemoving(row)}>
                                                                <UserMinus size={14} /> Remove
                                                            </Button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        )}
                    </div>

                    <ConfirmDialog
                        open={Boolean(removing)}
                        onClose={() => setRemoving(null)}
                        onConfirm={remove}
                        title={`Remove ${removing?.user.name}?`}
                        description={
                            removing?.status === "WAITLISTED"
                                ? "They lose their place on the waitlist and are notified by email."
                                : waitlist.length
                                  ? "Their seat goes to the first student on the waitlist, and both are notified by email."
                                  : "Their seat is released and they are notified by email."
                        }
                        confirmLabel="Remove"
                        variant="danger"
                        reasonLabel="Reason (shared with the student)"
                    />
                </>
            )}
        </AsyncContent>
    );
};

export default ParticipantsPage;
