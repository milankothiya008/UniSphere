import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// Keeps list filters in the URL so they survive reloads and can be shared.
export const useQueryState = (defaults = {}) => {
    const [params, setParams] = useSearchParams();

    const values = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]));

    const update = useCallback(
        (changes) => {
            setParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
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
                    return next;
                },
                { replace: true }
            );
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [setParams]
    );

    return [values, update];
};
