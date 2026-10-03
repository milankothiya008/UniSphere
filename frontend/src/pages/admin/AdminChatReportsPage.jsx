import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Flag } from "lucide-react";
import { chatApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Avatar, Badge, Button, Card, EmptyState, Input, PageHeader, Tabs } from "../../components/ui";
import { formatDateTime } from "../../lib/format";

/** University admin: chat messages people reported, with the text as it was when reported. */
const AdminChatReportsPage = () => {
    const toast = useToast();
    const [status, setStatus] = useState("OPEN");
    const { data, loading, error, reload } = useApi(() => chatApi.reports(status), [status]);
    const [notes, setNotes] = useState({});

    const resolve = async (report) => {
        try {
            await chatApi.resolveReport(report._id, notes[report._id] || "");
            toast.success("Marked as handled");
            reload({ silent: true });
        } catch (err) {
            toast.error(err);
        }
    };

    const rows = data || [];
    return (
        <>
            <PageHeader title="Chat reports" />
            <p className="subtle" style={{ marginTop: -8 }}>
                Messages students and faculty reported. Contact the sender, or deactivate their account from Users if it's serious.
            </p>
            <Tabs
                value={status}
                onChange={setStatus}
                tabs={[
                    { value: "OPEN", label: "Open" },
                    { value: "RESOLVED", label: "Handled" },
                    { value: "ALL", label: "All" }
                ]}
            />
            <AsyncContent
                loading={loading}
                error={error}
                onRetry={reload}
                isEmpty={!rows.length}
                empty={<EmptyState icon={Flag} title={status === "OPEN" ? "Nothing to review" : "No reports"} />}
            >
                <div className="stack">
                    {rows.map((report) => (
                        <Card key={report._id}>
                            <div className="stack-sm">
                                <div className="row" style={{ justifyContent: "space-between" }}>
                                    <span className="row" style={{ gap: 10 }}>
                                        <Avatar name={report.sender?.name} src={report.sender?.avatar} />
                                        <span>
                                            <strong>
                                                {report.sender ? <Link to={`/people/${report.sender._id}`}>{report.sender.name}</Link> : "Unknown sender"}
                                            </strong>
                                            <span className="subtle small" style={{ display: "block" }}>
                                                {report.sender?.email} · reported by {report.reporter?.name} · {formatDateTime(report.createdAt)}
                                            </span>
                                        </span>
                                    </span>
                                    {report.status === "OPEN" ? <Badge tone="danger">Open</Badge> : <Badge tone="success">Handled</Badge>}
                                </div>
                                <blockquote className="report-quote">
                                    {report.text || <em className="subtle">No text</em>}
                                    {report.attachmentCount > 0 && <span className="subtle small"> · {report.attachmentCount} attachment(s)</span>}
                                </blockquote>
                                {report.reason && (
                                    <span className="small">
                                        <strong>Reason:</strong> {report.reason}
                                    </span>
                                )}
                                {report.status === "OPEN" ? (
                                    <div className="row" style={{ alignItems: "flex-end" }}>
                                        <div style={{ flex: 1, minWidth: 200 }}>
                                            <Input
                                                label="Note (optional)"
                                                value={notes[report._id] || ""}
                                                onChange={(event) => setNotes((current) => ({ ...current, [report._id]: event.target.value }))}
                                                maxLength={500}
                                                placeholder="What was done"
                                            />
                                        </div>
                                        <Button onClick={() => resolve(report)}>
                                            <CheckCircle2 size={16} /> Mark handled
                                        </Button>
                                    </div>
                                ) : (
                                    report.note && <span className="subtle small">Note: {report.note}</span>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            </AsyncContent>
        </>
    );
};

export default AdminChatReportsPage;
