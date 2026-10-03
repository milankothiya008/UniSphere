import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { RegistrationPanel } from "./RegistrationPanel";
import { EventPost } from "./EventPost";
import { useAuth } from "../../context/AuthContext";
import { eventApi, likeApi } from "../../api/endpoints";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    eventApi: {
        ticket: vi.fn().mockResolvedValue({ data: null }),
        register: vi.fn(),
        unregister: vi.fn(),
        teamCandidates: vi.fn().mockResolvedValue({ data: [] }),
        acceptTeamInvite: vi.fn(),
        declineTeamInvite: vi.fn(),
        updateMyAnswers: vi.fn()
    },
    likeApi: { set: vi.fn(), likers: vi.fn() }
}));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const questions = [
    { _id: "q1", label: "T-shirt size", type: "SINGLE_CHOICE", options: ["S", "M", "L"], required: true, scope: "MEMBER" },
    { _id: "q2", label: "Laptop model", type: "SHORT", options: [], required: false, scope: "MEMBER" },
    { _id: "q3", label: "Project idea", type: "PARAGRAPH", options: [], required: true, scope: "TEAM" }
];

const baseEvent = {
    _id: "e1",
    title: "Robo Race",
    status: "PUBLISHED",
    category: "COMPETITION",
    registrationState: "OPEN",
    participationMode: "INDIVIDUAL",
    registeredCount: 4,
    maxParticipants: 20,
    startAt: future(5),
    endAt: future(5.1),
    registrationStart: future(-1),
    registrationEnd: future(4),
    eligibility: { departments: [], batches: [] },
    club: { _id: "c1", name: "Robotics Club" },
    registrationForm: { enabled: true, questions: questions.slice(0, 2) },
    viewer: { registration: null }
};

describe("registration forms", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("an individual event's form is answered before registering, with account details filled in", async () => {
        eventApi.register.mockResolvedValue({ data: { waitlisted: false } });
        const onChange = vi.fn();
        renderWithRouter(<RegistrationPanel event={baseEvent} onChange={onChange} />);

        await userEvent.click(screen.getByRole("button", { name: /Register now/ }));
        const dialog = screen.getByRole("dialog", { name: "Register for Robo Race" });
        expect(within(dialog).getByText("Asha Patel")).toBeInTheDocument();
        const submit = within(dialog).getByRole("button", { name: /^Register$/ });
        expect(submit).toBeDisabled();

        await userEvent.click(within(dialog).getByRole("radio", { name: "M" }));
        await userEvent.type(within(dialog).getByLabelText(/Laptop model/), "ThinkPad");
        await userEvent.click(submit);

        await waitFor(() =>
            expect(eventApi.register).toHaveBeenCalledWith("e1", {
                answers: [
                    { question: "q1", text: "", choices: ["M"] },
                    { question: "q2", text: "ThinkPad", choices: [] }
                ]
            })
        );
        expect(onChange).toHaveBeenCalled();
    });

    test("a team leader answers the team questions once and their own; invited members answer theirs on accepting", async () => {
        eventApi.register.mockResolvedValue({ message: "Registered", data: { waitlisted: false } });
        const teamEvent = { ...baseEvent, participationMode: "TEAM", minTeamSize: 1, maxTeamSize: 3, registrationForm: { enabled: true, questions }, viewer: { registration: null, invites: [] } };
        const { unmount } = renderWithRouter(<RegistrationPanel event={teamEvent} onChange={vi.fn()} />);

        await userEvent.click(screen.getByRole("button", { name: "Register a team" }));
        const dialog = screen.getByRole("dialog", { name: "Register your team" });
        await userEvent.type(within(dialog).getByLabelText(/Team name/), "Gearheads");
        await userEvent.type(within(dialog).getByLabelText(/Project idea/), "Line follower");
        await userEvent.click(within(dialog).getByRole("radio", { name: "L" }));
        await userEvent.click(within(dialog).getByRole("button", { name: /Register team/ }));
        await waitFor(() =>
            expect(eventApi.register).toHaveBeenCalledWith(
                "e1",
                expect.objectContaining({
                    teamName: "Gearheads",
                    teamAnswers: [{ question: "q3", text: "Line follower", choices: [] }],
                    answers: [
                        { question: "q1", text: "", choices: ["L"] },
                        { question: "q2", text: "", choices: [] }
                    ]
                })
            )
        );
        unmount();

        eventApi.acceptTeamInvite.mockResolvedValue({ message: "Joined", data: { waitlisted: false } });
        const invited = { ...teamEvent, viewer: { registration: null, invites: [{ team: { _id: "t1", name: "Gearheads", size: 1, leader: { name: "Asha" } }, invitedAt: future(-0.1) }] } };
        renderWithRouter(<RegistrationPanel event={invited} onChange={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
        const join = screen.getByRole("dialog", { name: 'Join "Gearheads"' });
        expect(within(join).queryByLabelText(/Project idea/)).not.toBeInTheDocument();
        await userEvent.click(within(join).getByRole("radio", { name: "S" }));
        await userEvent.click(within(join).getByRole("button", { name: /Join team/ }));
        await waitFor(() => expect(eventApi.acceptTeamInvite).toHaveBeenCalledWith("e1", "t1", { answers: [{ question: "q1", text: "", choices: ["S"] }, { question: "q2", text: "", choices: [] }] }));
    });
});

describe("likes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("the heart likes and unlikes a post, and a double tap on the poster likes it", async () => {
        likeApi.set.mockImplementation((type, id, liked) => Promise.resolve({ data: { liked, likeCount: liked ? 3 : 2 } }));
        const post = { ...baseEvent, registrationForm: null, likeCount: 2, likedByMe: false, publishedAt: future(-0.1), myRegistration: null, venue: { name: "Lab 1" } };
        renderWithRouter(<EventPost event={post} />);

        expect(screen.getByLabelText("2 likes")).toHaveTextContent("2");
        await userEvent.click(screen.getByRole("button", { name: "Like Robo Race" }));
        expect(likeApi.set).toHaveBeenCalledWith("event", "e1", true);
        expect(await screen.findByLabelText("3 likes")).toHaveTextContent("3");
        await userEvent.click(screen.getByRole("button", { name: "Unlike Robo Race" }));
        expect(await screen.findByLabelText("2 likes")).toBeInTheDocument();

        // Two quick clicks on the poster = a double tap.
        const poster = screen.getByRole("link", { name: "Open Robo Race" });
        fireEvent.click(poster, { detail: 1 });
        fireEvent.click(poster, { detail: 2 });
        await waitFor(() => expect(likeApi.set).toHaveBeenLastCalledWith("event", "e1", true));
    });
});
