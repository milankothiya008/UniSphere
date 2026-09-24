import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import EventFormPage from "./EventFormPage";
import { eventApi, referenceApi } from "../../api/endpoints";
import { toDateTimeInput } from "../../lib/format";

const venues = [
    { _id: "v1", name: "Auditorium", location: "Main Campus", capacity: 300 },
    { _id: "v2", name: "Seminar Hall A", location: "Academic Block", capacity: 60 }
];

vi.mock("../../api/endpoints", () => ({
    eventApi: { get: vi.fn(), create: vi.fn(), update: vi.fn(), submit: vi.fn() },
    referenceApi: { availableVenues: vi.fn() }
}));

vi.mock("../../context/WorkspaceContext", () => ({
    useWorkspace: () => ({
        eventClubs: [{ club: { _id: "c1", name: "Coding Club" } }],
        reference: { venues, departments: [], batches: [] }
    })
}));

// Dates as the form's inputs expect them, in the campus timezone.
const nowInput = () => toDateTimeInput(new Date());
const dayOffset = (days) => toDateTimeInput(new Date(Date.now() + days * 86400000)).slice(0, 10);

const renderForm = () => renderWithRouter(<EventFormPage />, { route: "/events/new", path: "/events/new" });

describe("EventFormPage schedule rules", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        referenceApi.availableVenues.mockResolvedValue({ data: venues.map((venue) => ({ ...venue, available: true, bookedBy: [] })) });
    });

    test("date and deadline pickers start from today", () => {
        renderForm();
        expect(screen.getByLabelText(/^date/i)).toHaveAttribute("min", nowInput().slice(0, 10));
        expect(screen.getByLabelText(/registration deadline/i)).toHaveAttribute("min", nowInput());
        expect(screen.getByLabelText(/registration opens/i)).toHaveAttribute("min", nowInput());
    });

    test("flags a past date and a past deadline, and does not save", async () => {
        renderForm();
        fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: dayOffset(-1) } });
        fireEvent.change(screen.getByLabelText(/registration deadline/i), { target: { value: `${dayOffset(-2)}T10:00` } });

        expect(screen.getByText("Pick today or a future date")).toBeInTheDocument();
        expect(screen.getByText("The deadline must be in the future")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /save draft/i }));
        expect(eventApi.create).not.toHaveBeenCalled();
    });

    test("the deadline cannot be set after the event starts", () => {
        renderForm();
        const date = dayOffset(5);
        fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: date } });
        expect(screen.getByLabelText(/registration deadline/i)).toHaveAttribute("max", `${date}T10:00`);
    });

    test("shows who holds a venue that is not free in the chosen slot", async () => {
        referenceApi.availableVenues.mockResolvedValue({
            data: [
                { ...venues[0], available: false, bookedBy: [{ title: "Drama Showcase", club: "Drama Club", startTime: "09:00", endTime: "11:00", pendingApproval: true }] },
                { ...venues[1], available: true, bookedBy: [] }
            ]
        });
        renderForm();
        fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: dayOffset(5) } });

        const booked = await screen.findByRole("option", { name: /Auditorium .* unavailable \(09:00–11:00 Drama Showcase, pending\)/ });
        expect(booked).toBeDisabled();
        expect(screen.getByRole("option", { name: /Seminar Hall A/ })).not.toBeDisabled();
        await waitFor(() =>
            expect(referenceApi.availableVenues).toHaveBeenCalledWith({ eventDate: dayOffset(5), startTime: "10:00", endTime: "12:00", excludeEventId: undefined })
        );
    });
});
