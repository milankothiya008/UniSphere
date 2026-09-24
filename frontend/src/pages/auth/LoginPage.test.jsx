import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, useLocation } from "react-router-dom";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import LoginPage from "./LoginPage";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    authApi: { resendVerification: vi.fn() },
    systemApi: { health: vi.fn().mockResolvedValue({ data: { emailDelivery: "preview" } }) }
}));

describe("LoginPage", () => {
    test("signs in and navigates to the dashboard", async () => {
        const login = vi.fn().mockResolvedValue({});
        useAuth.mockReturnValue(authValue({ login, status: "anonymous" }));

        renderWithRouter(<LoginPage />, { route: "/login", path: "/login", extraRoutes: <Route path="/dashboard" element={<p>dashboard</p>} /> });

        await userEvent.type(screen.getByLabelText(/university email/i), "24CEUOG001@ddu.ac.in");
        await userEvent.type(screen.getByLabelText(/password/i), "Secret123");
        await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

        expect(login).toHaveBeenCalledWith("24CEUOG001@ddu.ac.in", "Secret123");
        expect(await screen.findByText("dashboard")).toBeInTheDocument();
    });

    test("explains the email format and does not call the API for invalid emails", async () => {
        const login = vi.fn();
        useAuth.mockReturnValue(authValue({ login, status: "anonymous" }));

        renderWithRouter(<LoginPage />, { route: "/login", path: "/login" });

        await userEvent.type(screen.getByLabelText(/university email/i), "24CE1234@ddu.ac.in");
        await userEvent.type(screen.getByLabelText(/password/i), "Secret123");
        await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

        expect(login).not.toHaveBeenCalled();
        expect(screen.getByText(/24ceuog001@ddu.ac.in/)).toBeInTheDocument();
    });

    test("sends unverified accounts a fresh code and opens the code screen", async () => {
        const login = vi.fn().mockRejectedValue(new ApiError("Please verify your email before logging in", { status: 403, code: "UNVERIFIED_EMAIL" }));
        authApi.resendVerification.mockResolvedValue({});
        useAuth.mockReturnValue(authValue({ login, status: "anonymous" }));

        const VerifyScreen = () => <p>verify {useLocation().search}</p>;
        renderWithRouter(<LoginPage />, { route: "/login", path: "/login", extraRoutes: <Route path="/verify-email" element={<VerifyScreen />} /> });

        await userEvent.type(screen.getByLabelText(/university email/i), "24CEUOG001@ddu.ac.in");
        await userEvent.type(screen.getByLabelText(/password/i), "Secret123");
        await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

        expect(await screen.findByText("Verify your email first")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /verify with a code/i }));
        expect(authApi.resendVerification).toHaveBeenCalledWith("24ceuog001@ddu.ac.in");
        expect(await screen.findByText("verify ?email=24ceuog001%40ddu.ac.in")).toBeInTheDocument();
    });

    test("pre-fills the email when arriving from verification", async () => {
        useAuth.mockReturnValue(authValue({ login: vi.fn(), status: "anonymous" }));
        renderWithRouter(<LoginPage />, { route: { pathname: "/login", state: { email: "24ceuog001@ddu.ac.in" } }, path: "/login" });
        expect(screen.getByLabelText(/university email/i)).toHaveValue("24ceuog001@ddu.ac.in");
    });
});
