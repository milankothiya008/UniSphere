import { useEffect, useState } from "react";
import { systemApi } from "../api/endpoints";

let cached = null;

// "smtp" | "preview" | "disabled" | null (unknown). Fetched once per page load.
export const useEmailDelivery = () => {
    const [mode, setMode] = useState(null);

    useEffect(() => {
        let active = true;
        if (!cached) {
            cached = systemApi
                .health()
                .then((response) => response.data?.emailDelivery || null)
                .catch(() => {
                    cached = null;
                    return null;
                });
        }
        cached.then((value) => active && setMode(value));
        return () => {
            active = false;
        };
    }, []);

    return mode;
};
