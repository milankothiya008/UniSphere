import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/endpoints";
import { Alert, Button, Input } from "../../components/ui";
import { detectAccountType, EMAIL_FORMAT_HELP, isAdminEmail, STUDENT_EMAIL_EXAMPLE } from "../../lib/validation";

const LoginPage = () => {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    // Pre-filled when arriving from email verification or a password reset.
    const [form, setForm] = useState({ email: location.state?.email || "", password: "" });
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [sendingCode, setSendingCode] = useState(false);

    const [emailTouched, setEmailTouched] = useState(false);
    const knownFormat = (email) => Boolean(detectAccountType(email)) || isAdminEmail(email);
    const emailError = emailTouched && form.email.trim() && !knownFormat(form.email) ? EMAIL_FORMAT_HELP : null;

    const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

    const submit = async (event) => {
        event.preventDefault();
        setEmailTouched(true);
        if (!knownFormat(form.email)) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await login(form.email.trim(), form.password);
            navigate(location.state?.from || "/feed", { replace: true });
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    // Sends a fresh code (subject to the server's resend cooldown) and opens the code screen.
    const verifyNow = async () => {
        const email = form.email.trim().toLowerCase();
        setSendingCode(true);
        await authApi.resendVerification(email).catch(() => {});
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, { state: { sentAt: Date.now() } });
    };

    return (
        <>
            <h2>Welcome back</h2>
            <p className="lead">Sign in with your university email.</p>
            <form className="stack" onSubmit={submit} noValidate>
                {error && (
                    <Alert type="error" title={error.code === "UNVERIFIED_EMAIL" ? "Verify your email first" : undefined}>
                        {error.message}
                        {error.code === "UNVERIFIED_EMAIL" && (
                            <div style={{ marginTop: 8 }}>
                                <Button size="sm" onClick={verifyNow} loading={sendingCode}>
                                    <ShieldCheck size={14} /> Verify with a code
                                </Button>
                            </div>
                        )}
                    </Alert>
                )}
                <Input label="University email" type="email" autoComplete="email" placeholder={STUDENT_EMAIL_EXAMPLE} value={form.email} onChange={update("email")} onBlur={() => setEmailTouched(true)} error={emailError} required />
                <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={update("password")} required />
                <div className="row-between">
                    <span />
                    <Link to="/forgot-password" state={{ email: form.email.trim() }} className="small">
                        Forgot password?
                    </Link>
                </div>
                <Button type="submit" size="lg" block loading={pending} disabled={!form.email || !form.password}>
                    <LogIn size={17} /> Sign in
                </Button>
            </form>
            <p className="auth-footer">
                New to CampusConnect? <Link to="/register">Create an account</Link>
            </p>
        </>
    );
};

export default LoginPage;
