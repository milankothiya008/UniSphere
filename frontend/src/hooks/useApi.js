import { useCallback, useEffect, useRef, useState } from "react";

// Loads data from an API call and exposes loading/error state plus a reload function.
// `deps` re-run the loader; responses from superseded calls are ignored.
export const useApi = (loader, deps = [], { enabled = true } = {}) => {
    const [state, setState] = useState({ data: null, meta: null, loading: enabled, error: null });
    const callId = useRef(0);
    const loaderRef = useRef(loader);
    loaderRef.current = loader;

    const run = useCallback(async ({ silent = false } = {}) => {
        const id = ++callId.current;
        if (!silent) {
            setState((prev) => ({ ...prev, loading: true, error: null }));
        }
        try {
            const response = await loaderRef.current();
            if (id === callId.current) {
                setState({ data: response?.data ?? null, meta: response?.meta ?? null, loading: false, error: null });
            }
            return response;
        } catch (error) {
            if (id === callId.current) {
                setState((prev) => ({ ...prev, loading: false, error }));
            }
            return null;
        }
    }, []);

    useEffect(() => {
        if (enabled) {
            run();
        } else {
            setState({ data: null, meta: null, loading: false, error: null });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, ...deps]);

    const setData = useCallback((updater) => {
        setState((prev) => ({ ...prev, data: typeof updater === "function" ? updater(prev.data) : updater }));
    }, []);

    return { ...state, reload: run, setData };
};

// Wraps a mutation with pending/error state; resolves to the response or null on error.
export const useAction = () => {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const run = useCallback(async (fn) => {
        setPending(true);
        setError(null);
        try {
            return (await fn()) ?? true;
        } catch (err) {
            setError(err);
            return null;
        } finally {
            setPending(false);
        }
    }, []);

    return { pending, error, setError, run };
};
