import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PageLoader } from "../components/ui";
import ForbiddenPage from "../pages/ForbiddenPage";

// Requires a session; `roles` limits access to specific system roles. The backend still enforces every rule.
export const ProtectedRoute = ({ roles, children }) => {
    const { status, user } = useAuth();
    const location = useLocation();

    if (status === "loading") {
        return <PageLoader label="Loading CampusConnect…" />;
    }

    if (status !== "authenticated") {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    if (roles && !roles.includes(user.globalRole)) {
        return <ForbiddenPage />;
    }

    return children || <Outlet />;
};

// Sends signed-in users away from login/register screens.
export const GuestRoute = ({ children }) => {
    const { status } = useAuth();

    if (status === "loading") {
        return <PageLoader />;
    }

    if (status === "authenticated") {
        return <Navigate to="/dashboard" replace />;
    }

    return children || <Outlet />;
};
