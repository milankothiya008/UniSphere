import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Check, CheckCircle2, KeyRound, Send } from "lucide-react";
import { authApi } from "../../api/endpoints";
import { Alert, Button, Input } from "../../components/ui";
import { DEFAULT_OTP_POLICY, OtpForm } from "../../components/auth/OtpForm";
import { passwordProblems } from "../../lib/validation";

const STEPS = [
    { key: "email", label: "Email" },
    { key: "code", label: "Code" },
    { key: "password", label: "New password" }
];

const StepIndicator = ({ current }) => {
    const currentIndex = STEPS.findIndex((step) => step.key === current);
    return (
        <ol className="auth-steps" aria-label="Password reset progress">
            {STEPS.map((step, index) => {
                const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
                return (
                    <li key={step.key} className={`auth-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
                        <span className="auth-step-dot">{state === "done" ? <Check size={12} /> : index + 1}</span>
                        <span className="auth-step-label">{step.label}</span>
                    </li>
                );
            })}
        </ol>
    );
};

const ForgotPasswordPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [step, setStep] = useState("email");
    const [email, setEmail] = useState(location.state?.email || "");
    const [policy, setPolicy] = useState(DEFAULT_OTP_POLICY);
    const [sentAt, setSentAt] = useState(null);
    const [resetToken, setResetToken] = useState(null);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const problems = passwordProblems(password);
    const mismatch = confirm && confirm !== password;
    const address = email.trim().toLowerCase();

    const sendCode = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await authApi.forgotPassword(address);
            setPolicy(response?.data?.otp || DEFAULT_OTP_POLICY);
            setSentAt(Date.now());
            setStep("code");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    const confirmCode = async (code) => {
        const response = await authApi.verifyResetCode(address, code);
        setResetToken(response.data.resetToken);
        setError(null);
        setStep("password");
    };

    const savePassword = async (event) => {
        event.preventDefault();
        if (problems.length || mismatch) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await authApi.resetPassword(resetToken, password);
            setResetToken(null);
            setStep("done");
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    const startOver = () => {
        setStep("email");
        setResetToken(null);
        setPassword("");
        setConfirm("");
        setError(null);
    };

    if (step === "done") {
        return (
            <div className="stack">
                <div className="state-icon" style={{ background: "var(--success-100)", color: "var(--success-600)", width: 56, height: 56 }}>
                    <CheckCircle2 size={28} />
                </div>
                <h2>Password updated</h2>
                <p className="muted">For your security, all existing sessions were signed out. Sign in with your new password.</p>
                <Button size="lg" block onClick={() => navigate("/login", { state: { email: address } })}>
                    Sign in
                </Button>
            </div>
        );
    }

    return (
        <>
            <h2>Reset your password</h2>
            <StepIndicator current={step} />

            {step === "email" && (
                <>
                    <p className="lead">Enter your university email and we'll send you a {policy.length}-digit reset code.</p>
                    <form className="stack" onSubmit={sendCode}>
                        {error && <Alert type="error">{error.message}</Alert>}
                        <Input label="University email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
                        <Button type="submit" size="lg" block loading={pending} disabled={!address}>
                            <Send size={16} /> Send code
                        </Button>
                    </form>
                </>
            )}

            {step === "code" && (
                <>
                    <OtpForm
                        email={address}
                        policy={policy}
                        sentAt={sentAt}
                        submitLabel="Continue"
                        onVerify={confirmCode}
                        onResend={() => authApi.forgotPassword(address)}
                    />
                    <p className="auth-footer">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={startOver}>
                            Use a different email
                        </button>
                    </p>
                </>
            )}

            {step === "password" && (
                <>
                    <p className="lead">Code confirmed. Choose a new password with at least 8 characters, a letter and a number.</p>
                    <form className="stack" onSubmit={savePassword}>
                        {error && (
                            <Alert type="error">
                                {error.message}{" "}
                                {error.code === "TOKEN_INVALID" && (
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={startOver} style={{ padding: 0, height: "auto" }}>
                                        Start again
                                    </button>
                                )}
                            </Alert>
                        )}
                        <Input
                            label="New password"
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            error={password && problems.length ? `Needs ${problems.join(", ")}` : null}
                            required
                            autoFocus
                        />
                        <Input
                            label="Confirm new password"
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={(event) => setConfirm(event.target.value)}
                            error={mismatch ? "Passwords do not match" : null}
                            required
                        />
                        <Button type="submit" size="lg" block loading={pending} disabled={!password || problems.length > 0 || !confirm || mismatch}>
                            <KeyRound size={16} /> Update password
                        </Button>
                    </form>
                </>
            )}

            <p className="auth-footer">
                Remembered it? <Link to="/login">Sign in</Link>
            </p>
        </>
    );
};

export default ForgotPasswordPage;
