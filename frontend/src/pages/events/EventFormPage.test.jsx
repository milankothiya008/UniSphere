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

describe("EventFormPage editing a published event", () => {
    const at = (days, time) => new Date(`${dayOffset(days)}T${time}:00+05:30`).toISOString();
    const published = {
        _id: "e1",
        status: "PUBLISHED",
        title: "Hack Night",
        shortDescription: "An evening of building things together.",
        description: "Teams build projects over one evening and demo them at the end.",
        category: "TECHNOLOGY",
        club: { _id: "c1", name: "Coding Club" },
        venue: venues[0],
        startAt: at(10, "10:00"),
        endAt: at(10, "13:00"),
        startTime: "10:00",
        endTime: "13:00",
        registrationStart: at(-1, "09:00"),
        registrationEnd: at(8, "18:00"),
        maxParticipants: 50,
        registeredCount: 3,
        waitlistCount: 0,
        participationMode: "INDIVIDUAL",
        eligibility: { departments: [], batches: [], notes: "" },
        contact: {},
        viewer: { canManage: true, canEdit: true }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        referenceApi.availableVenues.mockResolvedValue({ data: venues.map((venue) => ({ ...venue, available: true, bookedBy: [] })) });
    });

    test("every detail can be changed, and the changes go to the mentor for approval", async () => {
        eventApi.get.mockResolvedValue({ data: published });
        eventApi.update.mockResolvedValue({ message: "Changes sent to your faculty mentor for approval. The event stays as it is until they approve.", data: published });
        renderWithRouter(<EventFormPage />, { route: "/events/e1/edit", path: "/events/:id/edit" });

        const title = await screen.findByDisplayValue("Hack Night");
        expect(title).toBe(screen.getByLabelText(/^title/i));
        expect(title).not.toBeDisabled();
        expect(screen.getByLabelText(/^date/i)).not.toBeDisabled();
        expect(screen.getByLabelText(/^venue/i)).not.toBeDisabled();
        expect(screen.getByText(/Your faculty mentor reviews the changes first/)).toBeInTheDocument();
        // Students have registered, so the team settings stay as they are.
        expect(screen.getByText("Can't be changed once students have registered.")).toBeInTheDocument();

        await userEvent.clear(title);
        await userEvent.type(title, "Hack Night 2.0");
        await userEvent.selectOptions(screen.getByLabelText(/^venue/i), "v2");
        await userEvent.type(screen.getByLabelText(/^message/i), "New hall!");
        await userEvent.click(screen.getByRole("button", { name: /send changes for approval/i }));

        await waitFor(() => expect(eventApi.update).toHaveBeenCalled());
        const [id, body] = eventApi.update.mock.calls[0];
        expect(id).toBe("e1");
        expect(body).toMatchObject({ title: "Hack Night 2.0", venue: "v2", updateNote: "New hall!", eventDate: dayOffset(10) });
        expect(body.participationMode).toBeUndefined();
    });
});
