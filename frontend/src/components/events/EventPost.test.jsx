import { screen } from "@testing-library/react";
import { Route } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { EventPost } from "./EventPost";
import { useAuth } from "../../context/AuthContext";
import { eventApi } from "../../api/endpoints";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({ eventApi: { register: vi.fn() } }));

const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const baseEvent = {
    _id: "e1",
    title: "HackNight 2026",
    shortDescription: "Build something amazing overnight.",
    category: "COMPETITION",
    status: "PUBLISHED",
    registrationState: "OPEN",
    registeredCount: 5,
    maxParticipants: 120,
    startAt: hoursFromNow(48),
    endAt: hoursFromNow(52),
    registrationStart: hoursFromNow(-24),
    registrationEnd: hoursFromNow(24),
    publishedAt: hoursFromNow(-2),
    eligibility: { departments: [], batches: [] },
    club: { _id: "c1", name: "Coding Club" },
    venue: { name: "Auditorium" },
    myRegistration: null
};

describe("EventPost", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("shows the club, poster fallback, details and registers inline", async () => {
        eventApi.register.mockResolvedValue({ data: { registeredCount: 6 } });
        renderWithRouter(<EventPost event={baseEvent} />);

        expect(screen.getByText("Coding Club")).toBeInTheDocument();
        expect(screen.getAllByText("HackNight 2026").length).toBeGreaterThan(0);
        expect(screen.getByText("Auditorium")).toBeInTheDocument();
        expect(screen.getByText("5 / 120 going")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /register/i }));
        expect(eventApi.register).toHaveBeenCalledWith("e1");
        expect(await screen.findByText("You're going")).toBeInTheDocument();
        expect(screen.getByText("6 / 120 going")).toBeInTheDocument();
    });

    test("marks live events", () => {
        renderWithRouter(<EventPost event={{ ...baseEvent, startAt: hoursFromNow(-1), endAt: hoursFromNow(2) }} />);
        expect(screen.getByText("Live now")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^register$/i })).not.toBeInTheDocument();
    });

    test("shows results on completed events", () => {
        const completed = {
            ...baseEvent,
            status: "COMPLETED",
            startAt: hoursFromNow(-48),
            endAt: hoursFromNow(-44),
            result: { awards: [{ _id: "a1", title: "Winner", position: 1, recipientName: "Vihaan Gupta", prize: "₹5,000" }] }
        };
        renderWithRouter(<EventPost event={completed} />);

        expect(screen.getByText("Results out")).toBeInTheDocument();
        expect(screen.getByText("Vihaan Gupta")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /view results/i })).toBeInTheDocument();
    });

    test("links live events with round results to the live standings", async () => {
        const live = { ...baseEvent, startAt: hoursFromNow(-1), endAt: hoursFromNow(5), resultStage: "rounds", latestRound: { name: "Round 1" }, result: null };
        renderWithRouter(<EventPost event={live} />, { route: "/feed", path: "/feed", extraRoutes: <Route path="/results/:id" element={<p>standings page</p>} /> });

        await userEvent.click(screen.getByRole("button", { name: /live standings/i }));
        expect(await screen.findByText("standings page")).toBeInTheDocument();
    });

    test("copies the event link on desktop and offers a calendar file for upcoming events", async () => {
        const writeText = vi.fn().mockResolvedValue();
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        renderWithRouter(<EventPost event={baseEvent} />);

        expect(screen.getByRole("button", { name: /add to calendar/i })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /share event/i }));
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/events/e1`);
        expect(await screen.findByText(/Link copied/)).toBeInTheDocument();
    });

    test("flags events that are filling fast or full", () => {
        const { unmount } = renderWithRouter(<EventPost event={{ ...baseEvent, registeredCount: 100 }} />);
        expect(screen.getByText(/Filling fast · 20 left/)).toBeInTheDocument();
        unmount();

        renderWithRouter(<EventPost event={{ ...baseEvent, registeredCount: 120, waitlistCount: 4, registrationState: "FULL" }} />);
        expect(screen.getByText(/Full · 4 waiting/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /join waitlist/i })).toBeInTheDocument();
    });

    test("past events have no calendar button or seat bar", () => {
        renderWithRouter(<EventPost event={{ ...baseEvent, status: "COMPLETED", startAt: hoursFromNow(-48), endAt: hoursFromNow(-44) }} />);
        expect(screen.queryByRole("button", { name: /add to calendar/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    });

    test("explains why an ineligible student cannot register", () => {
        renderWithRouter(<EventPost event={{ ...baseEvent, eligibility: { departments: ["ME"], batches: [] } }} />);
        expect(screen.getByText("Open to ME students only.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^register$/i })).not.toBeInTheDocument();
    });
});
