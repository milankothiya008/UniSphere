import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import EventPlannerPage from "./EventPlannerPage";
import { ScheduleCheck } from "../../components/events/ScheduleCheck";
import { eventApi } from "../../api/endpoints";
import { addDaysToKey, toDateInput } from "../../lib/format";
import { clashesWith, eventsOnDay, freeWindows, layoutLanes } from "../../lib/schedule";

vi.mock("../../api/endpoints", () => ({ eventApi: { schedule: vi.fn() } }));

vi.mock("../../context/WorkspaceContext", () => ({
    useWorkspace: () => ({
        eventClubs: [{ club: { _id: "c1", name: "Coding Club" } }],
        reference: { departments: [{ code: "CE", name: "Computer" }, { code: "IT", name: "IT" }, { code: "ME", name: "Mechanical" }] }
    })
}));

const day = addDaysToKey(toDateInput(new Date()), 3);
const at = (time) => new Date(`${day}T${time}:00+05:30`).toISOString();
const item = (id, title, start, end, extra = {}) => ({
    _id: id,
    title,
    status: "PUBLISHED",
    tentative: false,
    startAt: at(start),
    endAt: at(end),
    club: { _id: `club-${id}`, name: `${title} Club` },
    venue: { _id: "v1", name: "Auditorium" },
    audience: "ALL",
    registeredCount: 0,
    maxParticipants: null,
    mine: false,
    ...extra
});

const items = [
    item("e1", "HackNight", "18:00", "23:00", { audience: ["CE", "IT"], club: { _id: "csi", name: "CSI" } }),
    item("e2", "Open Mic", "19:00", "21:00", { status: "PENDING_APPROVAL", tentative: true, audience: ["ME"] }),
    item("e3", "Quiz", "10:00", "12:00")
];

describe("schedule helpers", () => {
    const dayEvents = eventsOnDay(items, day);

    test("overlapping events go into separate lanes", () => {
        const { placed, lanes } = layoutLanes(dayEvents);
        expect(lanes).toBe(2);
        expect(placed.find((event) => event._id === "e2").lane).toBe(1);
    });

    test("free windows skip busy hours, and only count events for the chosen students", () => {
        expect(freeWindows(dayEvents)).toEqual([
            { start: 8 * 60, end: 10 * 60 },
            { start: 12 * 60, end: 18 * 60 }
        ]);
        // Open Mic is for ME students only, so CE students are free until HackNight.
        expect(freeWindows(dayEvents, { audience: ["ME"] })).toEqual([
            { start: 8 * 60, end: 10 * 60 },
            { start: 12 * 60, end: 19 * 60 },
            { start: 21 * 60, end: 22 * 60 }
        ]);
    });

    test("clashes say whether the other event is for the same students", () => {
        const clashes = clashesWith(dayEvents, { start: 20 * 60, end: 22 * 60, audience: ["CE"] });
        expect(clashes.map((event) => [event.title, event.sameAudience])).toEqual([
            ["HackNight", true],
            ["Open Mic", false]
        ]);
    });
});

describe("EventPlannerPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.schedule.mockResolvedValue({ data: { items } });
    });

    test("shows the day's events, marks tentative ones, and offers free slots to plan in", async () => {
        renderWithRouter(<EventPlannerPage />, { route: `/events/planner?date=${day}` });
        await waitFor(() => expect(eventApi.schedule).toHaveBeenCalled());
        const timeline = await screen.findByRole("group", { name: /Events on/ });
        expect(within(timeline).getByText("HackNight")).toBeInTheDocument();
        expect(within(timeline).getByText("Open Mic").closest(".tl-event")).toHaveClass("is-tentative");
        expect(screen.getByText("Awaiting approval", { selector: ".badge" })).toBeInTheDocument();

        const plan = screen.getAllByRole("link", { name: "Plan here" });
        expect(plan[0]).toHaveAttribute("href", `/events/create?date=${day}&start=08:00&end=10:00`);
        expect(plan[1]).toHaveAttribute("href", `/events/create?date=${day}&start=12:00&end=14:00`);
    });

    test("choosing a department fades other students' events and recalculates free time", async () => {
        renderWithRouter(<EventPlannerPage />, { route: `/events/planner?date=${day}` });
        await screen.findByRole("group", { name: /Events on/ });
        await userEvent.selectOptions(screen.getByRole("combobox", { name: "Students of" }), "CE");
        expect(screen.getByText("Free for CE students")).toBeInTheDocument();
        const timeline = screen.getByRole("group", { name: /Events on/ });
        expect(within(timeline).getByText("Open Mic").closest(".tl-event")).toHaveClass("is-faded");
        expect(screen.getByText("12 pm – 6 pm")).toBeInTheDocument();
    });

    test("the week strip shows how busy each day is", async () => {
        renderWithRouter(<EventPlannerPage />, { route: `/events/planner?date=${day}` });
        await screen.findByRole("group", { name: /Events on/ });
        expect(screen.getByRole("button", { name: /: 3 events$/ })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getAllByRole("button", { name: /: free$/ }).length).toBeGreaterThan(0);
    });
});

describe("ScheduleCheck", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.schedule.mockResolvedValue({ data: { items } });
    });

    test("warns about an event for the same students at the same time, but only notes other students' events", async () => {
        renderWithRouter(<ScheduleCheck dateKey={day} startTime="20:00" endTime="22:00" audience={["CE"]} />);
        expect(await screen.findByText("Your event overlaps an event for the same students")).toBeInTheDocument();
        expect(screen.getByText(/runs 6 pm–11 pm for CE, IT students/)).toBeInTheDocument();
        expect(screen.getByText("Also running then, for other students")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Open planner/ })).toHaveAttribute("href", `/events/planner?date=${day}`);
    });

    test("a free slot is confirmed", async () => {
        renderWithRouter(<ScheduleCheck dateKey={day} startTime="13:00" endTime="15:00" audience="ALL" />);
        expect(await screen.findByText("No other event at this time — a clear slot.")).toBeInTheDocument();
    });

    test("the event under review is not counted against itself", async () => {
        renderWithRouter(<ScheduleCheck dateKey={day} startTime="10:00" endTime="12:00" excludeId="e3" reviewer />);
        expect(await screen.findByText("No other event at this time — a clear slot.")).toBeInTheDocument();
    });
});
