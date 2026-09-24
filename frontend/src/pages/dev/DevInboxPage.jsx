import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Inbox, Mail, RefreshCw } from "lucide-react";
import { systemApi } from "../../api/endpoints";
import { useApi } from "../../hooks/useApi";
import { useEmailDelivery } from "../../hooks/useEmailDelivery";
import { Alert, AsyncContent, Badge, Button, Card, EmptyState } from "../../components/ui";
import { formatDateTime, timeAgo } from "../../lib/format";

// Links in emails point at the configured CLIENT_URL; open them inside this app when they belong to it.
const toAppPath = (href) => {
    try {
        const url = new URL(href);
        return url.pathname.startsWith("/api/") ? null : `${url.pathname}${url.search}`;
    } catch {
        return null;
    }
};

const DevInboxPage = () => {
    const [params, setParams] = useSearchParams();
    const to = params.get("to") || "";
    const mode = useEmailDelivery();
    const { data, loading, error, reload } = useApi(() => systemApi.devEmails(to || undefined), [to], { enabled: mode === "preview" });

    return (
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 16px" }}>
            <Link to="/login" className="back-link">
                <ArrowLeft size={15} /> Back to CampusConnect
            </Link>
            <div className="page-header">
                <div>
                    <div className="eyebrow">
                        <Inbox size={14} /> Development only
                    </div>
                    <h1>Development inbox</h1>
                    <p>
                        This server has no email (SMTP) settings, so messages are kept here instead of being sent. Configure SMTP in
                        <code> backend/.env</code> to deliver real emails — this page then switches off.
                    </p>
                </div>
                {mode === "preview" && (
                    <Button variant="secondary" onClick={() => reload()}>
                        <RefreshCw size={15} /> Refresh
                    </Button>
                )}
            </div>

            {mode === null && <Alert type="info">Checking the server's email settings…</Alert>}
            {(mode === "smtp" || mode === "disabled") && (
                <Alert type="info" title="Not available">
                    {mode === "smtp" ? "This server delivers real emails — check your university inbox." : "The development inbox is disabled on this server."}
                </Alert>
            )}

            {mode === "preview" && (
                <div className="stack">
                    {to && (
                        <div className="row">
                            <Badge tone="ink">
                                <Mail size={12} /> {to}
                            </Badge>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
                                Show all emails
                            </button>
                        </div>
                    )}
                    <AsyncContent
                        loading={loading}
                        error={error}
                        onRetry={reload}
                        isEmpty={!data?.length}
                        empty={
                            <Card>
                                <EmptyState
                                    icon={Inbox}
                                    title="No emails yet"
                                    description={
                                        to
                                            ? "Nothing has been sent to this address since the server started. Register again or use “Send a new code” on the verification screen."
                                            : "Emails appear here as the app sends them. The inbox is cleared when the backend restarts."
                                    }
                                />
                            </Card>
                        }
                    >
                        {data?.map((mail) => (
                            <Card key={mail.id}>
                                <div className="stack-sm">
                                    <div className="row-between">
                                        <strong>{mail.subject}</strong>
                                        <span className="subtle" title={formatDateTime(mail.sentAt)}>
                                            {timeAgo(mail.sentAt)}
                                        </span>
                                    </div>
                                    <span className="subtle">To: {mail.to}</span>
                                    <p className="small muted pre-line" style={{ wordBreak: "break-word" }}>
                                        {mail.text}
                                    </p>
                                    {mail.code && (
                                        <div className="dev-code">
                                            <span className="subtle">One-time code</span>
                                            <code>{mail.code}</code>
                                        </div>
                                    )}
                                    {mail.links.length > 0 && (
                                        <div className="row">
                                            {mail.links.map((href) => {
                                                const path = toAppPath(href);
                                                return path ? (
                                                    <Link key={href} to={path} className="btn btn-primary btn-sm">
                                                        Open link
                                                    </Link>
                                                ) : (
                                                    <a key={href} href={href} className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer">
                                                        <ExternalLink size={14} /> Open link
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </AsyncContent>
                </div>
            )}
        </div>
    );
};

export default DevInboxPage;
