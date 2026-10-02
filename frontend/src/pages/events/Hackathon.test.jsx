import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import HackathonPage from "./HackathonPage";
import { CertificatesCard, FeedbackCard, ReminderDialog } from "../../components/events/EventExtras";
import { certificateApi, eventApi, hackathonApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    eventApi: { get: vi.fn(), feedback: vi.fn(), giveFeedback: vi.fn(), certificates: vi.fn(), update: vi.fn(), sendReminder: vi.fn() },
    hackathonApi: { get: vi.fn(), chooseProblem: vi.fn(), submitRepo: vi.fn(), submitProject: vi.fn(), judging: vi.fn(), score: vi.fn(), leaderboard: vi.fn(), draftResults: vi.fn() },
    certificateApi: { download: vi.fn() },
    userApi: { search: vi.fn(() => Promise.resolve({ data: [] })) }
}));

const at = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
const event = { _id: "e1", title: "HackNight", startAt: at(-60), endAt: at(600), club: { _id: "c1", name: "Coding Club" }, category: "HACKATHON" };
const criteria = [
    { _id: "k1", name: "Innovation", maxScore: 10 },
    { _id: "k2", name: "Presentation", maxScore: 10 }
];
const hack = (overrides = {}) => ({
    eventId: "e1",
    phase: "SELECTION",
    revealAt: at(-60),
    selectionDeadline: at(30),
    repoDeadline: at(90),
    submissionDeadline: at(180),
    agenda: [{ _id: "a1", title: "Opening", startsAt: at(-60), note: "" }],
    criteria,
    maxTotal: 20,
    problemCount: 2,
    problemStatements: [
        { _id: "p1", title: "Smart parking", description: "Find free spots.", track: "Campus", maxTeams: null, teams: 1 },
        { _id: "p2", title: "Canteen queue", description: "Pre-order food.", track: "", maxTeams: 1, teams: 1 }
    ],
    judgeCount: 2,
    judges: [],
    myEntry: { name: "Alpha", problemStatement: null, project: null, repoSubmittedAt: null, submittedAt: null, members: 2 },
    viewer: { isParticipant: true, canManage: false, canJudge: false, canSeeLeaderboard: false, canDraftResults: false, canChooseProblem: true, canSubmitRepo: false, canSubmit: false },
    ...overrides
});

describe("Hackathon hub", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        eventApi.get.mockResolvedValue({ data: event });
    });

    test("stage 1 and 2: a team picks a problem, then adds its code repository", async () => {
        const chosen = { name: "Alpha", problemStatement: { _id: "p1", title: "Smart parking" }, project: null, repoSubmittedAt: null, submittedAt: null, members: 2 };
        hackathonApi.get.mockResolvedValue({ data: hack() });
        hackathonApi.chooseProblem.mockResolvedValue({ data: hack({ myEntry: chosen, viewer: { ...hack().viewer, canSubmitRepo: true } }) });
        hackathonApi.submitRepo.mockResolvedValue({
            data: hack({ myEntry: { ...chosen, project: { repoUrl: "https://github.com/alpha/parkit" }, repoSubmittedAt: at(0) }, viewer: { ...hack().viewer, canSubmitRepo: true } })
        });
        renderWithRouter(<HackathonPage />, { route: "/events/e1/hackathon", path: "/events/:id/hackathon" });

        expect(await screen.findByText(/Problem selection closes in/)).toBeInTheDocument();
        // "Canteen queue" already has its one team.
        const canteen = screen.getByText("Canteen queue").closest("article");
        expect(within(canteen).getByRole("button", { name: "Full" })).toBeDisabled();
        expect(screen.queryByLabelText(/Code repository/)).not.toBeInTheDocument();
        await userEvent.click(within(screen.getByText("Smart parking").closest("article")).getByRole("button", { name: "Choose this problem" }));
        await waitFor(() => expect(hackathonApi.chooseProblem).toHaveBeenCalledWith("e1", "p1"));

        await userEvent.type(await screen.findByLabelText(/Code repository/), "https://github.com/alpha/parkit");
        await userEvent.click(screen.getByRole("button", { name: /Save repository/ }));
        await waitFor(() => expect(hackathonApi.submitRepo).toHaveBeenCalledWith("e1", { repoUrl: "https://github.com/alpha/parkit" }));
        expect(await screen.findByRole("button", { name: "Change" })).toBeInTheDocument();
        // The final submission isn't open until the repository deadline.
        expect(screen.queryByLabelText(/Project name/)).not.toBeInTheDocument();
        expect(screen.getByText(/Opens .* · due .* — live demo, video and slides/)).toBeInTheDocument();
    });

    test("stage 3: after the repository deadline, the team makes its final submission", async () => {
        const entry = { name: "Alpha", problemStatement: { _id: "p1", title: "Smart parking" }, project: { repoUrl: "https://github.com/alpha/parkit" }, repoSubmittedAt: at(-30), submittedAt: null, members: 2 };
        hackathonApi.get.mockResolvedValue({ data: hack({ phase: "FINAL", selectionDeadline: at(-60), repoDeadline: at(-5), myEntry: entry, viewer: { ...hack().viewer, canChooseProblem: false, canSubmit: true } }) });
        hackathonApi.submitProject.mockResolvedValue({ data: hack() });
        renderWithRouter(<HackathonPage />, { route: "/events/e1/hackathon", path: "/events/:id/hackathon" });

        expect(await screen.findByText(/Final submissions close in/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/Code repository/)).not.toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/Project name/), "ParkIt");
        await userEvent.type(screen.getByLabelText(/What did you build/), "A live map of free parking spots.");
        await userEvent.type(screen.getByLabelText(/Live demo/), "https://parkit.example.com");
        await userEvent.click(screen.getByRole("button", { name: /Submit project/ }));
        await waitFor(() =>
            expect(hackathonApi.submitProject).toHaveBeenCalledWith("e1", expect.objectContaining({ title: "ParkIt", demoUrl: "https://parkit.example.com" }))
        );
        expect(hackathonApi.submitProject.mock.calls[0][1]).not.toHaveProperty("repoUrl");
    });

    test("before the start, problems are hidden and teams are told when they come out", async () => {
        hackathonApi.get.mockResolvedValue({ data: hack({ phase: "UPCOMING", revealAt: at(60), problemStatements: [], viewer: { ...hack().viewer, canChooseProblem: false, canSubmit: false } }) });
        renderWithRouter(<HackathonPage />, { route: "/events/e1/hackathon", path: "/events/:id/hackathon" });
        expect(await screen.findByText("2 problem statements waiting")).toBeInTheDocument();
        expect(screen.queryByText("Smart parking")).not.toBeInTheDocument();
    });

    test("a judge scores each project on the criteria", async () => {
        hackathonApi.get.mockResolvedValue({ data: hack({ phase: "JUDGING", myEntry: null, viewer: { isParticipant: false, canJudge: true } }) });
        const panel = {
            open: true,
            criteria,
            maxTotal: 20,
            scored: 0,
            entries: [{ _id: "x1", name: "Beta", problemStatement: { _id: "p1", title: "Smart parking" }, project: { title: "ParkIt", summary: "Map of spots", repoUrl: "https://github.com/b/p" }, myScore: null }]
        };
        hackathonApi.judging.mockResolvedValue({ data: panel });
        hackathonApi.score.mockResolvedValue({ data: { ...panel, scored: 1 } });
        renderWithRouter(<HackathonPage />, { route: "/events/e1/hackathon?tab=judging", path: "/events/:id/hackathon" });

        const card = (await screen.findByText("ParkIt")).closest("article");
        const save = within(card).getByRole("button", { name: /Save score/ });
        expect(save).toBeDisabled();
        await userEvent.type(within(card).getByLabelText("Innovation for Beta"), "8");
        await userEvent.type(within(card).getByLabelText("Presentation for Beta"), "7");
        expect(within(card).getByText("15")).toBeInTheDocument();
        await userEvent.click(save);
        await waitFor(() =>
            expect(hackathonApi.score).toHaveBeenCalledWith("e1", "x1", {
                marks: [
                    { criterion: "k1", score: 8 },
                    { criterion: "k2", score: 7 }
                ],
                comment: ""
            })
        );
    });
});

describe("event page additions", () => {
    beforeEach(() => vi.clearAllMocks());

    const past = { _id: "e2", title: "Quiz Night", status: "COMPLETED", startAt: at(-300), endAt: at(-60), certificatesEnabled: true, viewer: { canManage: false } };

    test("attendees rate the event with stars and a note", async () => {
        eventApi.feedback.mockResolvedValue({ data: { state: "OPEN", canGive: true, mine: null, summary: null, closesAt: at(20000) } });
        eventApi.giveFeedback.mockResolvedValue({ data: { state: "OPEN", canGive: true, mine: { rating: 4, note: "Fun" }, summary: null, closesAt: at(20000) } });
        renderWithRouter(<FeedbackCard event={past} />);
        await userEvent.click(await screen.findByRole("radio", { name: "4 stars" }));
        await userEvent.type(screen.getByLabelText(/keep or change/), "Fun");
        await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
        await waitFor(() => expect(eventApi.giveFeedback).toHaveBeenCalledWith("e2", { rating: 4, note: "Fun" }));
        expect(await screen.findByText("You rated it very good")).toBeInTheDocument();
    });

    test("organisers see the average and anonymous notes", async () => {
        eventApi.feedback.mockResolvedValue({
            data: { state: "OPEN", canGive: false, mine: null, closesAt: at(20000), summary: { count: 2, average: 4.5, attendees: 10, distribution: [0, 0, 0, 1, 1], notes: [{ rating: 5, note: "Loved it", at: at(-30) }] } }
        });
        renderWithRouter(<FeedbackCard event={{ ...past, viewer: { canManage: true } }} />);
        expect(await screen.findByText("4.5")).toBeInTheDocument();
        expect(screen.getByText("2 of 10 attendees rated it")).toBeInTheDocument();
        expect(screen.getByText("Loved it")).toBeInTheDocument();
    });

    test("students download their certificates", async () => {
        eventApi.certificates.mockResolvedValue({ data: { enabled: true, items: [{ code: "CERT-ABCDEFGHJK", kind: "MERIT", awardTitle: "Winner", teamName: "Alpha" }] } });
        certificateApi.download.mockResolvedValue();
        renderWithRouter(<CertificatesCard event={past} onChange={vi.fn()} />);
        expect(await screen.findByText("Certificate of Merit — Winner")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /PDF/ }));
        expect(certificateApi.download).toHaveBeenCalledWith("CERT-ABCDEFGHJK");
    });

    test("the reminder dialog sends the chosen reminder with a note", async () => {
        eventApi.sendReminder.mockResolvedValue({ message: "Reminder sent to 40 students", data: { recipients: 40 } });
        const live = {
            _id: "e3",
            status: "PUBLISHED",
            viewer: {
                reminders: {
                    REGISTRATION_CLOSING: { available: true, reason: null, lastSentAt: null },
                    EVENT_STARTING: { available: false, reason: "Sent 1 hour ago — you can send another after 4:00 pm", lastSentAt: at(-60), lastRecipients: 12 }
                }
            }
        };
        const onClose = vi.fn();
        renderWithRouter(<ReminderDialog event={live} open onClose={onClose} />);
        expect(screen.getByText(/Eligible students who haven't registered/)).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/Add a note/), "10 seats left");
        await userEvent.click(screen.getByRole("button", { name: /Send reminder/ }));
        await waitFor(() => expect(eventApi.sendReminder).toHaveBeenCalledWith("e3", "REGISTRATION_CLOSING", "10 seats left"));
        expect(onClose).toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: "Event starting" }));
        expect(screen.getByText(/you can send another after/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Send reminder/ })).toBeDisabled();
    });
});
