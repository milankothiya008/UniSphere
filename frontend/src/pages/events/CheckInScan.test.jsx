import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import CheckInPage from "./CheckInPage";
import { eventApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    eventApi: {
        checkIn: vi.fn(),
        checkInParticipants: vi.fn(),
        scanTicket: vi.fn()
    }
}));

// A stand-in camera: the test reads a QR by calling the captured onDecode.
const camera = { onDecode: null, start: vi.fn(), stop: vi.fn(), snapshot: vi.fn(() => "data:image/jpeg;base64,FRAME") };
vi.mock("../../hooks/useQrScanner", () => ({
    useQrScanner: ({ onDecode }) => {
        camera.onDecode = onDecode;
        return { videoRef: { current: null }, state: "scanning", error: null, start: camera.start, stop: camera.stop, snapshot: camera.snapshot, supported: true };
    }
}));

const soon = new Date(Date.now() + 3600000).toISOString();
const status = {
    data: {
        event: { _id: "e1", title: "HackNight 2026", startAt: soon, endAt: soon, venue: { name: "Auditorium" } },
        checkIn: { status: "OPEN" },
        counts: { attended: 0, registered: 4 },
        recent: [],
        canManage: false
    }
};

const render = () => renderWithRouter(<CheckInPage />, { route: "/events/e1/check-in", path: "/events/:id/check-in" });

describe("CheckInPage scanning", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.checkIn.mockResolvedValue(status);
    });

    test("reading a QR pauses the camera and shows the result on the viewport until 'Scan next ticket'", async () => {
        let answer;
        eventApi.scanTicket.mockReturnValue(new Promise((resolve) => (answer = resolve)));
        render();
        await screen.findByRole("heading", { name: "HackNight 2026" });
        expect(document.querySelector(".checkin-reticle")).not.toBeNull();

        await act(async () => {
            camera.onDecode("token-1");
        });
        expect(camera.snapshot).toHaveBeenCalled();
        expect(camera.stop).toHaveBeenCalled();
        expect(eventApi.scanTicket).toHaveBeenCalledWith("e1", { token: "token-1" });
        expect(screen.getByText("Checking ticket…")).toBeInTheDocument();
        expect(document.querySelector(".checkin-reticle")).toBeNull();

        await act(async () => {
            answer({
                data: {
                    result: "CHECKED_IN",
                    message: "Asha Patel checked in",
                    attendee: { registrationId: "r1", name: "Asha Patel", email: "24ceuog001@ddu.ac.in", departmentCode: "CE" },
                    counts: { attended: 1, registered: 4 }
                }
            });
        });
        const outcome = screen.getByText("Asha Patel checked in").closest(".scan-outcome");
        expect(outcome).toHaveClass("is-ok");
        expect(outcome.querySelector(".scan-outcome-still")).toHaveAttribute("src", "data:image/jpeg;base64,FRAME");
        expect(outcome.closest(".checkin-viewport")).not.toBeNull();
        expect(document.querySelector(".scan-result")).toBeNull();

        await userEvent.click(screen.getByRole("button", { name: /Scan next ticket/ }));
        expect(camera.start).toHaveBeenCalled();
        expect(document.querySelector(".scan-outcome")).toBeNull();
    });

    test("a refused ticket is shown in red on the viewport", async () => {
        eventApi.scanTicket.mockResolvedValue({ data: { result: "NOT_REGISTERED", message: "Registration was cancelled — ticket no longer valid", attendee: null, counts: { attended: 0, registered: 4 } } });
        render();
        await screen.findByRole("heading", { name: "HackNight 2026" });

        await act(async () => {
            await camera.onDecode("stale-token");
        });
        expect(screen.getByText("Registration was cancelled — ticket no longer valid").closest(".scan-outcome")).toHaveClass("is-bad");
        expect(screen.getByRole("button", { name: /Scan next ticket/ })).toBeInTheDocument();
    });
});
