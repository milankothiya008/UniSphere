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

const next = () => userEvent.click(screen.getByRole("button", { name: /continue/i }));

// Step 1 (role) is already on Student; the details step, then the password step.
const fillDetails = async ({ email, phone = "98765 43210" }) => {
    await next();
    await userEvent.type(screen.getByLabelText(/full name/i), "Mrudang Shah");
    await userEvent.type(screen.getByLabelText(/email/i), email);
    if (phone) await userEvent.type(screen.getByLabelText(/mobile number/i), phone);
    await next();
};

const fillPassword = async () => {
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
        await next();
        expect(screen.getByLabelText(/faculty email/i)).toHaveAttribute("placeholder", "mrudang.ce@ddu.ac.in");
        await userEvent.type(screen.getByLabelText(/full name/i), "Mrudang Shah");
        await userEvent.type(screen.getByLabelText(/email/i), "mrudang.ce@ddu.ac.in");
        expect(screen.getByText(/Faculty · CE/)).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/mobile number/i), "98765 43210");
        await next();
        await fillPassword();
        expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /create faculty account/i }));

        expect(authApi.register).toHaveBeenCalledWith({ name: "Mrudang Shah", email: "mrudang.ce@ddu.ac.in", phone: "+919876543210", password: "Secret123", accountType: "FACULTY" });
        expect(await screen.findByText("verify ?email=mrudang.ce%40ddu.ac.in")).toBeInTheDocument();
    });

    test("needs a mobile number before moving on", async () => {
        renderWithRouter(<RegisterPage />);

        await fillDetails({ email: "24ceuog001@ddu.ac.in", phone: "" });
        expect(screen.getByText("Enter your mobile number")).toBeInTheDocument();
        expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();

        await userEvent.type(screen.getByLabelText(/mobile number/i), "12345");
        expect(screen.getByText(/10-digit Indian mobile number/)).toBeInTheDocument();
    });

    test("points an unverified duplicate to the code screen", async () => {
        authApi.register.mockRejectedValue(new ApiError("An account with this email is waiting for verification.", { status: 409, code: "UNVERIFIED_EMAIL" }));
        renderWithRouter(<RegisterPage />, { route: "/register", path: "/register", extraRoutes: verifyRoute });

        await fillDetails({ email: "24ceuog001@ddu.ac.in" });
        await fillPassword();
        await userEvent.click(screen.getByRole("button", { name: /create student account/i }));

        expect(await screen.findByText("Already registered")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("link", { name: /enter your code/i }));
        expect(await screen.findByText("verify ?email=24ceuog001%40ddu.ac.in")).toBeInTheDocument();
    });

    test("blocks a faculty email when Student is selected", async () => {
        renderWithRouter(<RegisterPage />);

        await fillDetails({ email: "mrudang.ce@ddu.ac.in" });

        expect(authApi.register).not.toHaveBeenCalled();
        expect(screen.getByText(/looks like a faculty email/i)).toBeInTheDocument();
    });

    test("registers a student with the student format", async () => {
        authApi.register.mockResolvedValue({ data: {} });
        renderWithRouter(<RegisterPage />);

        await fillDetails({ email: "24ceuog001@ddu.ac.in" });
        await fillPassword();
        await userEvent.click(screen.getByRole("button", { name: /create student account/i }));

        expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ email: "24ceuog001@ddu.ac.in", phone: "+919876543210", accountType: "STUDENT" }));
    });
});
