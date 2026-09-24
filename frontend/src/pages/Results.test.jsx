import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "react-router-dom";
import { renderWithRouter } from "../test/renderWithProviders";
import ResultsPage from "./ResultsPage";
import ResultDetailPage from "./ResultDetailPage";
import ResultEditorPage from "./events/ResultEditorPage";
import { eventApi, resultApi } from "../api/endpoints";
import { ApiError } from "../api/client";

vi.mock("../api/endpoints", () => ({
    resultApi: { list: vi.fn() },
    eventApi: {
        get: vi.fn(),
        result: vi.fn(),
        participants: vi.fn(),
        saveResult: vi.fn(),
        publishResult: vi.fn(),
        createRound: vi.fn(),
        updateRound: vi.fn(),
        deleteRound: vi.fn(),
        publishRound: vi.fn(),
        unpublishRound: vi.fn()
    }
}));

const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const club = { _id: "c1", name: "Coding Club" };
const event = { _id: "e1", title: "HackDDU", club, startAt: hoursFromNow(-2), endAt: hoursFromNow(20), status: "PUBLISHED", registeredCount: 3 };

const round = {
    _id: "r1",
    name: "Round 1: Idea screening",
    description: "Top two go through.",
    status: "PUBLISHED",
    publishedAt: hoursFromNow(-1),
    correctedAt: null,
    entries: [
        { _id: "x1", rank: 1, teamName: "Team Alpha", recipientUser: { _id: "u1", name: "Alice" }, score: "92", qualified: true },
        { _id: "x2", rank: 2, recipientName: "Bob", recipientUser: { _id: "u2", name: "Bob" }, score: "88", qualified: true, note: "Best pitch" },
        { _id: "x3", rank: 3, recipientName: "Carol", recipientUser: { _id: "u3", name: "Carol" }, score: "61", qualified: false }
    ]
};

describe("results board", () => {
    beforeEach(() => vi.clearAllMocks());

    test("shows one card per event and opens the event's results", async () => {
        resultApi.list.mockResolvedValue({
            data: [
                { _id: "res1", event: { ...event, poster: null }, final: false, lastPublishedAt: hoursFromNow(-1), winners: [], rounds: { published: 1, latest: { name: "Round 1" } } },
                {
                    _id: "res2",
                    event: { ...event, _id: "e2", title: "Code Sprint" },
                    final: true,
                    lastPublishedAt: hoursFromNow(-30),
                    winners: [{ _id: "w1", title: "Winner", position: 1, teamName: "Byte Force" }],
                    rounds: { published: 0, latest: null }
                }
            ],
            meta: { page: 1, pages: 1, total: 2, counts: { all: 2, final: 1, live: 1 } }
        });
        renderWithRouter(<ResultsPage />, { route: "/results", path: "/results", extraRoutes: <Route path="/results/:eventId" element={<p>event results</p>} /> });

        const live = (await screen.findByText("HackDDU")).closest("a");
        expect(within(live).getByText("Round 1 results")).toBeInTheDocument();
        expect(within(live).getByText(/final results to come/)).toBeInTheDocument();

        const finished = screen.getByText("Code Sprint").closest("a");
        expect(within(finished).getByText("Final results")).toBeInTheDocument();
        expect(within(finished).getByText("Byte Force")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Live rounds (1)" })).toBeInTheDocument();

        await userEvent.click(finished);
        expect(await screen.findByText("event results")).toBeInTheDocument();
    });

    test("filters by stage", async () => {
        resultApi.list.mockResolvedValue({ data: [], meta: { page: 1, pages: 1, total: 0, counts: { all: 0, final: 0, live: 0 } } });
        renderWithRouter(<ResultsPage />, { route: "/results", path: "/results" });
        await userEvent.click(await screen.findByRole("button", { name: /Live rounds/ }));
        expect(resultApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "live" }));
        expect(await screen.findByText("No rounds in progress")).toBeInTheDocument();
    });
});

describe("event results page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.get.mockResolvedValue({ data: { ...event, viewer: {} } });
    });

    const renderPage = () => renderWithRouter(<ResultDetailPage />, { route: "/results/e1", path: "/results/:eventId" });

    test("shows round standings while final results are still to come", async () => {
        eventApi.result.mockResolvedValue({ data: { status: "DRAFT", summary: "", awards: [], rounds: [round], viewer: { canSeeDrafts: false, canEdit: false } } });
        renderPage();

        expect(await screen.findByText("Final results are still to come")).toBeInTheDocument();
        const table = screen.getByRole("table", { name: "Standings" });
        const rows = within(table).getAllByRole("row");
        expect(within(rows[1]).getByText("Team Alpha")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Alice")).toBeInTheDocument();
        expect(within(rows[1]).getByText("Qualified")).toBeInTheDocument();
        expect(within(rows[3]).getByText("Eliminated")).toBeInTheDocument();
        expect(screen.getByText("Best pitch")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /manage results/i })).not.toBeInTheDocument();
    });

    test("shows the podium once final results are published", async () => {
        eventApi.result.mockResolvedValue({
            data: {
                status: "PUBLISHED",
                publishedAt: hoursFromNow(-1),
                correctedAt: hoursFromNow(-0.5),
                summary: "Twelve teams built for 24 hours.",
                awards: [
                    { _id: "a2", title: "Runner-up", position: 2, recipientName: "Bob" },
                    { _id: "a1", title: "Winner", position: 1, teamName: "Team Alpha", recipientName: "Alice", prize: "₹10,000" },
                    { _id: "a4", title: "Special mention", recipientName: "Dev" }
                ],
                rounds: [round],
                viewer: { canSeeDrafts: true, canEdit: true }
            }
        });
        renderPage();

        expect(await screen.findByText("Twelve teams built for 24 hours.")).toBeInTheDocument();
        expect(screen.getByText("₹10,000")).toBeInTheDocument();
        expect(screen.getByText("Special mention")).toBeInTheDocument();
        expect(screen.getByText(/Updated/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /manage results/i })).toHaveAttribute("href", "/events/e1/results/edit");
    });

    test("explains when nothing is published yet", async () => {
        eventApi.result.mockRejectedValue(new ApiError("Results have not been published yet", { status: 404 }));
        renderPage();
        expect(await screen.findByText("No results yet")).toBeInTheDocument();
    });
});

describe("results manager", () => {
    const draftRound = { ...round, _id: "r2", name: "Round 2: Build", status: "DRAFT", publishedAt: null, entries: [round.entries[0]] };

    const setup = (viewer) => {
        eventApi.get.mockResolvedValue({ data: { ...event, viewer: { canManageResults: true, ...viewer } } });
        eventApi.participants.mockResolvedValue({ data: [{ user: { _id: "u1", name: "Alice", email: "a@ddu.ac.in" } }] });
        eventApi.result.mockResolvedValue({ data: { status: "DRAFT", summary: "", awards: [], rounds: [round, draftRound], viewer: {} } });
        return renderWithRouter(<ResultEditorPage />, { route: "/events/e1/results/edit", path: "/events/:id/results/edit" });
    };

    beforeEach(() => vi.clearAllMocks());

    test("an event coordinator drafts but cannot publish or touch published rounds", async () => {
        setup({ canPublishResults: false });

        expect(await screen.findByText("You prepare the results")).toBeInTheDocument();
        expect(screen.getByText(/This round is published. Only the club president can correct or withdraw it/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /publish round/i })).not.toBeInTheDocument();
        expect(screen.getByText("The president publishes rounds")).toBeInTheDocument();
        expect(screen.getByText("The president publishes final results")).toBeInTheDocument();
    });

    test("the president publishes a round after confirming", async () => {
        eventApi.updateRound.mockResolvedValue({ data: { status: "DRAFT", summary: "", awards: [], rounds: [round, draftRound] } });
        eventApi.publishRound.mockResolvedValue({ data: { status: "DRAFT", summary: "", awards: [], rounds: [round, { ...draftRound, status: "PUBLISHED", publishedAt: hoursFromNow(0) }] } });
        setup({ canPublishResults: true });

        await userEvent.click(await screen.findByRole("button", { name: /publish round/i }));
        await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /publish round/i }));

        expect(eventApi.updateRound).toHaveBeenCalledWith("e1", "r2", expect.objectContaining({ name: "Round 2: Build" }));
        expect(eventApi.publishRound).toHaveBeenCalledWith("e1", "r2");
        expect(await screen.findByText(/results published — participants are being notified/)).toBeInTheDocument();
    });

    test("adds a new round", async () => {
        eventApi.createRound.mockResolvedValue({ data: { status: "DRAFT", summary: "", awards: [], rounds: [round, draftRound, { ...draftRound, _id: "r3", name: "Finals", entries: [] }] } });
        setup({ canPublishResults: true });

        await userEvent.type(await screen.findByLabelText("Add another round"), "Finals");
        await userEvent.click(screen.getByRole("button", { name: /add round/i }));
        expect(eventApi.createRound).toHaveBeenCalledWith("e1", { name: "Finals" });
        expect(await screen.findByRole("heading", { name: /Finals/ })).toBeInTheDocument();
    });
});
