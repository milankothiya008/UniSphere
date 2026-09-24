import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import ForgotPasswordPage from "./ForgotPasswordPage";
import { authApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";

vi.mock("../../api/endpoints", () => ({
    authApi: { forgotPassword: vi.fn(), verifyResetCode: vi.fn(), resetPassword: vi.fn() },
    systemApi: { health: vi.fn().mockResolvedValue({ data: { emailDelivery: "smtp" } }) }
}));

const email = "24ceuog001@ddu.ac.in";

const reachCodeStep = async () => {
    renderWithRouter(<ForgotPasswordPage />, { route: "/forgot-password", path: "/forgot-password" });
    await userEvent.type(screen.getByLabelText(/university email/i), email);
    await userEvent.click(screen.getByRole("button", { name: /send code/i }));
    return screen.findAllByRole("textbox", { name: /digit \d of 6/i });
};

describe("ForgotPasswordPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authApi.forgotPassword.mockResolvedValue({ data: { otp: { length: 6, expiresInMinutes: 10, resendAfterSeconds: 60 } } });
    });

    test("resets the password in three steps: email, code, new password", async () => {
        authApi.verifyResetCode.mockResolvedValue({ data: { resetToken: "reset-token-123", expiresInMinutes: 15 } });
        authApi.resetPassword.mockResolvedValue({});

        const [first] = await reachCodeStep();
        expect(authApi.forgotPassword).toHaveBeenCalledWith(email);
        expect(screen.getByText(/resend in \d+s/i)).toBeInTheDocument();

        await userEvent.type(first, "482913");
        await waitFor(() => expect(authApi.verifyResetCode).toHaveBeenCalledWith(email, "482913"));

        await userEvent.type(await screen.findByLabelText(/^new password/i), "NewSecret456");
        await userEvent.type(screen.getByLabelText(/confirm new password/i), "NewSecret456");
        await userEvent.click(screen.getByRole("button", { name: /update password/i }));

        expect(authApi.resetPassword).toHaveBeenCalledWith("reset-token-123", "NewSecret456");
        expect(await screen.findByText("Password updated")).toBeInTheDocument();
    });

    test("stays on the code step when the code is wrong", async () => {
        authApi.verifyResetCode.mockRejectedValue(new ApiError("Incorrect code. 2 attempts left.", { status: 400, code: "OTP_INVALID" }));

        const [first] = await reachCodeStep();
        await userEvent.type(first, "000000");

        expect(await screen.findByText("Incorrect code. 2 attempts left.")).toBeInTheDocument();
        expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
    });

    test("offers to start again when the reset session has expired", async () => {
        authApi.verifyResetCode.mockResolvedValue({ data: { resetToken: "reset-token-123" } });
        authApi.resetPassword.mockRejectedValue(new ApiError("Your reset session has expired.", { status: 400, code: "TOKEN_INVALID" }));

        const [first] = await reachCodeStep();
        await userEvent.type(first, "482913");
        await userEvent.type(await screen.findByLabelText(/^new password/i), "NewSecret456");
        await userEvent.type(screen.getByLabelText(/confirm new password/i), "NewSecret456");
        await userEvent.click(screen.getByRole("button", { name: /update password/i }));

        await userEvent.click(await screen.findByRole("button", { name: /start again/i }));
        expect(screen.getByLabelText(/university email/i)).toHaveValue(email);
    });
});
