import { useParams } from "react-router-dom";
import { BadgeCheck, ShieldX } from "lucide-react";
import { certificateApi } from "../api/endpoints";
import { useApi } from "../hooks/useApi";
import { PageLoader } from "../components/ui";
import { formatDate } from "../lib/format";

// Opened from the QR code on a certificate. Public: an employer or scholarship office can check that a
// certificate is genuine without an account.
const VerifyCertificatePage = () => {
    const { code } = useParams();
    const { data, loading, error } = useApi(() => certificateApi.verify(code), [code]);

    if (loading) return <PageLoader label="Checking the certificate…" />;

    if (error || !data?.valid) {
        return (
            <div className="stack">
                <div className="state-icon" style={{ background: "var(--danger-100)", color: "var(--danger-600)", width: 56, height: 56 }}>
                    <ShieldX size={26} />
                </div>
                <h2>{data?.revoked ? "This certificate was withdrawn" : "Certificate not found"}</h2>
                <p className="muted">
                    {data?.revoked
                        ? "It was issued by CampusConnect but is no longer valid."
                        : `No CampusConnect certificate has the ID ${String(code).toUpperCase()}. Check the ID printed under the QR code.`}
                </p>
            </div>
        );
    }

    const when = formatDate(data.eventStartAt) === formatDate(data.eventEndAt) ? formatDate(data.eventStartAt) : `${formatDate(data.eventStartAt)} – ${formatDate(data.eventEndAt)}`;
    return (
        <div className="stack verify-cert">
            <div className="state-icon" style={{ background: "var(--success-100)", color: "var(--success-600)", width: 56, height: 56 }}>
                <BadgeCheck size={28} />
            </div>
            <h2>Genuine certificate</h2>
            <dl className="verify-cert-facts">
                <div>
                    <dt>Awarded to</dt>
                    <dd>{data.recipientName}</dd>
                </div>
                <div>
                    <dt>Certificate</dt>
                    <dd>{data.kind === "MERIT" ? `Merit — ${data.awardTitle}` : "Participation"}</dd>
                </div>
                {data.teamName && (
                    <div>
                        <dt>Team</dt>
                        <dd>{data.teamName}</dd>
                    </div>
                )}
                <div>
                    <dt>Event</dt>
                    <dd>
                        {data.eventTitle}
                        <span className="subtle small" style={{ display: "block" }}>
                            {data.clubName} · {when}
                        </span>
                    </dd>
                </div>
                <div>
                    <dt>Issued</dt>
                    <dd>
                        {formatDate(data.issuedAt)} · {data.code}
                    </dd>
                </div>
            </dl>
        </div>
    );
};

export default VerifyCertificatePage;
