import { useEffect, useRef, useState } from "react";

// Returns [ref, revealed]: revealed turns true the first time the element scrolls into view,
// so content can animate in as the reader reaches it. Without IntersectionObserver it is shown at once.
export const useReveal = ({ rootMargin = "0px 0px -8% 0px" } = {}) => {
    const ref = useRef(null);
    const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === "undefined");

    useEffect(() => {
        const node = ref.current;
        if (!node || revealed || typeof IntersectionObserver === "undefined") {
            return undefined;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setRevealed(true);
                    observer.disconnect();
                }
            },
            { rootMargin }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [revealed, rootMargin]);

    return [ref, revealed];
};

// Calls onVisible whenever the sentinel element enters the viewport (infinite scrolling).
export const useSentinel = (onVisible, enabled) => {
    const ref = useRef(null);
    const callback = useRef(onVisible);
    callback.current = onVisible;

    useEffect(() => {
        const node = ref.current;
        if (!node || !enabled || typeof IntersectionObserver === "undefined") {
            return undefined;
        }
        const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && callback.current(), { rootMargin: "400px 0px" });
        observer.observe(node);
        return () => observer.disconnect();
    }, [enabled]);

    return ref;
};
