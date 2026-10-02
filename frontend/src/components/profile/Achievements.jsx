import { useState } from "react";
import { Link } from "react-router-dom";
import { Award, Download, FileText } from "lucide-react";
import { certificateApi, userApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useToast } from "../../context/ToastContext";
import { AsyncContent, Button, Card, EmptyState, Skeleton } from "../ui";
import { formatDate } from "../../lib/format";

/**
 * Profile → Achievements: the participation record (a PDF for placements and scholarships) and every
 * certificate the student has earned.
 */
export const Achievements = () => {
    const toast = useToast();
    const { data, loading, error, reload } = useApi(() => certificateApi.mine(), []);
    const [busy, setBusy] = useState(null);

    const run = async (key, task) => {
        setBusy(key);
        try {
            await task();
        } catch (err) {
            toast.error(err);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="stack-lg">
            <Card className="record-card">
                <div className="record-row">
                    <span className="record-icon">
                        <FileText size={22} />
                    </span>
                    <span className="grow">
                        <strong>Participation record</strong>
                        <span className="subtle small">Your clubs and roles, events you took part in, awards and certificates — one PDF for placement and scholarship forms.</span>
                    </span>
                    <Button onClick={() => run("record", () => userApi.downloadRecord())} loading={busy === "record"}>
                        <Download size={16} /> Download PDF
                    </Button>
                </div>
            </Card>

            <Card
                title={
                    <h2 className="row">
                        <Award size={18} color="var(--gold-600)" /> Certificates
                    </h2>
                }
                padded={false}
            >
                <AsyncContent loading={loading} error={error} onRetry={reload} skeleton={<Skeleton height={80} />}>
                    {data?.length ? (
                        <div className="cert-list">
                            {data.map((item) => (
                                <div key={item.code} className={`cert-row ${item.kind === "MERIT" ? "is-merit" : ""}`}>
                                    <span className="cert-icon">
                                        <Award size={20} />
                                    </span>
                                    <span className="cert-body">
                                        <strong>{item.kind === "MERIT" ? `Merit — ${item.awardTitle}` : "Participation"}</strong>
                                        <Link to={`/events/${item.event}`} className="small">
                                            {item.eventTitle}
                                        </Link>
                                        <span className="subtle small">
                                            {item.clubName} · {formatDate(item.eventStartAt)} · {item.code}
                                        </span>
                                    </span>
                                    <Button size="sm" variant="secondary" onClick={() => run(item.code, () => certificateApi.download(item.code))} loading={busy === item.code}>
                                        <Download size={15} /> PDF
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState icon={Award} title="No certificates yet" description="Events that give certificates list them here after you attend — and when you win." />
                    )}
                </AsyncContent>
            </Card>
        </div>
    );
};
