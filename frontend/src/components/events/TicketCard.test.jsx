import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { TicketCard, spacedCode } from "./TicketCard";
import { eventApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({ eventApi: { ticket: vi.fn() } }));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const ticket = {
    registrationId: "r1",
    ticketCode: "CC-7K3M9QWA",
    token: "64b000000000000000000001.CC-7K3M9QWA.signature",
    qrDataUrl: "data:image/png;base64,AAAA",
    checkedInAt: null,
    checkInMethod: null,
    holder: { name: "Asha Patel", email: "24ceuog001@ddu.ac.in" },
    event: { _id: "e1", title: "HackNight 2026", startAt: future(5), endAt: future(5.2), venue: { name: "Auditorium", location: "Main Campus" }, club: { name: "Coding Club" } },
    team: { name: "Byte Busters", role: "LEADER" }
};

describe("TicketCard", () => {
    beforeEach(() => vi.clearAllMocks());

    test("shows the QR code, the ticket code and the event details", async () => {
        eventApi.ticket.mockResolvedValue({ data: ticket });
        renderWithRouter(<TicketCard event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />);

        expect(await screen.findByRole("img", { name: "QR ticket CC-7K3M9QWA" })).toHaveAttribute("src", ticket.qrDataUrl);
        expect(screen.getByText("CC-7K3M 9QWA")).toBeInTheDocument();
        expect(screen.getByText("Asha Patel")).toBeInTheDocument();
        expect(screen.getByText(/Byte Busters/)).toBeInTheDocument();
        expect(screen.getByText(/Auditorium, Main Campus/)).toBeInTheDocument();
        expect(screen.getByText(/Show this QR code at the entrance/)).toBeInTheDocument();
        expect(screen.getByText(/Also sent to 24ceuog001@ddu.ac.in/)).toBeInTheDocument();
        expect(eventApi.ticket).toHaveBeenCalledWith("e1");
    });

    test("opens a full-screen copy, also straight from the email link (?ticket=1)", async () => {
        eventApi.ticket.mockResolvedValue({ data: ticket });
        renderWithRouter(<TicketCard event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />, { route: "/events/e1?ticket=1", path: "/events/:id" });

        const dialog = await screen.findByRole("dialog", { name: "Your ticket" });
        expect(within(dialog).getByRole("img", { name: "QR ticket CC-7K3M9QWA" })).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Show full screen/ }));
        expect(screen.getByRole("dialog", { name: "Your ticket" })).toBeInTheDocument();
    });

    test("a checked-in ticket says so instead of asking to show it", async () => {
        eventApi.ticket.mockResolvedValue({ data: { ...ticket, checkedInAt: future(-0.01), checkInMethod: "QR" } });
        renderWithRouter(<TicketCard event={{ _id: "e1" }} registration={{ status: "REGISTERED", checkedInAt: future(-0.01) }} />);

        expect(await screen.findByText(/Checked in at/)).toBeInTheDocument();
        expect(screen.getAllByText("Checked in").length).toBeGreaterThan(0);
        expect(screen.queryByText(/Show this QR code/)).not.toBeInTheDocument();
    });

    test("renders nothing when there is no ticket", async () => {
        eventApi.ticket.mockRejectedValue(new Error("no ticket"));
        const { container } = renderWithRouter(<TicketCard event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />);
        await screen.findByText((_, node) => node === container && true, undefined, { timeout: 50 }).catch(() => {});
        expect(container.querySelector(".ticket-card")).toBeNull();
    });

    test("spaces the code for reading out", () => {
        expect(spacedCode("CC-7K3M9QWA")).toBe("CC-7K3M 9QWA");
        expect(spacedCode(null)).toBe("");
    });
});
