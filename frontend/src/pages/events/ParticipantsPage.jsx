import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ClipboardList, Crown, Download, Hourglass, UserMinus, Users } from "lucide-react";
import { eventApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Avatar, Badge, Button, CapacityBar, Card, ConfirmDialog, EmptyState, PageHeader, SearchInput, StatusBadge } from "../../components/ui";
import { batchLabel, formatDateTime } from "../../lib/format";

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

// Replaces the spreadsheet clubs used to maintain by hand.
const downloadCsv = (event, rows, withTeams) => {
    const header = [...(withTeams ? ["Team", "Role"] : []), "Name", "Email", "Department", "Batch", "Registered at"];
    const lines = rows.map((r) => [
        ...(withTeams ? [r.team?.name || "", r.teamRole === "LEADER" ? "Leader" : "Member"] : []),
        r.user.name,
        r.user.email,
        r.user.departmentCode,
        batchLabel(r.user.batchCode),
        formatDateTime(r.registeredAt)
    ]);
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

// One team at a glance: members, pending invites, and whether it has reached the minimum size.
const TeamSummary = ({ team }) => (
    <div className={`team-summary ${team.complete ? "" : "is-incomplete"}`}>
        <div className="team-summary-head">
            <strong>{team.name}</strong>
            {team.registrationStatus === "WAITLISTED" ? (
                <Badge tone="warning">Waitlisted</Badge>
            ) : team.complete ? (
                <Badge tone="success">Complete</Badge>
            ) : (
                <Badge tone="danger">Incomplete</Badge>
            )}
        </div>
        <span className="subtle small">
            {team.size} / {team.maxSize} members{team.complete ? "" : ` · needs ${team.minSize - team.size} more`}
            {team.invites.length ? ` · ${team.invites.length} invite${team.invites.length === 1 ? "" : "s"} pending` : ""}
        </span>
        <div className="team-summary-members">
            {team.members.map((member) => (
                <span key={member.user._id} title={member.user.email}>
                    {member.status === "LEADER" && <Crown size={12} />} {member.user.name}
                </span>
            ))}
        </div>
    </div>
);

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
    const teams = useMemo(() => participants.meta?.teams || [], [participants.meta]);
    const isTeamEvent = event?.participationMode === "TEAM";

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) {
            return rows;
        }
        return rows.filter(
            (row) => row.user.name.toLowerCase().includes(term) || row.user.email.toLowerCase().includes(term) || (row.team?.name || "").toLowerCase().includes(term)
        );
    }, [rows, search]);

    const remove = async (reason) => {
        await eventApi.removeParticipant(id, removing._id, reason || undefined);
        toast.success(
            removing.teamRole === "LEADER"
                ? `Team "${removing.team?.name}" was removed`
                : removing.teamRole === "MEMBER"
                  ? `${removing.user.name} was removed from "${removing.team?.name}"`
                  : removing.status === "WAITLISTED"
                    ? `${removing.user.name} was removed from the waitlist`
                    : `${removing.user.name} was removed — the next student on the waitlist gets the seat`
        );
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
                                <Button variant="secondary" onClick={() => downloadCsv(event, rows, isTeamEvent)} disabled={!rows.length}>
                                    <Download size={16} /> Export CSV
                                </Button>
                            </>
                        }
                    />

                    <div className="stack">
                        <Card>
                            <div className="stack-sm">
                                <CapacityBar registered={event.registeredCount} max={event.maxParticipants} teams={isTeamEvent} />
                                {waitlist.length > 0 && (
                                    <span className="subtle row" style={{ gap: 6 }}>
                                        <Hourglass size={13} /> {waitlist.length} waiting · freed {isTeamEvent ? "places go to the next team" : "seats go to them"} automatically, in order
                                    </span>
                                )}
                            </div>
                        </Card>

                        {isTeamEvent && teams.length > 0 && (
                            <Card
                                title={
                                    <h2 className="row">
                                        <Users size={18} /> Teams · {teams.length}
                                    </h2>
                                }
                                actions={
                                    teams.some((team) => !team.complete) ? (
                                        <Badge tone="danger">{teams.filter((team) => !team.complete).length} incomplete</Badge>
                                    ) : (
                                        <Badge tone="success">All complete</Badge>
                                    )
                                }
                            >
                                <p className="subtle small" style={{ marginTop: 0 }}>
                                    Teams of {event.minTeamSize}–{event.maxTeamSize}. Incomplete teams haven't reached the minimum size yet.
                                </p>
                                <div className="team-summary-grid">
                                    {teams.map((team) => (
                                        <TeamSummary key={team._id} team={team} />
                                    ))}
                                </div>
                            </Card>
                        )}

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
                                                {isTeamEvent && <th>Team</th>}
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
                                                    {isTeamEvent && (
                                                        <td>
                                                            <strong>{row.team?.name}</strong>
                                                            {row.teamRole === "LEADER" && (
                                                                <div className="subtle row" style={{ gap: 4 }}>
                                                                    <Crown size={12} /> Leader
                                                                </div>
                                                            )}
                                                        </td>
                                                    )}
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
                                                <th>{isTeamEvent ? "Team leader" : "Student"}</th>
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
                                                                <strong>{row.team ? `${row.team.name} · ${row.user.name}` : row.user.name}</strong>
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
                        title={removing?.teamRole === "LEADER" ? `Remove team "${removing?.team?.name}"?` : `Remove ${removing?.user.name}?`}
                        description={
                            removing?.teamRole === "LEADER"
                                ? "Removing the leader removes the whole team: every member's registration is cancelled and they're notified by email."
                                : removing?.teamRole === "MEMBER"
                                  ? "They're removed from the team (which keeps its place) and notified by email."
                                  : removing?.status === "WAITLISTED"
                                ? "They lose their place on the waitlist and are notified by email."
                                : waitlist.length
                                  ? "Their seat goes to the first student on the waitlist, and both are notified by email."
                                  : "Their seat is released and they are notified by email."
                        }
                        confirmLabel="Remove"
                        variant="danger"
                        reasonLabel={removing?.teamRole ? "Reason (shared with the team)" : "Reason (shared with the student)"}
                    />
                </>
            )}
        </AsyncContent>
    );
};

export default ParticipantsPage;
