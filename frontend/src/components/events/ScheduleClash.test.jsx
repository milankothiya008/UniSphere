import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { RegistrationPanel } from "./RegistrationPanel";
import { EventPost } from "./EventPost";
import { useAuth } from "../../context/AuthContext";
import { eventApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    eventApi: { register: vi.fn(), ticket: vi.fn().mockResolvedValue({ data: null }), unregister: vi.fn() },
    likeApi: { set: vi.fn(), likers: vi.fn() }
}));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const clash = (overrides = {}) => ({
    event: { _id: "a1", title: "Workshop A", startAt: future(5), endAt: future(5.1), club: { _id: "c1", name: "Coding Club" } },
    status: "REGISTERED",
    teamRole: null,
    canSwitch: true,
    ...overrides
});

const event = (viewer = {}) => ({
    _id: "b1",
    title: "Talk B",
    status: "PUBLISHED",
    category: "TECHNOLOGY",
    registrationState: "OPEN",
    participationMode: "INDIVIDUAL",
    registeredCount: 3,
    maxParticipants: 50,
    startAt: future(5),
    endAt: future(5.12),
    registrationStart: future(-1),
    registrationEnd: future(4),
    eligibility: { departments: [], batches: [] },
    club: { _id: "c1", name: "Coding Club" },
    viewer: { registration: null, ...viewer }
});

describe("events at the same time", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("the event page warns and offers to switch; switching registers and gives up the other place", async () => {
        eventApi.register.mockResolvedValue({ data: { waitlisted: false, switchedFrom: [{ _id: "a1", title: "Workshop A" }] } });
        const onChange = vi.fn();
        renderWithRouter(<RegistrationPanel event={event({ clashes: [clash()] })} onChange={onChange} />);

        expect(screen.getByText("You have another event at this time")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Switch to this event/ }));
        const dialog = screen.getByRole("dialog", { name: /another event at this time/ });
        expect(within(dialog).getByText("Workshop A")).toBeInTheDocument();
        expect(within(dialog).getByText("Your seat will go to the next student waiting.")).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole("button", { name: /^Switch$/ }));
        await waitFor(() => expect(eventApi.register).toHaveBeenCalledWith("b1", { replace: ["a1"] }));
        expect(await screen.findByText(/Your place in "Workshop A" was cancelled/)).toBeInTheDocument();
        expect(onChange).toHaveBeenCalled();
    });

    test("keeping the other registration changes nothing", async () => {
        renderWithRouter(<RegistrationPanel event={event({ clashes: [clash({ teamRole: "LEADER" })] })} onChange={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /Switch to this event/ }));
        expect(screen.getByText("Your whole team will be withdrawn and your teammates notified.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Keep my registration" }));
        expect(eventApi.register).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("an event that has already started can't be switched from", () => {
        renderWithRouter(<RegistrationPanel event={event({ clashes: [clash({ canSwitch: false })] })} onChange={vi.fn()} />);
        expect(screen.getByText(/already started, so you can't register here/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Register now/ })).toBeDisabled();
    });

    test("from the feed, a clash reported by the server asks to switch and retries", async () => {
        eventApi.register
            .mockRejectedValueOnce(
                new ApiError("This event is at the same time as one you're registered for.", {
                    status: 409,
                    code: "SCHEDULE_CONFLICT",
                    details: { clashes: [clash({ status: "WAITLISTED" })] }
                })
            )
            .mockResolvedValueOnce({ data: { registeredCount: 4, switchedFrom: [{ _id: "a1", title: "Workshop A" }] } });
        renderWithRouter(<EventPost event={{ ...event(), myRegistration: null, publishedAt: future(-0.1), venue: { name: "Hall" } }} />);

        await userEvent.click(screen.getByRole("button", { name: /^Register$/ }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("You'll lose your place on its waitlist.")).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: /^Switch$/ }));
        await waitFor(() => expect(eventApi.register).toHaveBeenLastCalledWith("b1", { replace: ["a1"] }));
        expect(await screen.findByText("You're going")).toBeInTheDocument();
    });
});
