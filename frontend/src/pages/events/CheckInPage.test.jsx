import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import CheckInPage from "./CheckInPage";
import { eventApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    eventApi: {
        checkIn: vi.fn(),
        openCheckIn: vi.fn(),
        closeCheckIn: vi.fn(),
        checkInParticipants: vi.fn(),
        scanTicket: vi.fn(),
        markAttendance: vi.fn(),
        unmarkAttendance: vi.fn()
    }
}));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const status = (overrides = {}) => ({
    data: {
        event: { _id: "e1", title: "HackNight 2026", startAt: future(0.1), endAt: future(0.3), venue: { name: "Auditorium" } },
        checkIn: { status: "OPEN" },
        counts: { attended: 1, registered: 4 },
        recent: [{ registrationId: "r1", name: "Asha Patel", checkedInAt: future(-0.01), checkInMethod: "QR", checkedInBy: "Kabir Joshi", ticketCode: "CC-7K3M9QWA" }],
        canManage: false,
        ...overrides
    }
});

const attendee = (id, name, extra = {}) => ({ registrationId: id, name, email: `${id}@ddu.ac.in`, departmentCode: "CE", batchCode: "24", team: null, checkedInAt: null, ...extra });

const render = () => renderWithRouter(<CheckInPage />, { route: "/events/e1/check-in", path: "/events/:id/check-in" });

describe("CheckInPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.checkIn.mockResolvedValue(status());
        eventApi.checkInParticipants.mockResolvedValue({ data: [] });
        // jsdom has no camera: the scan tab must offer the other ways in.
        delete navigator.mediaDevices;
    });

    test("shows counts, recent check-ins and a fallback when there is no camera", async () => {
        render();
        expect(await screen.findByRole("heading", { name: "HackNight 2026" })).toBeInTheDocument();
        expect(screen.getByText("checked in").previousSibling).toHaveTextContent("1");
        expect(screen.getByText("registered").previousSibling).toHaveTextContent("4");
        expect(screen.getByText("turnout").previousSibling).toHaveTextContent("25%");
        expect(screen.getByText("Asha Patel")).toBeInTheDocument();
        expect(screen.getByText(/QR · Kabir Joshi · CC-7K3M 9QWA/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Start camera/ })).toBeDisabled();
        expect(screen.getByText(/no camera access/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /check-in/i })).not.toBeInTheDocument();
    });

    test("officers find students by name and mark them present; the result shows on screen", async () => {
        eventApi.checkInParticipants.mockImplementation(async (id, search) => ({
            data: search ? [attendee("r2", "Bina Shah")] : [attendee("r2", "Bina Shah"), attendee("r3", "Chirag Rao", { checkedInAt: future(-0.02), checkedInBy: "Kabir Joshi" })]
        }));
        eventApi.markAttendance.mockResolvedValue({
            data: { result: "CHECKED_IN", message: "Bina Shah checked in", attendee: attendee("r2", "Bina Shah", { checkedInAt: future(0) }), counts: { attended: 2, registered: 4 } }
        });
        render();
        await screen.findByRole("heading", { name: "HackNight 2026" });

        await userEvent.click(screen.getByRole("tab", { name: /Search/ }));
        expect(await screen.findByText("Chirag Rao")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Undo/ })).toBeInTheDocument();

        await userEvent.type(screen.getByPlaceholderText(/Search by name or email/), "bina");
        await waitFor(() => expect(eventApi.checkInParticipants).toHaveBeenLastCalledWith("e1", "bina"));
        await userEvent.click(await screen.findByRole("button", { name: /Mark attended/ }));

        expect(eventApi.markAttendance).toHaveBeenCalledWith("e1", "r2");
        const result = (await screen.findByText("Bina Shah checked in")).closest(".scan-result");
        expect(result).toHaveClass("is-ok");
    });

    test("a typed ticket code is sent as a scan, and a bad code is reported in red", async () => {
        eventApi.scanTicket.mockResolvedValue({ data: { result: "NOT_FOUND", message: "No ticket with code CC-ZZZZZZZZ", attendee: null, counts: { attended: 1, registered: 4 } } });
        render();
        await screen.findByRole("heading", { name: "HackNight 2026" });

        await userEvent.click(screen.getByRole("tab", { name: /Enter code/ }));
        await userEvent.type(screen.getByLabelText("Ticket code"), "cc-zzzz zzzz");
        await userEvent.click(screen.getByRole("button", { name: /Check in/ }));

        expect(eventApi.scanTicket).toHaveBeenCalledWith("e1", { code: "CC-ZZZZ ZZZZ" });
        const result = (await screen.findByText("No ticket with code CC-ZZZZZZZZ")).closest(".scan-result");
        expect(result).toHaveClass("is-bad");
    });

    test("when check-in is closed, nothing can be marked; the president can start it", async () => {
        eventApi.checkIn.mockResolvedValue(status({ checkIn: { status: "NOT_STARTED" }, canManage: true, recent: [] }));
        eventApi.openCheckIn.mockResolvedValue({ message: "Check-in is open — officers can now scan tickets", data: {} });
        render();

        expect(await screen.findByText("Check-in hasn't started yet")).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: /Search/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getAllByRole("button", { name: /Start check-in/ })[0]);
        const dialog = screen.getByRole("dialog", { name: "Start check-in?" });
        await userEvent.click(within(dialog).getByRole("button", { name: "Start check-in" }));
        await waitFor(() => expect(eventApi.openCheckIn).toHaveBeenCalledWith("e1"));
        expect(await screen.findByText("Check-in is open — officers can now scan tickets")).toBeInTheDocument();
    });

    test("officers without access see the error, not the page", async () => {
        eventApi.checkIn.mockRejectedValue(Object.assign(new Error("Only club officers can run check-in"), { status: 403 }));
        render();
        expect(await screen.findByText("Only club officers can run check-in")).toBeInTheDocument();
    });
});
