import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, useLocation } from "react-router-dom";
import { renderWithRouter } from "../../test/renderWithProviders";
import { ApiError } from "../../api/client";
import RegisterPage from "./RegisterPage";
import { authApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    authApi: { register: vi.fn() },
    systemApi: { health: vi.fn().mockResolvedValue({ data: { emailDelivery: "smtp" } }) }
}));

const VerifyScreen = () => {
    const location = useLocation();
    return <p>verify {location.search}</p>;
};
const verifyRoute = <Route path="/verify-email" element={<VerifyScreen />} />;

const fill = async ({ email }) => {
    await userEvent.type(screen.getByLabelText(/full name/i), "Mrudang Shah");
    await userEvent.type(screen.getByLabelText(/email/i), email);
    const [password, confirm] = screen.getAllByLabelText(/password/i);
    await userEvent.type(password, "Secret123");
    await userEvent.type(confirm, "Secret123");
};

describe("RegisterPage", () => {
    beforeEach(() => vi.clearAllMocks());

    test("registers a faculty member and moves to the code screen", async () => {
        authApi.register.mockResolvedValue({ data: { otp: { length: 6, expiresInMinutes: 10, resendAfterSeconds: 60 } } });
        renderWithRouter(<RegisterPage />, { route: "/register", path: "/register", extraRoutes: verifyRoute });

        await userEvent.click(screen.getByRole("radio", { name: /faculty/i }));
        expect(screen.getByLabelText(/faculty email/i)).toHaveAttribute("placeholder", "mrudang.ce@ddu.ac.in");

        await fill({ email: "mrudang.ce@ddu.ac.in" });
        expect(screen.getByText(/Faculty · CE/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /create faculty account/i }));

        expect(authApi.register).toHaveBeenCalledWith({ name: "Mrudang Shah", email: "mrudang.ce@ddu.ac.in", password: "Secret123", accountType: "FACULTY" });
        expect(await screen.findByText("verify ?email=mrudang.ce%40ddu.ac.in")).toBeInTheDocument();
    });

    test("points an unverified duplicate to the code screen", async () => {
        authApi.register.mockRejectedValue(
            new ApiError("An account with this email is waiting for verification.", { status: 409, code: "UNVERIFIED_EMAIL" })
        );
        renderWithRouter(<RegisterPage />, { route: "/register", path: "/register", extraRoutes: verifyRoute });

        await fill({ email: "24ceuog001@ddu.ac.in" });
        await userEvent.click(screen.getByRole("button", { name: /create student account/i }));

        expect(await screen.findByText("Already registered")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("link", { name: /enter your code/i }));
        expect(await screen.findByText("verify ?email=24ceuog001%40ddu.ac.in")).toBeInTheDocument();
    });

    test("blocks a faculty email when Student is selected", async () => {
        renderWithRouter(<RegisterPage />);

        await fill({ email: "mrudang.ce@ddu.ac.in" });
        await userEvent.click(screen.getByRole("button", { name: /create student account/i }));

        expect(authApi.register).not.toHaveBeenCalled();
        expect(screen.getByText(/looks like a faculty email/i)).toBeInTheDocument();
    });

    test("registers a student with the student format", async () => {
        authApi.register.mockResolvedValue({ data: {} });
        renderWithRouter(<RegisterPage />);

        await fill({ email: "24ceuog001@ddu.ac.in" });
        await userEvent.click(screen.getByRole("button", { name: /create student account/i }));

        expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ email: "24ceuog001@ddu.ac.in", accountType: "STUDENT" }));
    });
});
