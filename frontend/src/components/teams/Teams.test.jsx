import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { RegistrationPanel } from "../events/RegistrationPanel";
import { EventChanges } from "../events/EventChanges";
import { useAuth } from "../../context/AuthContext";
import { eventApi } from "../../api/endpoints";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    eventApi: {
        ticket: vi.fn().mockResolvedValue({ data: null }),
        register: vi.fn(),
        unregister: vi.fn(),
        teamCandidates: vi.fn(),
        inviteToTeam: vi.fn(),
        removeTeamMember: vi.fn(),
        acceptTeamInvite: vi.fn(),
        declineTeamInvite: vi.fn(),
        approveChanges: vi.fn(),
        requestChangesToEdit: vi.fn(),
        rejectChanges: vi.fn(),
        publishChanges: vi.fn(),
        discardChanges: vi.fn()
    }
}));

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

const teamEvent = {
    _id: "e1",
    title: "Hack Relay",
    status: "PUBLISHED",
    registrationState: "OPEN",
    participationMode: "TEAM",
    minTeamSize: 2,
    maxTeamSize: 3,
    registeredCount: 4,
    maxParticipants: 20,
    startAt: future(5),
    endAt: future(5.1),
    registrationStart: future(-1),
    registrationEnd: future(4),
    eligibility: { departments: [], batches: [] },
    viewer: { registration: null, team: null, teamRole: null, invites: [] }
};

const member = (id, name, status) => ({
    user: { _id: id, name, email: `${id}@ddu.ac.in`, departmentCode: "CE", batchCode: "24" },
    status,
    invitedAt: future(-0.1)
});

describe("team registration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue());
    });

    test("a student registers a team: names it, finds teammates and invites them", async () => {
        eventApi.teamCandidates.mockResolvedValue({
            data: [
                { _id: "u2", name: "Bina Shah", email: "24ceuog002@ddu.ac.in", departmentCode: "CE", batchCode: "24", available: true },
                { _id: "u3", name: "Bhavin Rao", email: "24ceuog003@ddu.ac.in", departmentCode: "CE", batchCode: "24", available: false }
            ]
        });
        eventApi.register.mockResolvedValue({ message: 'Team "Byte Busters" is registered. Invites sent to 1 teammate.', data: { waitlisted: false } });
        const onChange = vi.fn();
        renderWithRouter(<RegistrationPanel event={teamEvent} onChange={onChange} />);

        expect(screen.getByText(/Team event · 2–3 members per team/)).toBeInTheDocument();
        expect(screen.getByText("4 / 20 teams")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Register a team" }));

        const dialog = screen.getByRole("dialog", { name: "Register your team" });
        await userEvent.type(within(dialog).getByLabelText(/Team name/), "Byte Busters");
        await userEvent.type(within(dialog).getByLabelText(/Invite teammates/), "Bh");

        const taken = await within(dialog).findByRole("option", { name: /Bhavin Rao/ });
        expect(taken).toBeDisabled();
        expect(within(taken).getByText("Already registered for this event")).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("option", { name: /Bina Shah/ }));
        expect(within(dialog).getByText("(1/2)")).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole("button", { name: /Register team & invite 1/ }));
        await waitFor(() => expect(eventApi.register).toHaveBeenCalledWith("e1", { teamName: "Byte Busters", invitees: ["u2"] }));
        expect(await screen.findByText('Team "Byte Busters" is registered. Invites sent to 1 teammate.')).toBeInTheDocument();
        expect(onChange).toHaveBeenCalled();
        expect(eventApi.teamCandidates).toHaveBeenCalledWith("e1", "Bh");
    });

    test("an invited student sees the invite and can accept it", async () => {
        eventApi.acceptTeamInvite.mockResolvedValue({ message: "You joined the team and are registered", data: { waitlisted: false } });
        const invited = {
            ...teamEvent,
            viewer: {
                ...teamEvent.viewer,
                invites: [{ team: { _id: "t1", name: "Byte Busters", size: 1, leader: { name: "Asha Patel" } }, invitedAt: future(-0.05) }]
            }
        };
        renderWithRouter(<RegistrationPanel event={invited} onChange={vi.fn()} />);

        expect(screen.getByText('Asha Patel invited you to join "Byte Busters"')).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Register your own team instead" })).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Accept" }));
        expect(eventApi.acceptTeamInvite).toHaveBeenCalledWith("e1", "t1");
        expect(await screen.findByText("You joined the team and are registered")).toBeInTheDocument();
    });

    test("the leader sees the roster, pending invites and what the team still needs", async () => {
        const registered = {
            ...teamEvent,
            viewer: {
                registration: { status: "REGISTERED" },
                teamRole: "LEADER",
                invites: [],
                team: {
                    _id: "t1",
                    name: "Byte Busters",
                    size: 1,
                    minSize: 2,
                    maxSize: 3,
                    complete: false,
                    registrationStatus: "REGISTERED",
                    members: [member("u1", "Asha Patel", "LEADER")],
                    invites: [member("u2", "Bina Shah", "INVITED")]
                }
            }
        };
        renderWithRouter(<RegistrationPanel event={registered} onChange={vi.fn()} />);

        expect(screen.getByText("Your team is registered")).toBeInTheDocument();
        expect(screen.getByText("Needs 1 more")).toBeInTheDocument();
        expect(screen.getByText(/waiting for a reply/)).toBeInTheDocument();
        expect(screen.getByText(/Your team needs 1 more member before registration closes/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Withdraw invite to Bina Shah" })).toBeInTheDocument();
        // Leader + 1 pending invite leaves room for one more invite.
        expect(screen.getByRole("button", { name: /Invite teammates/ })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cancel team registration" })).toBeInTheDocument();
    });

    test("a member can leave their team", async () => {
        eventApi.unregister.mockResolvedValue({ message: "You left the team" });
        const joined = {
            ...teamEvent,
            viewer: {
                registration: { status: "REGISTERED" },
                teamRole: "MEMBER",
                invites: [],
                team: {
                    _id: "t1",
                    name: "Byte Busters",
                    size: 2,
                    minSize: 2,
                    maxSize: 3,
                    complete: true,
                    registrationStatus: "REGISTERED",
                    members: [member("u1", "Asha Patel", "LEADER"), member("u2", "Bina Shah", "ACCEPTED")],
                    invites: []
                }
            }
        };
        renderWithRouter(<RegistrationPanel event={joined} onChange={vi.fn()} />);
        expect(screen.getByText("Complete")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Invite teammates/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Leave team" }));
        const confirm = screen.getByRole("dialog", { name: 'Leave "Byte Busters"?' });
        await userEvent.click(within(confirm).getByRole("button", { name: "Leave team" }));
        await waitFor(() => expect(eventApi.unregister).toHaveBeenCalledWith("e1"));
    });
});

describe("proposed changes to a published event", () => {
    const revisionEvent = (status, viewer) => ({
        _id: "e1",
        title: "Hack Night",
        viewer: { canManage: false, ...viewer },
        revision: {
            status,
            fields: ["title", "venue", "eventDate"],
            note: "We moved to a bigger hall.",
            requestedBy: { name: "Asha Patel" },
            requestedAt: future(-0.1),
            reviewComment: null,
            diff: [
                { field: "title", label: "title", from: "Hack Night", to: "Hack Night 2.0" },
                { field: "venue", label: "venue", from: { name: "Seminar Hall A" }, to: { name: "Auditorium" } },
                { field: "eventDate", label: "date", from: "2026-10-06T00:00:00.000Z", to: "2026-10-07T00:00:00.000Z" }
            ]
        }
    });

    beforeEach(() => vi.clearAllMocks());

    test("the mentor sees what changes and approves it", async () => {
        eventApi.approveChanges.mockResolvedValue({ data: { _id: "e1" } });
        const onChange = vi.fn();
        renderWithRouter(<EventChanges event={revisionEvent("PENDING_APPROVAL", { canReviewChanges: true })} onChange={onChange} />);

        expect(screen.getByText("Waiting for mentor approval")).toBeInTheDocument();
        expect(screen.getByText("Hack Night 2.0")).toBeInTheDocument();
        expect(screen.getByText("Seminar Hall A")).toHaveClass("change-from");
        expect(screen.getByText("Auditorium")).toHaveClass("change-to");
        expect(screen.getByText("We moved to a bigger hall.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Publish changes/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /Approve changes/ }));
        const dialog = screen.getByRole("dialog", { name: "Approve these changes?" });
        await userEvent.click(within(dialog).getByRole("button", { name: "Approve changes" }));
        await waitFor(() => expect(eventApi.approveChanges).toHaveBeenCalledWith("e1", undefined));
        expect(onChange).toHaveBeenCalledWith({ _id: "e1" });
    });

    test("once approved, the club publishes the changes", async () => {
        eventApi.publishChanges.mockResolvedValue({ data: { _id: "e1" } });
        renderWithRouter(<EventChanges event={revisionEvent("APPROVED", { canPublishChanges: true, canManage: true, canEdit: true })} onChange={vi.fn()} />);

        expect(screen.getByText("Approved — ready to publish")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Approve changes/ })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /Publish changes/ }));
        expect(eventApi.publishChanges).toHaveBeenCalledWith("e1");
        expect(await screen.findByText("Changes published — registered students have been notified")).toBeInTheDocument();
    });
});
