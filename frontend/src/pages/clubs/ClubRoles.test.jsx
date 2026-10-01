import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../../context/ToastContext";
import { authValue } from "../../test/renderWithProviders";
import ClubMembersTab from "./ClubMembersTab";
import ClubSettingsTab from "./ClubSettingsTab";
import { clubApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../context/WorkspaceContext", () => ({ useWorkspace: () => ({ reloadClubs: vi.fn() }) }));
vi.mock("../../api/endpoints", () => ({
    clubApi: {
        members: vi.fn(),
        roles: vi.fn(),
        changeRole: vi.fn(),
        createRole: vi.fn(),
        updateRole: vi.fn(),
        deleteRole: vi.fn(),
        transferPresidency: vi.fn(),
        update: vi.fn()
    },
    userApi: { search: vi.fn() },
    uploadApi: {}
}));

const ALL = ["MANAGE_CLUB", "MANAGE_MEMBERS", "ASSIGN_ROLES", "MANAGE_EVENTS", "MANAGE_RECRUITMENT", "PUBLISH_RESULTS", "MANAGE_CHECK_IN", "POST_UPDATES"];
const club = {
    _id: "c1",
    name: "Coding Club",
    status: "ACTIVE",
    category: "TECHNOLOGY",
    description: "We code together every week.",
    departmentCodes: ["CE"],
    viewer: { role: "PRESIDENT", roleName: "President", isMember: true, permissions: ALL }
};

const member = (id, name, role, roleName) => ({ _id: `m${id}`, role, roleName, joinedAt: "2026-01-01", user: { _id: `u${id}`, name, email: `${name.toLowerCase()}@ddu.ac.in`, departmentCode: "CE", batchCode: "24" } });
const members = [member(1, "Asha", "PRESIDENT", "President"), member(2, "Meera", "VICE_PRESIDENT", "Vice-president"), member(3, "Rohan", "MEMBER", "Member")];

const roles = {
    canManage: true,
    presidentOnly: ["MANAGE_CLUB", "ASSIGN_ROLES", "MANAGE_RECRUITMENT", "PUBLISH_RESULTS", "MANAGE_CHECK_IN"],
    roles: [
        { key: "PRESIDENT", name: "President", description: "", permissions: ALL, system: true, editable: false, renamable: false, deletable: false, unique: true, memberCount: 1, holder: { _id: "u1", name: "Asha" } },
        { key: "VICE_PRESIDENT", name: "Vice-president", description: "", permissions: ["MANAGE_EVENTS"], system: true, editable: true, renamable: false, deletable: false, unique: true, memberCount: 1, holder: { _id: "u2", name: "Meera" } },
        { key: "R_design", name: "Design lead", description: "Posters and reels", permissions: ["POST_UPDATES"], system: false, editable: true, renamable: true, deletable: true, unique: false, memberCount: 0, holder: null },
        { key: "MEMBER", name: "Member", description: "", permissions: [], system: true, editable: false, renamable: false, deletable: false, unique: false, memberCount: 1, holder: null }
    ]
};

const renderTab = (tab, search = "") =>
    render(
        <MemoryRouter initialEntries={[`/clubs/c1/tab${search}`]}>
            <ToastProvider>
                <Routes>
                    <Route path="/clubs/:id" element={<Outlet context={{ club, reload: vi.fn() }} />}>
                        <Route path="tab" element={tab} />
                    </Route>
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );

beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue(authValue());
    clubApi.members.mockResolvedValue({ data: members });
    clubApi.roles.mockResolvedValue({ data: roles });
});

describe("club roles", () => {
    test("the role picker lists the club's own roles; the vice-president seat shows who holds it", async () => {
        clubApi.changeRole.mockResolvedValue({ data: { roleName: "Design lead" } });
        renderTab(<ClubMembersTab />);

        const picker = await screen.findByLabelText("Role for Rohan");
        const options = within(picker).getAllByRole("option");
        expect(options.map((option) => option.textContent)).toEqual(["Vice-president — held by Meera", "Design lead", "Member"]);
        expect(options[0]).toBeDisabled();
        // Meera's own picker keeps her seat selectable.
        expect(within(screen.getByLabelText("Role for Meera")).getByRole("option", { name: "Vice-president" })).toBeEnabled();

        await userEvent.selectOptions(picker, "R_design");
        await waitFor(() => expect(clubApi.changeRole).toHaveBeenCalledWith("c1", "u3", "R_design"));
        expect(await screen.findByText("Rohan is now Design lead")).toBeInTheDocument();
    });

    test("People shows the core team first; Roles & authority shows who holds each role", async () => {
        renderTab(<ClubMembersTab />);
        const team = (await screen.findByText("Core team")).closest("section");
        expect(within(team).getByText("Asha")).toBeInTheDocument();
        expect(within(team).getByText("Meera")).toBeInTheDocument();
        expect(within(team).queryByText("Rohan")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Rohan/ })).toHaveAttribute("href", "/people/u3");

        await userEvent.click(screen.getByRole("button", { name: /Roles & authority/ }));
        const design = (await screen.findByRole("button", { name: "Edit Design lead" })).closest("li");
        expect(within(design).getByText("No one yet")).toBeInTheDocument();
        const vice = screen.getByRole("button", { name: "Edit Vice-president" });
        expect(within(vice).getByText("Meera")).toBeInTheDocument();
    });

    test("the president creates a role and picks its authorities; president-only authorities are locked", async () => {
        clubApi.createRole.mockResolvedValue({ data: roles });
        renderTab(<ClubMembersTab />, "?view=roles");

        expect(await screen.findByText("Roles & authorities")).toBeInTheDocument();
        expect(screen.getByText(/Everything, including club settings/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: /New role/ }));
        const dialog = screen.getByRole("dialog", { name: "New role" });
        expect(within(dialog).getByRole("checkbox", { name: /Run recruitment/ })).toBeDisabled();
        expect(within(dialog).getByRole("checkbox", { name: /Club settings/ })).toBeDisabled();

        await userEvent.type(within(dialog).getByLabelText(/Role name/), "Social media lead");
        await userEvent.click(within(dialog).getByRole("checkbox", { name: /Post updates/ }));
        await userEvent.click(within(dialog).getByRole("checkbox", { name: /Approve gallery uploads/ }));
        await userEvent.click(within(dialog).getByRole("button", { name: /Create role/ }));
        await waitFor(() =>
            expect(clubApi.createRole).toHaveBeenCalledWith("c1", { name: "Social media lead", description: "", permissions: ["POST_UPDATES", "MODERATE_GALLERY"] })
        );
    });

    test("built-in roles keep their names; custom roles can be deleted", async () => {
        clubApi.updateRole.mockResolvedValue({ data: roles });
        clubApi.deleteRole.mockResolvedValue({ data: roles });
        renderTab(<ClubMembersTab />, "?view=roles");

        await screen.findByText("Roles & authorities");
        expect(screen.queryByRole("button", { name: "Edit President" })).not.toBeInTheDocument();


        await userEvent.click(screen.getByRole("button", { name: "Edit Vice-president" }));
        const dialog = screen.getByRole("dialog", { name: "Edit Vice-president" });
        expect(within(dialog).getByLabelText(/Role name/)).toBeDisabled();
        await userEvent.click(within(dialog).getByRole("checkbox", { name: /Manage members/ }));
        await userEvent.click(within(dialog).getByRole("button", { name: /Save role/ }));
        await waitFor(() => expect(clubApi.updateRole).toHaveBeenCalledWith("c1", "VICE_PRESIDENT", { description: "", permissions: ["MANAGE_EVENTS", "MANAGE_MEMBERS"] }));

        // Deleting starts from the role's editor.
        await userEvent.click(screen.getByRole("button", { name: "Edit Design lead" }));
        await userEvent.click(within(screen.getByRole("dialog", { name: "Edit Design lead" })).getByRole("button", { name: /Delete role/ }));
        await userEvent.click(within(screen.getByRole("dialog", { name: 'Delete the "Design lead" role?' })).getByRole("button", { name: "Delete role" }));
        await waitFor(() => expect(clubApi.deleteRole).toHaveBeenCalledWith("c1", "R_design"));
    });

    test("the president hands over the presidency after confirming", async () => {
        clubApi.transferPresidency.mockResolvedValue({ data: {} });
        renderTab(<ClubSettingsTab />);

        const handover = await screen.findByText("Hand over the presidency");
        const card = handover.closest("section");
        const select = within(card).getByLabelText("New president");
        await waitFor(() => expect(within(select).getByRole("option", { name: "Meera · Vice-president" })).toBeInTheDocument());
        expect(within(select).queryByRole("option", { name: /Asha/ })).not.toBeInTheDocument();
        expect(within(card).getByRole("button", { name: /Hand over/ })).toBeDisabled();

        await userEvent.selectOptions(select, "u2");
        await userEvent.click(within(card).getByRole("button", { name: /Hand over/ }));
        const dialog = screen.getByRole("dialog", { name: "Make Meera president?" });
        expect(within(dialog).getByText(/You become a regular member/)).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole("button", { name: "Hand over presidency" }));
        await waitFor(() => expect(clubApi.transferPresidency).toHaveBeenCalledWith("c1", "u2"));
    });
});
