import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, Button } from "../ui";
import { DevMailNotice } from "../DevMailNotice";
import { OtpInput } from "./OtpInput";

export const DEFAULT_OTP_POLICY = { length: 6, expiresInMinutes: 10, resendAfterSeconds: 60 };

const secondsUntil = (timestamp) => Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));

// Counts down to `until` (a ms timestamp), re-rendering once a second while it runs.
const useSecondsLeft = (until) => {
    const [left, setLeft] = useState(() => secondsUntil(until));

    useEffect(() => {
        setLeft(secondsUntil(until));
        if (secondsUntil(until) === 0) {
            return undefined;
        }
        const timer = setInterval(() => {
            const next = secondsUntil(until);
            setLeft(next);
            if (next === 0) {
                clearInterval(timer);
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [until]);

    return left;
};

// Enter-the-code step shared by email verification and password reset.
// `onVerify(code)` should throw the API error for a wrong or expired code; `onResend()` requests a new one.
export const OtpForm = ({ email, onVerify, onResend, submitLabel = "Verify", policy = DEFAULT_OTP_POLICY, sentAt = null }) => {
    const [code, setCode] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [resendAt, setResendAt] = useState(() => (sentAt ? sentAt + policy.resendAfterSeconds * 1000 : 0));
    const [resending, setResending] = useState(false);
    const submitted = useRef(null);
    const resendLeft = useSecondsLeft(resendAt);

    const complete = code.length === policy.length;
    const expired = error?.code === "OTP_EXPIRED";

    const verify = async (value) => {
        submitted.current = value;
        setPending(true);
        setError(null);
        setNotice(null);
        try {
            await onVerify(value);
        } catch (err) {
            setError(err);
            setCode("");
        } finally {
            setPending(false);
        }
    };

    // Submit as soon as the last digit is entered, once per distinct code.
    useEffect(() => {
        if (complete && !pending && submitted.current !== code) {
            verify(code);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code, complete]);

    const submit = (event) => {
        event.preventDefault();
        if (complete && !pending) {
            verify(code);
        }
    };

    const resend = async () => {
        setResending(true);
        setError(null);
        try {
            const response = await onResend();
            const wait = response?.data?.otp?.resendAfterSeconds ?? policy.resendAfterSeconds;
            setResendAt(Date.now() + wait * 1000);
            setCode("");
            submitted.current = null;
            setNotice(`If ${email} can receive a code, a new one is on its way. It expires in ${policy.expiresInMinutes} minutes.`);
        } catch (err) {
            setError(err);
        } finally {
            setResending(false);
        }
    };

    return (
        <form className="stack" onSubmit={submit} noValidate>
            <p className="muted" style={{ margin: 0 }}>
                Enter the {policy.length}-digit code we sent to <strong className="otp-email">{email}</strong>. It expires in {policy.expiresInMinutes} minutes.
            </p>
            {error && (
                <Alert type={expired ? "warning" : "error"} title={expired ? "Code no longer valid" : undefined}>
                    {error.message}
                </Alert>
            )}
            {notice && <Alert type="success">{notice}</Alert>}
            <OtpInput value={code} onChange={setCode} length={policy.length} disabled={pending} invalid={Boolean(error) && !expired} autoFocus />
            <Button type="submit" size="lg" block loading={pending} disabled={!complete}>
                <ShieldCheck size={17} /> {submitLabel}
            </Button>
            <div className="otp-resend">
                <span className="muted">Didn't get the code?</span>{" "}
                {resendLeft > 0 ? (
                    <span className="subtle" aria-live="polite">
                        Resend in {resendLeft}s
                    </span>
                ) : (
                    <button type="button" className="btn btn-ghost btn-sm otp-resend-btn" onClick={resend} disabled={resending}>
                        <RefreshCw size={14} /> {resending ? "Sending…" : "Send a new code"}
                    </button>
                )}
            </div>
            <DevMailNotice email={email} />
        </form>
    );
};
