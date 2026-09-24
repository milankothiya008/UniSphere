import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

const ToastContext = createContext(null);

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(0);

    const dismiss = useCallback((id) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

    const push = useCallback(
        (type, message) => {
            const id = ++nextId.current;
            setToasts((list) => [...list.slice(-3), { id, type, message }]);
            setTimeout(() => dismiss(id), type === "error" ? 6000 : 4000);
        },
        [dismiss]
    );

    const toast = useMemo(
        () => ({
            success: (message) => push("success", message),
            error: (messageOrError) => push("error", messageOrError?.message || messageOrError || "Something went wrong"),
            info: (message) => push("info", message)
        }),
        [push]
    );

    return (
        <ToastContext.Provider value={toast}>
            {children}
            <div className="toast-region" role="status" aria-live="polite">
                {toasts.map(({ id, type, message }) => {
                    const Icon = ICONS[type];
                    return (
                        <div key={id} className={`toast toast-${type}`}>
                            <Icon size={18} />
                            <span>{message}</span>
                            <button type="button" onClick={() => dismiss(id)} aria-label="Dismiss">
                                <X size={16} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used inside ToastProvider");
    }
    return context;
};
