import { screen } from "@testing-library/react";
import { Route } from "react-router-dom";
import { renderWithRouter, authValue } from "../test/renderWithProviders";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "../context/AuthContext";

vi.mock("../context/AuthContext", () => ({ useAuth: vi.fn() }));

describe("ProtectedRoute", () => {
    test("redirects anonymous visitors to the login page", () => {
        useAuth.mockReturnValue(authValue({ status: "anonymous", user: null, isAuthenticated: false }));

        renderWithRouter(
            <ProtectedRoute>
                <p>secret</p>
            </ProtectedRoute>,
            { route: "/dashboard", extraRoutes: <Route path="/login" element={<p>login screen</p>} /> }
        );

        expect(screen.getByText("login screen")).toBeInTheDocument();
        expect(screen.queryByText("secret")).not.toBeInTheDocument();
    });

    test("blocks roles that are not allowed", () => {
        useAuth.mockReturnValue(authValue());

        renderWithRouter(
            <ProtectedRoute roles={["ADMIN"]}>
                <p>admin area</p>
            </ProtectedRoute>
        );

        expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
        expect(screen.queryByText("admin area")).not.toBeInTheDocument();
    });

    test("renders children for allowed roles", () => {
        useAuth.mockReturnValue(authValue({ user: { ...authValue().user, globalRole: "ADMIN" } }));

        renderWithRouter(
            <ProtectedRoute roles={["ADMIN"]}>
                <p>admin area</p>
            </ProtectedRoute>
        );

        expect(screen.getByText("admin area")).toBeInTheDocument();
    });
});
