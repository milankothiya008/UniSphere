import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, useLocation } from "react-router-dom";
import { renderWithRouter } from "../../test/renderWithProviders";
import VerifyEmailPage from "./VerifyEmailPage";
import { authApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";

vi.mock("../../api/endpoints", () => ({
    authApi: { verifyEmail: vi.fn(), resendVerification: vi.fn() },
    systemApi: { health: vi.fn().mockResolvedValue({ data: { emailDelivery: "smtp" } }) }
}));

const LoginScreen = () => <p>login as {useLocation().state?.email}</p>;

const renderPage = (route = "/verify-email?email=24ceuog001%40ddu.ac.in") =>
    renderWithRouter(<VerifyEmailPage />, { route, path: "/verify-email", extraRoutes: <Route path="/login" element={<LoginScreen />} /> });

const boxes = () => screen.getAllByRole("textbox", { name: /digit \d of 6/i });

describe("VerifyEmailPage", () => {
    beforeEach(() => vi.clearAllMocks());

    test("submits the code as soon as all six digits are typed", async () => {
        authApi.verifyEmail.mockResolvedValue({ data: {} });
        renderPage();

        expect(screen.getByText("24ceuog001@ddu.ac.in")).toBeInTheDocument();
        await userEvent.type(boxes()[0], "482913");

        await waitFor(() => expect(authApi.verifyEmail).toHaveBeenCalledWith("24ceuog001@ddu.ac.in", "482913"));
        expect(await screen.findByText("Email verified")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
        expect(await screen.findByText("login as 24ceuog001@ddu.ac.in")).toBeInTheDocument();
    });

    test("fills every box from a pasted code", async () => {
        authApi.verifyEmail.mockResolvedValue({ data: {} });
        renderPage();

        await userEvent.click(boxes()[0]);
        await userEvent.paste("Code: 48 29 13");

        await waitFor(() => expect(authApi.verifyEmail).toHaveBeenCalledWith("24ceuog001@ddu.ac.in", "482913"));
    });

    test("shows the attempts left and clears the boxes after a wrong code", async () => {
        authApi.verifyEmail.mockRejectedValue(new ApiError("Incorrect code. 4 attempts left.", { status: 400, code: "OTP_INVALID" }));
        renderPage();

        await userEvent.type(boxes()[0], "111111");

        expect(await screen.findByText("Incorrect code. 4 attempts left.")).toBeInTheDocument();
        boxes().forEach((box) => expect(box).toHaveValue(""));
    });

    test("lets the user request a new code once the cooldown ends", async () => {
        authApi.resendVerification.mockResolvedValue({ data: { otp: { resendAfterSeconds: 60 } } });
        renderPage();

        await userEvent.click(screen.getByRole("button", { name: /send a new code/i }));
        expect(authApi.resendVerification).toHaveBeenCalledWith("24ceuog001@ddu.ac.in");
        expect(await screen.findByText(/a new one is on its way/i)).toBeInTheDocument();
        expect(screen.getByText(/resend in 60s/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /send a new code/i })).not.toBeInTheDocument();
    });

    test("asks for the email when the address is missing", async () => {
        authApi.resendVerification.mockResolvedValue({ data: {} });
        renderPage("/verify-email");

        await userEvent.type(screen.getByLabelText(/university email/i), "24ceuog001@ddu.ac.in");
        await userEvent.click(screen.getByRole("button", { name: /send code/i }));

        expect(authApi.resendVerification).toHaveBeenCalledWith("24ceuog001@ddu.ac.in");
        expect(await screen.findAllByRole("textbox", { name: /digit \d of 6/i })).toHaveLength(6);
    });
});
