import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import DriveFormPage from "./DriveFormPage";
import ApplyPage from "./ApplyPage";
import { RoundsPanel } from "../../components/recruitment/RoundsPanel";
import { recruitmentApi, referenceApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    recruitmentApi: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        submit: vi.fn(),
        myApplication: vi.fn(),
        apply: vi.fn(),
        updateApplication: vi.fn(),
        uploadTickets: vi.fn(),
        rounds: vi.fn(),
        createRound: vi.fn(),
        scheduleRound: vi.fn(),
        setOutcomes: vi.fn(),
        publishRound: vi.fn(),
        finalize: vi.fn()
    },
    referenceApi: { batches: vi.fn(), venues: vi.fn(), availableVenues: vi.fn() }
}));

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

const drive = (overrides = {}) => ({
    _id: "d1",
    club: { _id: "c1", name: "Coding Club", departmentCodes: ["CE"], allDepartments: false },
    title: "Core team 2026",
    description: "Join us",
    status: "PUBLISHED",
    phase: "OPEN",
    applicationStart: inDays(-1),
    applicationEnd: inDays(5),
    closedAt: null,
    eligibility: { batches: [] },
    positions: [
        { _id: "p1", role: "TECHNICAL_COORDINATOR", title: "Tech lead", openings: 2 },
        { _id: "p2", role: "MEMBER", title: "Member", openings: null }
    ],
    questions: [
        { _id: "q1", type: "PARAGRAPH", label: "Why do you want to join?", required: true, options: [] },
        { _id: "q2", type: "SINGLE_CHOICE", label: "Your year", required: true, options: ["First", "Second"] },
        { _id: "q3", type: "LINK", label: "GitHub", required: false, options: [] }
    ],
    rounds: [],
    viewer: { canManage: false, isMentor: false, canApply: true, application: null },
    ...overrides
});

describe("recruitment drive builder", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
        referenceApi.batches.mockResolvedValue({ data: [{ _id: "b1", code: "24" }, { _id: "b2", code: "25" }] });
    });

    test("starts with a sensible form; questions can be added, reordered and validated; saving sends it for approval", async () => {
        recruitmentApi.create.mockResolvedValue({ data: { _id: "new" } });
        recruitmentApi.submit.mockResolvedValue({ data: {} });
        renderWithRouter(<DriveFormPage />, { route: "/clubs/c1/recruitment/new", path: "/clubs/:id/recruitment/new", extraRoutes: null });

        expect(await screen.findByDisplayValue("Why do you want to join the club?")).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText(/^Title/), "Core team 2026");
        await userEvent.type(screen.getByLabelText(/What you're looking for/), "Builders wanted");

        // Add a checkbox question, leave its options empty → blocked.
        await userEvent.click(screen.getByRole("button", { name: /Checkboxes \(several\)/ }));
        await userEvent.click(screen.getByRole("button", { name: /Save and send for approval/ }));
        expect(recruitmentApi.create).not.toHaveBeenCalled();
        expect(await screen.findByText("Write the question")).toBeInTheDocument();

        const questions = screen.getAllByLabelText(/^Question/);
        await userEvent.type(questions[questions.length - 1], "Skills");
        const firsts = screen.getAllByLabelText("Option 1");
        const seconds = screen.getAllByLabelText("Option 2");
        await userEvent.type(firsts[firsts.length - 1], "Web");
        await userEvent.type(seconds[seconds.length - 1], "Design");

        // Move the new question to the top.
        const moveUps = screen.getAllByRole("button", { name: "Move up" });
        await userEvent.click(moveUps[moveUps.length - 1]);
        await userEvent.click(screen.getAllByRole("button", { name: "Move up" })[2]);
        await userEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);

        await userEvent.click(screen.getByLabelText("2025"));
        await userEvent.click(screen.getByRole("button", { name: /Save and send for approval/ }));

        await waitFor(() => expect(recruitmentApi.create).toHaveBeenCalled());
        const [clubId, body] = recruitmentApi.create.mock.calls[0];
        expect(clubId).toBe("c1");
        expect(body).toMatchObject({ title: "Core team 2026", eligibility: { batches: ["25"] } });
        expect(body.questions[0]).toMatchObject({ type: "MULTI_CHOICE", label: "Skills", options: ["Web", "Design"] });
        expect(body.questions).toHaveLength(4);
        expect(body.positions).toEqual([expect.objectContaining({ role: "MEMBER", title: "Member", openings: null })]);
        expect(recruitmentApi.submit).toHaveBeenCalledWith("new");
    });
});

describe("applying", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("profile details are filled in; positions and required answers are checked before submitting", async () => {
        recruitmentApi.get.mockResolvedValue({ data: drive() });
        recruitmentApi.apply.mockResolvedValue({ data: {} });
        renderWithRouter(<ApplyPage />, { route: "/recruitment/d1/apply", path: "/recruitment/:id/apply" });

        expect(await screen.findByText("Asha Patel")).toBeInTheDocument();
        expect(screen.getByText(/24ce1234@ddu.ac.in · CE · Batch 2024/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Submit application/ }));
        expect(recruitmentApi.apply).not.toHaveBeenCalled();
        expect(screen.getByText("Choose at least one position")).toBeInTheDocument();
        expect(screen.getAllByText("This question is required")).toHaveLength(2);

        await userEvent.click(screen.getByRole("button", { name: /Member/ }));
        await userEvent.click(screen.getByRole("button", { name: /Tech lead/ }));
        expect(within(screen.getByRole("button", { name: /Member/ })).getByText("1")).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText("Why do you want to join?"), "I love building");
        await userEvent.click(screen.getByRole("radio", { name: "Second" }));
        await userEvent.type(screen.getByLabelText("GitHub"), "github.com/asha");
        await userEvent.click(screen.getByRole("button", { name: /Submit application/ }));
        expect(screen.getByText(/full link, starting with https/)).toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText("GitHub"));
        await userEvent.type(screen.getByLabelText("GitHub"), "https://github.com/asha");
        await userEvent.click(screen.getByRole("button", { name: /Submit application/ }));
        await waitFor(() => expect(recruitmentApi.apply).toHaveBeenCalled());
        expect(recruitmentApi.apply.mock.calls[0][1]).toEqual({
            positions: ["p2", "p1"],
            answers: [
                { question: "q1", text: "I love building", choices: [] },
                { question: "q2", text: "", choices: ["Second"] },
                { question: "q3", text: "https://github.com/asha", choices: [] }
            ]
        });
    });

    test("students who can't apply are told why", async () => {
        recruitmentApi.get.mockResolvedValue({ data: drive({ viewer: { canApply: false, applyProblem: "Coding Club recruits students from CE", application: null } }) });
        renderWithRouter(<ApplyPage />, { route: "/recruitment/d1/apply", path: "/recruitment/:id/apply" });
        expect(await screen.findByText("Coding Club recruits students from CE")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Submit application/ })).not.toBeInTheDocument();
    });
});

describe("rounds", () => {
    const candidate = (id, name, extra = {}) => ({ applicationId: id, applicant: { _id: `u${id}`, name }, positionTitles: ["Tech lead"], outcome: null, published: false, slot: null, ...extra });
    const rounds = (overrides = {}) => ({
        data: {
            phase: "ROUNDS",
            activeCount: 2,
            canAddRound: false,
            canFinalize: false,
            finalists: [],
            rounds: [{ _id: "r1", name: "Screening", mode: "SCREENING", status: "DRAFT", isCurrent: true, candidates: [candidate("a1", "Asha"), candidate("a2", "Bina")] }],
            ...overrides
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("the president qualifies or eliminates each candidate, then publishes the results", async () => {
        recruitmentApi.rounds.mockResolvedValueOnce(rounds());
        recruitmentApi.setOutcomes.mockResolvedValue({ data: {} });
        recruitmentApi.rounds.mockResolvedValueOnce(
            rounds({ rounds: [{ _id: "r1", name: "Screening", mode: "SCREENING", status: "DRAFT", isCurrent: true, candidates: [candidate("a1", "Asha", { outcome: "QUALIFIED" }), candidate("a2", "Bina", { outcome: "ELIMINATED" })] }] })
        );
        recruitmentApi.publishRound.mockResolvedValue({ message: "Results published — every candidate is being emailed" });
        renderWithRouter(<RoundsPanel drive={drive({ phase: "ROUNDS", viewer: { canManage: true } })} onDriveChange={vi.fn()} />);

        expect(await screen.findByText("0")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Publish results/ })).toBeDisabled();
        await userEvent.click(within(screen.getByRole("group", { name: "Result for Asha" })).getByRole("button", { name: /Qualify/ }));
        expect(recruitmentApi.setOutcomes).toHaveBeenCalledWith("d1", "r1", [{ applicationId: "a1", outcome: "QUALIFIED" }]);

        await waitFor(() => expect(screen.getByRole("button", { name: /Publish results/ })).toBeEnabled());
        await userEvent.click(screen.getByRole("button", { name: /Publish results/ }));
        const dialog = screen.getByRole("dialog", { name: "Publish the results of Screening?" });
        expect(within(dialog).getByText(/1 candidate qualify and 1 candidate is eliminated/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Publish results" }));
        await waitFor(() => expect(recruitmentApi.publishRound).toHaveBeenCalledWith("d1", "r1"));
    });

    test("final selection: each finalist is selected with a role or not selected", async () => {
        recruitmentApi.rounds.mockResolvedValue(
            rounds({
                rounds: [],
                canAddRound: true,
                canFinalize: true,
                finalists: [
                    { applicationId: "a1", applicant: { name: "Asha" }, positions: ["p1"], positionTitles: ["Tech lead"] },
                    { applicationId: "a2", applicant: { name: "Bina" }, positions: ["p2"], positionTitles: ["Member"] }
                ]
            })
        );
        recruitmentApi.finalize.mockResolvedValue({ message: "Recruitment complete", data: {} });
        renderWithRouter(<RoundsPanel drive={drive({ phase: "CLOSED", viewer: { canManage: true } })} onDriveChange={vi.fn()} />);

        expect(await screen.findByText("Add round 1")).toBeInTheDocument();
        const complete = screen.getByRole("button", { name: /Complete recruitment/ });
        expect(complete).toBeDisabled();
        await userEvent.click(within(screen.getByRole("group", { name: "Decision for Asha" })).getByRole("button", { name: /Select/ }));
        expect(screen.getByLabelText("Role for Asha")).toHaveValue("TECHNICAL_COORDINATOR");
        await userEvent.click(within(screen.getByRole("group", { name: "Decision for Bina" })).getByRole("button", { name: /Not selected/ }));
        await userEvent.click(complete);
        await userEvent.click(within(screen.getByRole("dialog", { name: "Complete recruitment?" })).getByRole("button", { name: "Complete recruitment" }));
        await waitFor(() =>
            expect(recruitmentApi.finalize).toHaveBeenCalledWith("d1", [
                { applicationId: "a1", selected: true, role: "TECHNICAL_COORDINATOR" },
                { applicationId: "a2", selected: false, role: "MEMBER" }
            ])
        );
    });
});
