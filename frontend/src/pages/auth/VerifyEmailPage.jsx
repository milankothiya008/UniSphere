import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, MailCheck, Send } from "lucide-react";
import { authApi } from "../../api/endpoints";
import { Alert, Button, Input } from "../../components/ui";
import { DEFAULT_OTP_POLICY, OtpForm } from "../../components/auth/OtpForm";

const VerifyEmailPage = () => {
    const [params, setParams] = useSearchParams();
    const location = useLocation();
    const navigate = useNavigate();
    const email = (params.get("email") || "").trim().toLowerCase();
    const policy = location.state?.otp || DEFAULT_OTP_POLICY;
    const [sentAt, setSentAt] = useState(location.state?.sentAt || null);
    const [verified, setVerified] = useState(false);
    const [draft, setDraft] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const verify = async (code) => {
        await authApi.verifyEmail(email, code);
        setVerified(true);
    };

    // Without an address in the URL (e.g. an old bookmarked link), ask for it and send a fresh code.
    const requestCode = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            await authApi.resendVerification(draft.trim());
            setSentAt(Date.now());
            setParams({ email: draft.trim().toLowerCase() });
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    if (verified) {
        return (
            <div className="stack">
                <div className="state-icon" style={{ background: "var(--success-100)", color: "var(--success-600)", width: 56, height: 56 }}>
                    <CheckCircle2 size={28} />
                </div>
                <h2>Email verified</h2>
                <p className="muted">Your account is active. Sign in to explore clubs and events.</p>
                <Button size="lg" block onClick={() => navigate("/login", { state: { email } })}>
                    Sign in
                </Button>
            </div>
        );
    }

    if (!email) {
        return (
            <>
                <h2>Verify your email</h2>
                <p className="lead">Enter your university email and we'll send you a {policy.length}-digit verification code.</p>
                <form className="stack" onSubmit={requestCode}>
                    {error && <Alert type="error">{error.message}</Alert>}
                    <Input label="University email" type="email" autoComplete="email" value={draft} onChange={(event) => setDraft(event.target.value)} required />
                    <Button type="submit" size="lg" block loading={pending} disabled={!draft.trim()}>
                        <Send size={16} /> Send code
                    </Button>
                </form>
                <p className="auth-footer">
                    <Link to="/login">Back to sign in</Link>
                </p>
            </>
        );
    }

    return (
        <>
            <div className="state-icon" style={{ width: 52, height: 52, marginBottom: 14 }}>
                <MailCheck size={24} />
            </div>
            <h2>Check your email</h2>
            <p className="lead" style={{ marginBottom: 16 }}>
                One last step to activate your account.
            </p>
            <OtpForm
                email={email}
                policy={policy}
                sentAt={sentAt}
                submitLabel="Verify email"
                onVerify={verify}
                onResend={() => authApi.resendVerification(email)}
            />
            <p className="auth-footer">
                Wrong email? <Link to="/register">Register again</Link> · <Link to="/login">Sign in</Link>
            </p>
        </>
    );
};

export default VerifyEmailPage;
