import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { ToastProvider } from "../context/ToastContext";

// Renders UI inside a router and toast provider. `auth` overrides the mocked useAuth value.
export const renderWithRouter = (ui, { route = "/", path = "*", extraRoutes = null } = {}) =>
    render(
        <MemoryRouter initialEntries={[route]}>
            <ToastProvider>
                <Routes>
                    <Route path={path} element={ui} />
                    {extraRoutes}
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );

export const authValue = (overrides = {}) => ({
    user: { _id: "u1", name: "Asha Patel", email: "24ce1234@ddu.ac.in", globalRole: "STUDENT", departmentCode: "CE", batchCode: "24" },
    status: "authenticated",
    isAuthenticated: true,
    isStudent: true,
    isFaculty: false,
    isAdmin: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    setUser: vi.fn(),
    ...overrides
});
