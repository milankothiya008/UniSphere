import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BellOff, CheckCircle2, MailWarning } from "lucide-react";
import { notificationApi } from "../api/endpoints";
import { Alert, Button, PageLoader } from "../components/ui";

// Opened from the link at the bottom of an email. Works without signing in; nothing changes until
// the person confirms, so link scanners that open every URL cannot unsubscribe anyone.
const UnsubscribePage = () => {
    const [params] = useSearchParams();
    const token = params.get("token") || "";
    const [state, setState] = useState(token ? "loading" : "invalid");
    const [details, setDetails] = useState(null);
    const [error, setError] = useState(null);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (!token) {
            return;
        }
        let active = true;
        notificationApi
            .describeUnsubscribe(token)
            .then((response) => {
                if (active) {
                    setDetails(response.data);
                    setState("confirm");
                }
            })
            .catch(() => active && setState("invalid"));
        return () => {
            active = false;
        };
    }, [token]);

    const confirm = async () => {
        setPending(true);
        setError(null);
        try {
            await notificationApi.unsubscribe(token);
            setState("done");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    if (state === "loading") {
        return <PageLoader label="Checking your link…" />;
    }

    if (state === "invalid") {
        return (
            <div className="stack">
                <div className="state-icon" style={{ background: "var(--warning-100)", color: "var(--warning-600)", width: 56, height: 56 }}>
                    <MailWarning size={26} />
                </div>
                <h2>This link doesn't work</h2>
                <p className="muted">The unsubscribe link is incomplete or has been changed. Sign in to manage your email settings instead.</p>
                <Link to="/settings/notifications" className="btn btn-primary">
                    Email settings
                </Link>
            </div>
        );
    }

    if (state === "done") {
        return (
            <div className="stack">
                <div className="state-icon" style={{ background: "var(--success-100)", color: "var(--success-600)", width: 56, height: 56 }}>
                    <CheckCircle2 size={28} />
                </div>
                <h2>You're unsubscribed</h2>
                <p className="muted">
                    You won't get <strong>{details.label.toLowerCase()}</strong> at {details.email} any more. Account emails such as verification codes still reach you.
                </p>
                <Link to="/settings/notifications" className="btn btn-secondary">
                    Manage all email settings
                </Link>
            </div>
        );
    }

    return (
        <div className="stack">
            <div className="state-icon" style={{ width: 56, height: 56 }}>
                <BellOff size={26} />
            </div>
            <h2>Unsubscribe?</h2>
            <p className="muted">
                Stop sending <strong>{details.label}</strong> to {details.email}.
                {details.description ? ` (${details.description})` : ""}
            </p>
            {error && <Alert type="error">{error.message}</Alert>}
            <Button size="lg" block onClick={confirm} loading={pending}>
                <BellOff size={16} /> Unsubscribe
            </Button>
            <Link to="/settings/notifications" className="small" style={{ textAlign: "center" }}>
                Choose which emails you get instead
            </Link>
        </div>
    );
};

export default UnsubscribePage;
