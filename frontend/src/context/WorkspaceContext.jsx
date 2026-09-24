import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clubApi, referenceApi } from "../api/endpoints";
import { useAuth } from "./AuthContext";
import { PERMISSIONS } from "../lib/constants";

const WorkspaceContext = createContext(null);

// Signed-in user's clubs and shared reference data (departments, batches, venues), loaded once per session.
export const WorkspaceProvider = ({ children }) => {
    const { user, isAuthenticated } = useAuth();
    const [myClubs, setMyClubs] = useState({ memberships: [], mentored: [] });
    const [reference, setReference] = useState({ departments: [], batches: [], venues: [] });

    const reloadClubs = useCallback(async () => {
        if (!isAuthenticated) {
            return;
        }
        try {
            const response = await clubApi.mine();
            setMyClubs(response.data);
        } catch {
            setMyClubs({ memberships: [], mentored: [] });
        }
    }, [isAuthenticated]);

    const reloadReference = useCallback(async () => {
        const [departments, batches, venues] = await Promise.all([
            referenceApi.departments({ active: "true" }).catch(() => ({ data: [] })),
            referenceApi.batches({ active: "true" }).catch(() => ({ data: [] })),
            referenceApi.venues({ status: "ACTIVE" }).catch(() => ({ data: [] }))
        ]);
        setReference({ departments: departments.data, batches: batches.data, venues: venues.data });
    }, []);

    useEffect(() => {
        if (isAuthenticated) {
            reloadClubs();
            reloadReference();
        }
    }, [isAuthenticated, user?._id, reloadClubs, reloadReference]);

    const value = useMemo(() => {
        const approved = myClubs.memberships.filter((m) => m.status === "APPROVED");
        const withPermission = (permission) => approved.filter((m) => m.permissions?.includes(permission) && m.club?.status === "ACTIVE");

        return {
            myClubs,
            approvedMemberships: approved,
            officerClubs: approved.filter((m) => m.role !== "MEMBER"),
            eventClubs: withPermission(PERMISSIONS.MANAGE_EVENTS),
            postingClubs: withPermission(PERMISSIONS.POST_UPDATES),
            mentoredClubs: myClubs.mentored,
            reference,
            reloadClubs,
            reloadReference
        };
    }, [myClubs, reference, reloadClubs, reloadReference]);

    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = () => {
    const context = useContext(WorkspaceContext);
    if (!context) {
        throw new Error("useWorkspace must be used inside WorkspaceProvider");
    }
    return context;
};
