import { useRef } from "react";

// Six single-digit boxes that behave like one field: typing advances, Backspace steps back,
// and pasting (or the phone's "one-time code" autofill) fills every box at once.
export const OtpInput = ({ value, onChange, length = 6, disabled = false, invalid = false, autoFocus = false, label = "Verification code" }) => {
    const inputs = useRef([]);
    const digits = Array.from({ length }, (_, index) => value[index] || "");

    const focus = (index) => {
        const target = inputs.current[Math.max(0, Math.min(length - 1, index))];
        target?.focus();
        target?.select();
    };

    const fill = (start, text) => {
        const incoming = text.replace(/\D/g, "").slice(0, length - start);
        if (!incoming) {
            return;
        }
        const next = [...digits];
        incoming.split("").forEach((digit, offset) => {
            next[start + offset] = digit;
        });
        onChange(next.join("").slice(0, length));
        focus(start + incoming.length);
    };

    const handleChange = (index) => (event) => {
        const text = event.target.value.replace(/\D/g, "");
        if (!text) {
            const next = [...digits];
            next[index] = "";
            onChange(next.join(""));
            return;
        }
        // Phone autofill delivers the whole code into one box.
        if (text.length >= length) {
            fill(0, text);
            return;
        }
        // Typing into a filled box leaves the old digit next to the new one; keep the new one.
        fill(index, text.length > 1 && text.startsWith(digits[index]) ? text.slice(-1) : text[0]);
    };

    const handleKeyDown = (index) => (event) => {
        if (event.key === "Backspace" && !digits[index] && index > 0) {
            event.preventDefault();
            const next = [...digits];
            next[index - 1] = "";
            onChange(next.join(""));
            focus(index - 1);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            focus(index - 1);
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            focus(index + 1);
        }
    };

    const handlePaste = (index) => (event) => {
        event.preventDefault();
        fill(index, event.clipboardData.getData("text"));
    };

    return (
        <div className={`otp-input ${invalid ? "invalid" : ""}`} role="group" aria-label={label}>
            {digits.map((digit, index) => (
                <input
                    key={index}
                    ref={(node) => {
                        inputs.current[index] = node;
                    }}
                    className={`otp-box ${digit ? "filled" : ""}`}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    maxLength={length}
                    aria-label={`Digit ${index + 1} of ${length}`}
                    aria-invalid={invalid}
                    value={digit}
                    disabled={disabled}
                    autoFocus={autoFocus && index === 0}
                    onFocus={(event) => event.target.select()}
                    onChange={handleChange(index)}
                    onKeyDown={handleKeyDown(index)}
                    onPaste={handlePaste(index)}
                />
            ))}
        </div>
    );
};
