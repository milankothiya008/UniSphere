import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// Keeps list filters in the URL so they survive reloads and can be shared.
export const useQueryState = (defaults = {}) => {
    const [params, setParams] = useSearchParams();
    // React Router hands functional updates the params of the last render, so two changes made before
    // the next render (e.g. switching tab, then picking a category) would overwrite each other.
    // Each change therefore builds on the previous one until the URL has caught up.
    const pending = useRef(null);

    useEffect(() => {
        pending.current = null;
    }, [params]);

    const values = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]));

    const update = useCallback(
        (changes) => {
            const next = new URLSearchParams(pending.current ?? params);
            Object.entries(changes).forEach(([key, value]) => {
                if (value === undefined || value === null || value === "" || value === defaults[key]) {
                    next.delete(key);
                } else {
                    next.set(key, String(value));
                }
            });
            if (!("page" in changes)) {
                next.delete("page");
            }
            pending.current = next;
            setParams(next, { replace: true });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [params, setParams]
    );

    return [values, update];
};
