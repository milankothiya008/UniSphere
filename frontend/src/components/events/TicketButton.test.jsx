import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { TicketButton, spacedCode } from "./TicketButton";
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

describe("TicketButton", () => {
    beforeEach(() => vi.clearAllMocks());

    test("shows only a button until the student opens the ticket", async () => {
        eventApi.ticket.mockResolvedValue({ data: ticket });
        renderWithRouter(<TicketButton event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />);

        expect(screen.getByRole("button", { name: /View ticket/ })).toBeInTheDocument();
        expect(screen.queryByRole("img", { name: /QR ticket/ })).not.toBeInTheDocument();
        expect(eventApi.ticket).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: /View ticket/ }));
        const dialog = screen.getByRole("dialog", { name: "Your ticket" });
        expect(await within(dialog).findByRole("img", { name: "QR ticket CC-7K3M9QWA" })).toHaveAttribute("src", ticket.qrDataUrl);
        expect(within(dialog).getByText("CC-7K3M 9QWA")).toBeInTheDocument();
        expect(within(dialog).getByText("Asha Patel")).toBeInTheDocument();
        expect(within(dialog).getByText(/Byte Busters/)).toBeInTheDocument();
        expect(within(dialog).getByText(/Auditorium, Main Campus/)).toBeInTheDocument();
        expect(within(dialog).getByText(/Show this QR code at the entrance/)).toBeInTheDocument();
        expect(within(dialog).getByText(/A copy was sent to 24ceuog001@ddu.ac.in/)).toBeInTheDocument();
        expect(eventApi.ticket).toHaveBeenCalledWith("e1");

        await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("the email link (?ticket=1) opens the ticket straight away", async () => {
        eventApi.ticket.mockResolvedValue({ data: ticket });
        renderWithRouter(<TicketButton event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />, { route: "/events/e1?ticket=1", path: "/events/:id" });

        const dialog = await screen.findByRole("dialog", { name: "Your ticket" });
        expect(await within(dialog).findByRole("img", { name: "QR ticket CC-7K3M9QWA" })).toBeInTheDocument();
    });

    test("a checked-in ticket says so", async () => {
        eventApi.ticket.mockResolvedValue({ data: { ...ticket, checkedInAt: future(-0.01), checkInMethod: "QR" } });
        renderWithRouter(<TicketButton event={{ _id: "e1" }} registration={{ status: "REGISTERED", checkedInAt: future(-0.01) }} />);

        await userEvent.click(screen.getByRole("button", { name: /View ticket/ }));
        const dialog = screen.getByRole("dialog", { name: "Your ticket" });
        expect(await within(dialog).findByText(/Checked in at/)).toBeInTheDocument();
        expect(within(dialog).getByText("You're checked in for this event.")).toBeInTheDocument();
        expect(within(dialog).queryByText(/Show this QR code/)).not.toBeInTheDocument();
    });

    test("a ticket that can't be loaded shows an error in the window", async () => {
        eventApi.ticket.mockRejectedValue(Object.assign(new Error("Network error"), { status: 500 }));
        renderWithRouter(<TicketButton event={{ _id: "e1" }} registration={{ status: "REGISTERED" }} />);

        await userEvent.click(screen.getByRole("button", { name: /View ticket/ }));
        expect(await screen.findByText("Couldn't load your ticket")).toBeInTheDocument();
    });

    test("spaces the code for reading out", () => {
        expect(spacedCode("CC-7K3M9QWA")).toBe("CC-7K3M 9QWA");
        expect(spacedCode(null)).toBe("");
    });
});
