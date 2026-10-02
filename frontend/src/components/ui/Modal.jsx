import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./Button";
import { Textarea } from "./Form";
import { ApiErrorAlert } from "./Feedback";

export const Modal = ({ open, onClose, title, description, size, footer, children }) => {
    const titleId = useId();
    const dialogRef = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Runs only when the dialog opens/closes, so re-renders never steal focus from inputs.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKey = (event) => event.key === "Escape" && onCloseRef.current?.();
        document.addEventListener("keydown", onKey);
        const previous = document.activeElement;
        const dialog = dialogRef.current;
        (dialog?.querySelector(".modal-body input, .modal-body textarea, .modal-body select") || dialog)?.focus();
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            previous?.focus?.();
        };
    }, [open]);

    if (!open) {
        return null;
    }

    return createPortal(
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
            <div
                ref={dialogRef}
                tabIndex={-1}
                className={`modal ${size === "lg" ? "modal-lg" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
            >
                <div className="modal-header">
                    <div>
                        <h2 id={titleId}>{title}</h2>
                        {description && <p className="muted small" style={{ marginTop: 4 }}>{description}</p>}
                    </div>
                    {onClose && (
                        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
                            <X size={18} />
                        </button>
                    )}
                </div>
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>,
        document.body
    );
};

/**
 * Confirmation dialog. With `reasonLabel`, collects a text reason (required when `reasonRequired`).
 * `onConfirm(reason)` may return a promise; errors are shown inline and keep the dialog open.
 */
export const ConfirmDialog = ({
    open,
    onClose,
    onConfirm,
    title,
    description,
    confirmLabel = "Confirm",
    variant = "primary",
    reasonLabel,
    reasonRequired = false,
    reasonPlaceholder,
    minReasonLength = 5,
    confirmDisabled = false,
    children
}) => {
    const formId = useId();
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (open) {
            setReason("");
            setError(null);
        }
    }, [open]);

    const tooShort = reasonRequired && reason.trim().length < minReasonLength;

    const submit = async (event) => {
        event.preventDefault();
        if (tooShort || confirmDisabled) {
            return;
        }
        setPending(true);
        setError(null);
        try {
            await onConfirm(reason.trim());
            onClose();
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    return (
        <Modal
            open={open}
            onClose={pending ? undefined : onClose}
            title={title}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button variant={variant} type="submit" form={formId} loading={pending} disabled={tooShort || confirmDisabled}>
                        {confirmLabel}
                    </Button>
                </>
            }
        >
            <form id={formId} className="stack" onSubmit={submit}>
                {description && <p className="muted">{description}</p>}
                {children}
                {reasonLabel && (
                    <Textarea
                        label={reasonLabel}
                        required={reasonRequired}
                        value={reason}
                        placeholder={reasonPlaceholder}
                        onChange={(event) => setReason(event.target.value)}
                        hint={reasonRequired ? `At least ${minReasonLength} characters` : "Optional"}
                        maxLength={2000}
                    />
                )}
                <ApiErrorAlert error={error} />
            </form>
        </Modal>
    );
};
