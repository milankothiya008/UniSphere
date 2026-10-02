import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authApi } from "../api/endpoints";
import { refreshSession, setAccessToken, setSessionExpiredHandler } from "../api/client";
import { ROLES } from "../lib/constants";
import { disablePush } from "../lib/push";

const AuthContext = createContext(null);

// Remembers that this browser has signed in, so anonymous visits skip the session-restore request.
// Storage can be unavailable (private mode, blocked site data); the app still works without it.
const SESSION_HINT = "campusconnect:session";
const hint = {
    get: () => {
        try {
            return window.localStorage.getItem(SESSION_HINT) === "1";
        } catch {
            return true;
        }
    },
    set: (on) => {
        try {
            if (on) {
                window.localStorage.setItem(SESSION_HINT, "1");
            } else {
                window.localStorage.removeItem(SESSION_HINT);
            }
        } catch {
            // Ignore storage failures.
        }
    }
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [status, setStatus] = useState("loading");

    const clearSession = useCallback(() => {
        hint.set(false);
        setAccessToken(null);
        setUser(null);
        setStatus("anonymous");
    }, []);

    // Restore the session from the HttpOnly refresh cookie on first load.
    useEffect(() => {
        let active = true;
        setSessionExpiredHandler(clearSession);

        if (!hint.get()) {
            setStatus("anonymous");
            return undefined;
        }

        refreshSession()
            .then((data) => {
                if (active) {
                    setUser(data.user);
                    setStatus("authenticated");
                }
            })
            .catch(() => {
                if (active) {
                    clearSession();
                }
            });

        return () => {
            active = false;
        };
    }, [clearSession]);

    const login = useCallback(async (email, password) => {
        const response = await authApi.login({ email, password });
        setAccessToken(response.data.accessToken);
        hint.set(true);
        setUser(response.data.user);
        setStatus("authenticated");
        return response.data.user;
    }, []);

    const logout = useCallback(async () => {
        try {
            // This device stops getting the signed-out user's notifications.
            await disablePush().catch(() => {});
            await authApi.logout();
        } finally {
            clearSession();
        }
    }, [clearSession]);

    const refreshUser = useCallback(async () => {
        const response = await authApi.me();
        setUser(response.data);
        return response.data;
    }, []);

    const value = useMemo(
        () => ({
            user,
            status,
            isAuthenticated: status === "authenticated",
            isStudent: user?.globalRole === ROLES.STUDENT,
            isFaculty: user?.globalRole === ROLES.FACULTY,
            isAdmin: user?.globalRole === ROLES.ADMIN,
            login,
            logout,
            refreshUser,
            setUser
        }),
        [user, status, login, logout, refreshUser]
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used inside AuthProvider");
    }
    return context;
};
