import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { RegistrationPanel } from "./RegistrationPanel";
import { useAuth } from "../../context/AuthContext";
import { eventApi } from "../../api/endpoints";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({ eventApi: { register: vi.fn(), unregister: vi.fn() } }));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const baseEvent = {
    _id: "e1",
    status: "PUBLISHED",
    registrationState: "OPEN",
    registeredCount: 10,
    maxParticipants: 50,
    startAt: future(5),
    endAt: future(5.1),
    registrationStart: future(-1),
    registrationEnd: future(4),
    eligibility: { departments: [], batches: [] },
    viewer: { registration: null }
};

describe("RegistrationPanel", () => {
    beforeEach(() => {
        useAuth.mockReturnValue(authValue());
        vi.clearAllMocks();
    });

    test("lets an eligible student register", async () => {
        eventApi.register.mockResolvedValue({ data: {} });
        const onChange = vi.fn();

        renderWithRouter(<RegistrationPanel event={baseEvent} onChange={onChange} />);
        await userEvent.click(screen.getByRole("button", { name: /register now/i }));

        expect(eventApi.register).toHaveBeenCalledWith("e1");
        expect(onChange).toHaveBeenCalled();
        expect(screen.getByText("40 seats left")).toBeInTheDocument();
    });

    test("explains ineligibility and disables registration", () => {
        renderWithRouter(<RegistrationPanel event={{ ...baseEvent, eligibility: { departments: ["ME"], batches: [] } }} onChange={vi.fn()} />);

        expect(screen.getByText("Open to ME students only.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /register now/i })).toBeDisabled();
    });

    test("shows a full event as unavailable", () => {
        renderWithRouter(<RegistrationPanel event={{ ...baseEvent, registrationState: "FULL", registeredCount: 50 }} onChange={vi.fn()} />);

        expect(screen.getByText("This event is full.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /register now/i })).toBeDisabled();
    });

    test("offers cancellation to registered students", () => {
        renderWithRouter(<RegistrationPanel event={{ ...baseEvent, viewer: { registration: { status: "REGISTERED" } } }} onChange={vi.fn()} />);

        expect(screen.getByText("You're registered")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /cancel registration/i })).toBeInTheDocument();
    });

    test("faculty see that only students can register", () => {
        useAuth.mockReturnValue(authValue({ isStudent: false, isFaculty: true }));
        renderWithRouter(<RegistrationPanel event={baseEvent} onChange={vi.fn()} />);

        expect(screen.getByText(/only student accounts can register/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /register now/i })).not.toBeInTheDocument();
    });
});
