// Light / dark / follow-the-device theme, remembered on this device. index.html applies it before the
// first paint (no white flash); this module keeps it in step afterwards.
import { useEffect, useState } from "react";

const KEY = "cc.theme";
const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export const storedTheme = () => {
    try {
        return localStorage.getItem(KEY) || "system";
    } catch {
        return "system";
    }
};

const resolve = (choice) => (choice === "system" ? (media()?.matches ? "dark" : "light") : choice);

const apply = (choice, animate = false) => {
    const root = document.documentElement;
    if (animate) {
        root.classList.add("theme-switching");
        setTimeout(() => root.classList.remove("theme-switching"), 350);
    }
    const theme = resolve(choice);
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0c10" : "#ffffff");
};

const listeners = new Set();

export const setTheme = (choice) => {
    try {
        localStorage.setItem(KEY, choice);
    } catch {
        // Storage blocked: the choice lasts for this visit.
    }
    apply(choice, true);
    listeners.forEach((listener) => listener(choice));
};

/** Call once at start-up: applies the theme and follows the device setting while on "system". */
export const initTheme = () => {
    apply(storedTheme());
    media()?.addEventListener?.("change", () => storedTheme() === "system" && apply("system", true));
};

export const useTheme = () => {
    const [choice, setChoice] = useState(storedTheme);
    useEffect(() => {
        listeners.add(setChoice);
        return () => listeners.delete(setChoice);
    }, []);
    return [choice, setTheme];
};
