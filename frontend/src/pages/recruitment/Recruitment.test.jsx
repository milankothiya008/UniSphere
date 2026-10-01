import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import DriveFormPage from "./DriveFormPage";
import ApplyPage from "./ApplyPage";
import { RoundsPanel } from "../../components/recruitment/RoundsPanel";
import { MyApplicationCard } from "../../components/recruitment/MyApplicationCard";
import { clubApi, recruitmentApi, referenceApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    clubApi: { roles: vi.fn() },
    recruitmentApi: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        submit: vi.fn(),
        myApplication: vi.fn(),
        apply: vi.fn(),
        updateApplication: vi.fn(),
        withdraw: vi.fn(),
        acceptOffer: vi.fn(),
        declineOffer: vi.fn(),
        uploadTickets: vi.fn(),
        rounds: vi.fn(),
        createRound: vi.fn(),
        scheduleRound: vi.fn(),
        setOutcomes: vi.fn(),
        publishRound: vi.fn(),
        finalize: vi.fn(),
        offerToReserve: vi.fn()
    },
    referenceApi: { batches: vi.fn(), venues: vi.fn(), availableVenues: vi.fn() }
}));

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

const techForm = {
    pages: [
        { _id: "g1", title: "About you", description: "", questions: [{ _id: "q1", type: "PARAGRAPH", label: "Why this role?", required: true, options: [] }] },
        {
            _id: "g2",
            title: "Your skills",
            description: "Show us what you've built",
            questions: [
                { _id: "q2", type: "SINGLE_CHOICE", label: "Your year", required: true, options: ["First", "Second"] },
                { _id: "q3", type: "LINK", label: "GitHub", required: false, options: [] }
            ]
        }
    ]
};

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
        { _id: "p1", role: "TECHNICAL_COORDINATOR", title: "Technical coordinator", openings: 2, description: "Build demos", form: techForm, questionCount: 3, rounds: [] },
        { _id: "p2", role: "MEMBER", title: "Member", openings: null, description: "", form: { pages: [] }, questionCount: 0, rounds: [] }
    ],
    viewer: { canManage: false, isMentor: false, canApply: true, applications: [] },
    ...overrides
});

const clubRoles = {
    canManage: true,
    roles: [
        { key: "PRESIDENT", name: "President", unique: true, holder: { _id: "u9", name: "Aarav" } },
        { key: "VICE_PRESIDENT", name: "Vice-president", unique: true, holder: { _id: "u8", name: "Meera" } },
        { key: "R_design", name: "Design lead", unique: false, holder: null },
        { key: "TECHNICAL_COORDINATOR", name: "Technical coordinator", unique: false, holder: null },
        { key: "MEMBER", name: "Member", unique: false, holder: null }
    ]
};

describe("recruitment drive builder", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
        referenceApi.batches.mockResolvedValue({ data: [{ _id: "b1", code: "24" }, { _id: "b2", code: "25" }] });
        clubApi.roles.mockResolvedValue({ data: clubRoles });
    });

    test("roles come from the club; each gets its own page-wise form, and forms can be copied between roles", async () => {
        recruitmentApi.create.mockResolvedValue({ data: { _id: "new" } });
        recruitmentApi.submit.mockResolvedValue({ data: {} });
        renderWithRouter(<DriveFormPage />, { route: "/clubs/c1/recruitment/new", path: "/clubs/:id/recruitment/new" });

        // The presidency is never recruited, and a taken vice-president seat can't be.
        const picker = await screen.findByRole("group", { name: "Roles you can recruit for" });
        expect(within(picker).queryByRole("button", { name: /President/ })).not.toBeInTheDocument();
        expect(within(picker).getByRole("button", { name: /Vice-president/ })).toBeDisabled();

        await userEvent.type(screen.getByLabelText(/^Title/), "Core team 2026");
        await userEvent.type(screen.getByLabelText(/What you're looking for/), "Builders wanted");
        await userEvent.click(screen.getByRole("button", { name: /Save and send for approval/ }));
        expect(await screen.findByText("Choose at least one role you're recruiting for")).toBeInTheDocument();

        // Design lead: starts with two pages; add a third and leave its title empty → blocked.
        await userEvent.click(within(picker).getByRole("button", { name: /Design lead/ }));
        // Questions show as compact rows; clicking one opens it for editing.
        await userEvent.click(screen.getByRole("button", { name: /Edit question 1: Why do you want to be Design lead\?/ }));
        expect(screen.getByDisplayValue("Why do you want to be Design lead?")).toBeInTheDocument();
        expect(screen.getAllByLabelText(/^Page title/).map((input) => input.value)).toEqual(["About you", "Experience"]);
        await userEvent.click(screen.getByRole("button", { name: /Add page/ }));
        await userEvent.clear(screen.getAllByLabelText(/^Page title/)[2]);
        await userEvent.click(screen.getByRole("button", { name: /Save and send for approval/ }));
        expect(recruitmentApi.create).not.toHaveBeenCalled();
        expect(await screen.findByText("Give this page a title")).toBeInTheDocument();
        expect(within(screen.getByRole("tab", { name: /Design lead/ })).getByText("1")).toBeInTheDocument();
        await userEvent.type(screen.getAllByLabelText(/^Page title/)[2], "Portfolio");
        await userEvent.click(screen.getByRole("button", { name: /Add page/ }));
        await userEvent.click(screen.getByRole("button", { name: "Page 4 actions" }));
        await userEvent.click(screen.getByRole("menuitem", { name: /Delete page/ }));

        // Technical coordinator copies the Design lead form, then changes its own.
        // More roles come from the "Add role" menu at the end of the role tabs; the taken VP seat stays disabled.
        await userEvent.click(screen.getByRole("button", { name: /Add role/ }));
        expect(screen.getByRole("menuitem", { name: /Vice-president — held by Meera/ })).toBeDisabled();
        await userEvent.click(screen.getByRole("menuitem", { name: /Technical coordinator/ }));
        expect(screen.getByRole("tab", { name: /Technical coordinator/ })).toHaveAttribute("aria-selected", "true");
        await userEvent.click(screen.getByRole("button", { name: "Technical coordinator options" }));
        await userEvent.click(screen.getByRole("menuitem", { name: "Copy form from Design lead" }));
        expect(screen.getAllByLabelText(/^Page title/).map((input) => input.value)).toEqual(["About you", "Experience", "Portfolio"]);
        await userEvent.click(screen.getByRole("button", { name: "Page 3 actions" }));
        await userEvent.click(screen.getByRole("menuitem", { name: /Delete page/ }));
        await userEvent.type(screen.getByLabelText("Openings"), "2");

        await userEvent.click(screen.getByLabelText("2025"));
        await userEvent.click(screen.getByRole("button", { name: /Save and send for approval/ }));

        await waitFor(() => expect(recruitmentApi.create).toHaveBeenCalled());
        const [clubId, body] = recruitmentApi.create.mock.calls[0];
        expect(clubId).toBe("c1");
        expect(body).toMatchObject({ title: "Core team 2026", eligibility: { batches: ["25"] } });
        expect(body.positions.map((position) => [position.role, position.openings, position.form.pages.map((page) => page.title)])).toEqual([
            ["R_design", null, ["About you", "Experience", "Portfolio"]],
            ["TECHNICAL_COORDINATOR", 2, ["About you", "Experience"]]
        ]);
        expect(body.positions[1].form.pages[0].questions[0]).toMatchObject({ type: "PARAGRAPH", label: "Why do you want to be Design lead?", required: true });
        expect(recruitmentApi.submit).toHaveBeenCalledWith("new");
    }, 15000); // A long, many-step form test: slow when the whole suite runs in parallel.
});

describe("applying, page by page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    const renderApply = () => renderWithRouter(<ApplyPage />, { route: "/recruitment/d1/apply/p1", path: "/recruitment/:id/apply/:positionId" });

    test("Next is blocked until the page is complete, Back keeps the answers, and the review step submits", async () => {
        recruitmentApi.get.mockResolvedValue({ data: drive() });
        recruitmentApi.apply.mockResolvedValue({ data: {} });
        renderApply();

        // Step 1: details from the profile and the role.
        expect(await screen.findByText("Asha Patel")).toBeInTheDocument();
        expect(screen.getByText(/24ce1234@ddu.ac.in · CE · Batch 2024/)).toBeInTheDocument();
        expect(screen.getByText("The role: Technical coordinator")).toBeInTheDocument();
        expect(screen.getByText(/you can join the club in only one role/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Start/ }));

        // Step 2: "About you" — required answer.
        expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(screen.getByText("This question is required")).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText("Why this role?"), "I love building");
        await userEvent.click(screen.getByRole("button", { name: /Next/ }));

        // Step 3: skills — a bad link blocks Next; Back keeps page 2's answer.
        expect(screen.getByText("Show us what you've built")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("radio", { name: "Second" }));
        await userEvent.type(screen.getByLabelText("GitHub"), "github.com/asha");
        await userEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(screen.getByText(/full link, starting with https/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Back/ }));
        expect(screen.getByLabelText("Why this role?")).toHaveValue("I love building");
        await userEvent.click(screen.getByRole("button", { name: /Next/ }));
        expect(screen.getByRole("radio", { name: "Second" })).toHaveAttribute("aria-checked", "true");
        await userEvent.clear(screen.getByLabelText("GitHub"));
        await userEvent.type(screen.getByLabelText("GitHub"), "https://github.com/asha");
        await userEvent.click(screen.getByRole("button", { name: /Next/ }));

        // Review, then submit.
        expect(screen.getByText("Applying for Technical coordinator")).toBeInTheDocument();
        expect(screen.getByText("https://github.com/asha")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Submit application/ }));
        await waitFor(() => expect(recruitmentApi.apply).toHaveBeenCalled());
        expect(recruitmentApi.apply.mock.calls[0].slice(0, 2)).toEqual(["d1", "p1"]);
        expect(recruitmentApi.apply.mock.calls[0][2]).toEqual({
            answers: [
                { question: "q1", text: "I love building", choices: [] },
                { question: "q2", text: "", choices: ["Second"] },
                { question: "q3", text: "https://github.com/asha", choices: [] }
            ]
        });
    });

    test("students who can't apply are told why", async () => {
        recruitmentApi.get.mockResolvedValue({ data: drive({ viewer: { canApply: false, applyProblem: "Coding Club recruits students from CE", applications: [] } }) });
        renderApply();
        expect(await screen.findByText("Coding Club recruits students from CE")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Start/ })).not.toBeInTheDocument();
    });
});

describe("offers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("accepting one offer warns that the student's other applications will close", async () => {
        useAuth.mockReturnValue(authValue({ user: { ...authValue().user, phone: "+919876543210" } }));
        recruitmentApi.acceptOffer.mockResolvedValue({ message: "Offer accepted — welcome to the club!", data: [] });
        const onChange = vi.fn();
        const offer = { _id: "a1", position: "p1", positionTitle: "Technical coordinator", status: "OFFERED", offerExpiresAt: inDays(2), rounds: [], createdAt: inDays(-5), canEdit: false, canWithdraw: false };
        const other = { _id: "a2", position: "p2", positionTitle: "Member", status: "IN_ROUNDS" };
        renderWithRouter(<MyApplicationCard drive={drive()} application={offer} others={[other]} onChange={onChange} />);

        expect(screen.getByText("You've been offered Technical coordinator!")).toBeInTheDocument();
        expect(screen.getByText(/Answer within/)).toBeInTheDocument();
        expect(screen.getByText(/Accepting closes your Member application/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Accept offer/ }));
        const dialog = screen.getByRole("dialog", { name: "Join Coding Club as Technical coordinator?" });
        expect(within(dialog).getByText(/your other application \(Member\) will be closed/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Accept and join" }));
        await waitFor(() => expect(recruitmentApi.acceptOffer).toHaveBeenCalledWith("d1", "a1"));
        expect(onChange).toHaveBeenCalled();
    });

    test("a student without a mobile number gives one when accepting", async () => {
        const setUser = vi.fn();
        useAuth.mockReturnValue(authValue({ setUser }));
        recruitmentApi.acceptOffer.mockResolvedValue({ message: "Offer accepted — welcome to the club!", data: [] });
        const offer = { _id: "a1", position: "p1", positionTitle: "Technical coordinator", status: "OFFERED", offerExpiresAt: inDays(2), rounds: [], createdAt: inDays(-5) };
        renderWithRouter(<MyApplicationCard drive={drive()} application={offer} onChange={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: /Accept offer/ }));
        const dialog = screen.getByRole("dialog", { name: "Join Coding Club as Technical coordinator?" });
        const join = within(dialog).getByRole("button", { name: "Accept and join" });
        expect(join).toBeDisabled();
        await userEvent.type(within(dialog).getByLabelText(/Your mobile number/), "12345");
        expect(within(dialog).getByText("Enter a 10-digit Indian mobile number")).toBeInTheDocument();
        expect(join).toBeDisabled();
        await userEvent.clear(within(dialog).getByLabelText(/Your mobile number/));
        await userEvent.type(within(dialog).getByLabelText(/Your mobile number/), "98765 43210");
        await userEvent.click(join);
        await waitFor(() => expect(recruitmentApi.acceptOffer).toHaveBeenCalledWith("d1", "a1", { phone: "+919876543210" }));
        expect(setUser).toHaveBeenCalled();
    });

    test("an application waiting for news starts folded; it opens on click and keeps Edit/Withdraw in its menu", async () => {
        recruitmentApi.withdraw.mockResolvedValue({ data: null });
        const onChange = vi.fn();
        const application = { _id: "a2", position: "p2", positionTitle: "Member", status: "APPLIED", rounds: [], createdAt: inDays(-1), canEdit: true, canWithdraw: true };
        renderWithRouter(<MyApplicationCard drive={drive()} application={application} onChange={onChange} />);

        const toggle = screen.getByRole("button", { name: /Your application\s*Member/ });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("Final selection")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Member application actions" }));
        expect(screen.getByRole("menuitem", { name: /Edit answers/ })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("menuitem", { name: /Withdraw application/ }));
        await userEvent.click(within(screen.getByRole("dialog", { name: "Withdraw your Member application?" })).getByRole("button", { name: "Withdraw" }));
        await waitFor(() => expect(recruitmentApi.withdraw).toHaveBeenCalledWith("d1", "p2"));
        expect(onChange).toHaveBeenCalled();
    });

    test("an expired offer can't be accepted", () => {
        const offer = { _id: "a1", position: "p1", positionTitle: "Technical coordinator", status: "OFFERED", offerExpiresAt: inDays(-1), rounds: [], createdAt: inDays(-5) };
        renderWithRouter(<MyApplicationCard drive={drive()} application={offer} onChange={vi.fn()} />);
        expect(screen.getByText("The deadline has passed")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Accept offer/ })).toBeDisabled();
    });
});

describe("selection per role", () => {
    const position = drive().positions[0];
    const candidate = (id, name, extra = {}) => ({ applicationId: id, applicant: { _id: `u${id}`, name, email: `${name.toLowerCase()}@ddu.ac.in` }, outcome: null, published: false, slot: null, ...extra });
    const rounds = (overrides = {}) => ({
        data: {
            phase: "ROUNDS",
            position: { _id: "p1", title: "Technical coordinator", role: "TECHNICAL_COORDINATOR", openings: 2, finalizedAt: null, offerDays: 3 },
            activeCount: 2,
            canAddRound: false,
            canFinalize: false,
            finalists: [],
            offers: [],
            seats: { openings: 2, accepted: 0, pending: 0, open: 2 },
            canOfferReserve: false,
            rounds: [{ _id: "r1", name: "Screening", mode: "SCREENING", status: "DRAFT", isCurrent: true, candidates: [candidate("a1", "Asha"), candidate("a2", "Bina")] }],
            ...overrides
        }
    });

    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("the president qualifies or eliminates each candidate for the role, then publishes the results", async () => {
        recruitmentApi.rounds.mockResolvedValueOnce(rounds());
        recruitmentApi.setOutcomes.mockResolvedValue({ data: {} });
        recruitmentApi.rounds.mockResolvedValue(
            rounds({ rounds: [{ _id: "r1", name: "Screening", mode: "SCREENING", status: "DRAFT", isCurrent: true, candidates: [candidate("a1", "Asha", { outcome: "QUALIFIED" }), candidate("a2", "Bina", { outcome: "ELIMINATED" })] }] })
        );
        recruitmentApi.publishRound.mockResolvedValue({ message: "Results published — every candidate is being emailed" });
        renderWithRouter(<RoundsPanel drive={drive({ phase: "ROUNDS", viewer: { canManage: true } })} position={position} onDriveChange={vi.fn()} />);

        expect(await screen.findByText("0")).toBeInTheDocument();
        expect(recruitmentApi.rounds).toHaveBeenCalledWith("d1", "p1");
        expect(screen.getByRole("button", { name: /Publish results/ })).toBeDisabled();
        await userEvent.click(within(screen.getByRole("group", { name: "Result for Asha" })).getByRole("button", { name: /Qualify/ }));
        expect(recruitmentApi.setOutcomes).toHaveBeenCalledWith("d1", "p1", "r1", [{ applicationId: "a1", outcome: "QUALIFIED" }]);

        await waitFor(() => expect(screen.getByRole("button", { name: /Publish results/ })).toBeEnabled());
        await userEvent.click(screen.getByRole("button", { name: /Publish results/ }));
        const dialog = screen.getByRole("dialog", { name: "Publish the results of Screening?" });
        expect(within(dialog).getByText(/1 candidate qualify and 1 candidate is eliminated/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Publish results" }));
        await waitFor(() => expect(recruitmentApi.publishRound).toHaveBeenCalledWith("d1", "p1", "r1"));
    });

    test("final selection: offers up to the openings, a reserve list and not selected", async () => {
        recruitmentApi.rounds.mockResolvedValue(
            rounds({
                rounds: [],
                activeCount: 3,
                canAddRound: true,
                canFinalize: true,
                finalists: ["Asha", "Bina", "Chirag"].map((name, index) => ({ applicationId: `a${index + 1}`, applicant: { name, email: `${name}@ddu.ac.in` } }))
            })
        );
        recruitmentApi.finalize.mockResolvedValue({ message: "Final selection sent — offers are on their way", data: {} });
        renderWithRouter(<RoundsPanel drive={drive({ phase: "CLOSED", viewer: { canManage: true } })} position={position} onDriveChange={vi.fn()} />);

        expect(await screen.findByText("Add round 1")).toBeInTheDocument();
        const send = screen.getByRole("button", { name: /Send offers/ });
        expect(send).toBeDisabled();
        for (const name of ["Asha", "Bina", "Chirag"]) {
            await userEvent.click(within(screen.getByRole("group", { name: `Decision for ${name}` })).getByRole("button", { name: /Offer/ }));
        }
        // Three offers for two openings is refused.
        expect(screen.getByText(/has 2 openings/)).toBeInTheDocument();
        expect(send).toBeDisabled();
        await userEvent.click(within(screen.getByRole("group", { name: "Decision for Chirag" })).getByRole("button", { name: /Reserve/ }));
        expect(send).toBeEnabled();
        await userEvent.clear(screen.getByLabelText("Days to answer an offer"));
        await userEvent.type(screen.getByLabelText("Days to answer an offer"), "5");
        await userEvent.click(send);
        const dialog = screen.getByRole("dialog", { name: "Send the Technical coordinator results?" });
        expect(within(dialog).getByText(/2 students get offers to answer within 5 days, 1 goes on the reserve list/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Send results" }));
        await waitFor(() =>
            expect(recruitmentApi.finalize).toHaveBeenCalledWith("d1", "p1", {
                offerDays: 5,
                decisions: [
                    { applicationId: "a1", decision: "OFFER" },
                    { applicationId: "a2", decision: "OFFER" },
                    { applicationId: "a3", decision: "RESERVE" }
                ]
            })
        );
    });

    test("a freed seat is offered to someone on the reserve list", async () => {
        recruitmentApi.rounds.mockResolvedValue(
            rounds({
                rounds: [],
                position: { _id: "p1", title: "Technical coordinator", role: "TECHNICAL_COORDINATOR", openings: 2, finalizedAt: inDays(-1), offerDays: 3 },
                offers: [
                    { applicationId: "a1", applicant: { name: "Asha", email: "asha@ddu.ac.in" }, status: "ACCEPTED", respondedAt: inDays(-1) },
                    { applicationId: "a2", applicant: { name: "Bina", email: "bina@ddu.ac.in" }, status: "DECLINED", respondedAt: inDays(-1) },
                    { applicationId: "a3", applicant: { name: "Chirag", email: "chirag@ddu.ac.in" }, status: "RESERVE" }
                ],
                seats: { openings: 2, accepted: 1, pending: 0, open: 1 },
                canOfferReserve: true
            })
        );
        recruitmentApi.offerToReserve.mockResolvedValue({ message: "Offer sent" });
        renderWithRouter(<RoundsPanel drive={drive({ phase: "ROUNDS", viewer: { canManage: true } })} position={position} onDriveChange={vi.fn()} />);

        expect(await screen.findByText("A seat is free")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Offer seat/ }));
        await userEvent.click(within(screen.getByRole("dialog", { name: "Offer Technical coordinator to Chirag?" })).getByRole("button", { name: "Send offer" }));
        await waitFor(() => expect(recruitmentApi.offerToReserve).toHaveBeenCalledWith("d1", "p1", "a3"));
    });
});
