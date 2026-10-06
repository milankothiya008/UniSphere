import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { Ballot, Results, ElectionSummary } from "./ElectionParts";
import { PostComposer } from "../feed/PostComposer";
import { AddToCalendar } from "../calendar/AddToCalendar";
import { clubApi, electionApi, feedApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    electionApi: { vote: vi.fn() },
    feedApi: { create: vi.fn(), audiencePreview: vi.fn() },
    clubApi: { roles: vi.fn(), events: vi.fn() },
    userApi: { search: vi.fn().mockResolvedValue({ data: [] }) },
    uploadApi: { image: vi.fn() }
}));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const person = (id, name) => ({ _id: id, name, avatar: null });

const election = (overrides = {}) => ({
    _id: "e1",
    club: "c1",
    title: "Next vice-president",
    roleName: "Vice-president",
    status: "OPEN",
    opensAt: future(-1),
    closesAt: future(1),
    eligibleCount: 10,
    votesCast: 4,
    candidates: [
        { user: person("u2", "Asha"), statement: "Ran the tech fest", stillMember: true, votes: null },
        { user: person("u3", "Bina"), statement: "", stillMember: true, votes: null },
        { user: person("u4", "Chirag"), statement: "", stillMember: false, votes: null }
    ],
    viewer: { eligible: true, hasVoted: false, canVote: true },
    ...overrides
});

describe("club elections", () => {
    beforeEach(() => vi.clearAllMocks());

    test("the ballot takes one secret vote, after a confirmation; members who left can't be chosen", async () => {
        const user = userEvent.setup();
        const onVoted = vi.fn();
        electionApi.vote.mockResolvedValue({ data: election({ viewer: { hasVoted: true, canVote: false } }) });
        renderWithRouter(<Ballot election={election()} onVoted={onVoted} />);

        expect(screen.getByRole("button", { name: /cast secret vote/i })).toBeDisabled();
        expect(screen.getByRole("radio", { name: /chirag/i })).toBeDisabled();
        expect(screen.getByText(/never who you chose/i)).toBeInTheDocument();

        await user.click(screen.getByRole("radio", { name: /bina/i }));
        await user.click(screen.getByRole("button", { name: /cast secret vote/i }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/vote for bina/i)).toBeInTheDocument();
        await user.click(within(dialog).getByRole("button", { name: /cast vote/i }));

        await waitFor(() => expect(electionApi.vote).toHaveBeenCalledWith("e1", "u3"));
        expect(onVoted).toHaveBeenCalled();
    });

    test("results show the counts, the leader, ties and that the result is advisory", () => {
        const closed = election({
            status: "CLOSED",
            votesCast: 6,
            candidates: [
                { user: person("u2", "Asha"), stillMember: true, votes: 3, leading: true },
                { user: person("u3", "Bina"), stillMember: true, votes: 3, leading: true }
            ],
            result: { tie: true, noVotes: false, winners: ["u2", "u3"] }
        });
        renderWithRouter(<Results election={closed} />);
        expect(screen.getByText(/it's a tie/i)).toBeInTheDocument();
        expect(screen.getAllByText("50%")).toHaveLength(2);
        expect(screen.getByText(/the president makes the appointment/i)).toBeInTheDocument();
    });

    test("the summary card shows turnout and what the member can do", () => {
        renderWithRouter(<ElectionSummary election={election()} to="/clubs/c1/elections/e1" />);
        expect(screen.getByText(/4 of 10 voted/i)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /vote now/i })).toHaveAttribute("href", "/clubs/c1/elections/e1");
    });
});

describe("announcement audience", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clubApi.roles.mockResolvedValue({
            data: {
                roles: [
                    { key: "TREASURER", name: "Treasurer" },
                    { key: "VICE_PRESIDENT", name: "Vice-president" }
                ]
            }
        });
        feedApi.audiencePreview.mockResolvedValue({ data: { count: 2, email: 1, label: "Treasurer" } });
        feedApi.create.mockResolvedValue({ data: { _id: "p1" } });
    });

    test("followers by default; 'Choose…' sends only to the picked roles", async () => {
        const user = userEvent.setup();
        renderWithRouter(<PostComposer clubs={[{ club: { _id: "c1", name: "Coding Club" } }]} fixedClubId="c1" />);

        expect(screen.getByRole("button", { name: "Followers" })).toHaveAttribute("aria-pressed", "true");
        await user.click(screen.getByRole("button", { name: /choose/i }));
        await user.type(screen.getByLabelText(/title/i), "Budget meeting");
        expect(screen.getByRole("button", { name: /send announcement/i })).toBeDisabled();

        await user.click(await screen.findByRole("checkbox", { name: "Treasurer" }));
        expect(await screen.findByText(/reaches 2 people/i)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /send announcement/i }));

        await waitFor(() => expect(feedApi.create).toHaveBeenCalled());
        expect(feedApi.create.mock.calls[0][0]).toMatchObject({
            club: "c1",
            title: "Budget meeting",
            sendEmail: true,
            audience: { mode: "CUSTOM", roles: ["TREASURER"], departments: [], batches: [], users: [], includeMentor: false }
        });
    });
});

describe("add to calendar", () => {
    test("offers Google Calendar and an .ics file", async () => {
        const user = userEvent.setup();
        renderWithRouter(
            <AddToCalendar
                icsUrl="/api/calendar/events/e1.ics"
                item={{ title: "Hack Night", start: "2026-11-01T12:30:00.000Z", end: "2026-11-01T15:30:00.000Z", location: "Auditorium" }}
            />
        );
        await user.click(screen.getByRole("button", { name: /add to calendar/i }));
        const google = screen.getByRole("menuitem", { name: /google calendar/i });
        expect(google.getAttribute("href")).toContain("dates=20261101T123000Z%2F20261101T153000Z");
        expect(screen.getByRole("menuitem", { name: /\.ics/i })).toHaveAttribute("href", "/api/calendar/events/e1.ics");
    });
});
