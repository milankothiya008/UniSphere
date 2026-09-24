import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import { StoryTray } from "./StoryTray";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { eventApi, storyApi } from "../../api/endpoints";
import { resetStories } from "../../hooks/useStories";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../context/WorkspaceContext", () => ({ useWorkspace: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    storyApi: { tray: vi.fn(), view: vi.fn(), like: vi.fn(), viewers: vi.fn(), remove: vi.fn(), create: vi.fn(), uploadTicket: vi.fn() },
    eventApi: { list: vi.fn() }
}));

const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const later = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

const story = (id, caption, extra = {}) => ({
    _id: id,
    kind: "IMAGE",
    url: `https://cdn.example.com/${id}.jpg`,
    thumb: `https://cdn.example.com/${id}-t.jpg`,
    poster: null,
    caption,
    event: null,
    seen: false,
    liked: false,
    createdAt: ago(90),
    expiresAt: later(22),
    ...extra
});

const coding = { _id: "c1", name: "Coding Club", logo: null };
const music = { _id: "c2", name: "Music Society", logo: null };

const tray = ({ manageCoding = false } = {}) => [
    {
        club: coding,
        canManage: manageCoding,
        allSeen: false,
        latestAt: ago(10),
        stories: [
            story("s1", "HackNight registrations are open", manageCoding ? { viewCount: 12, likeCount: 3 } : {}),
            story("s2", "Mentors announced", { event: { _id: "e1", title: "HackNight 2026", startAt: later(48) }, ...(manageCoding ? { viewCount: 4, likeCount: 0 } : {}) })
        ]
    },
    { club: music, canManage: false, allSeen: false, latestAt: ago(30), stories: [story("s3", "Open mic tonight")] }
];

const setup = async ({ manageCoding = false, clubs = [coding, music, { _id: "c3", name: "Robotics Club" }] } = {}) => {
    storyApi.tray.mockResolvedValue({ data: tray({ manageCoding }) });
    useWorkspace.mockReturnValue({ postingClubs: manageCoding ? [{ club: coding, permissions: ["POST_UPDATES"] }] : [] });
    renderWithRouter(<StoryTray clubs={clubs} />);
    await screen.findByRole("button", { name: /Music Society's story/ });
};

const openImage = () => fireEvent.load(document.querySelector(".sv-image"));
const tapRight = () => {
    const tap = document.querySelector(".sv-tap");
    fireEvent.pointerDown(tap, { clientX: 300, clientY: 300, button: 0 });
    fireEvent.pointerUp(tap, { clientX: 300, clientY: 300, button: 0 });
};

describe("club stories", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStories();
        useAuth.mockReturnValue(authValue());
        storyApi.view.mockResolvedValue({});
        storyApi.like.mockResolvedValue({ data: { liked: true } });
        eventApi.list.mockResolvedValue({ data: [] });
    });

    test("the rail shows clubs with new stories as rings, and other clubs as shortcuts", async () => {
        await setup();
        expect(screen.getByRole("button", { name: "Watch Coding Club's story (new)" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Robotics Club/ })).toHaveAttribute("href", "/clubs/c3");
        expect(screen.queryByText("Your story")).not.toBeInTheDocument();
    });

    test("watching plays the first unwatched story, marks it seen, and taps move through stories and clubs", async () => {
        await setup();
        await userEvent.click(screen.getByRole("button", { name: /Coding Club's story/ }));

        const viewer = screen.getByRole("dialog", { name: "Coding Club stories" });
        expect(within(viewer).getByText("HackNight registrations are open")).toBeInTheDocument();
        expect(within(viewer).getByText("1h")).toBeInTheDocument();
        expect(storyApi.view).not.toHaveBeenCalled();

        openImage();
        await waitFor(() => expect(storyApi.view).toHaveBeenCalledWith("s1"));

        tapRight();
        expect(await within(viewer).findByText("Mentors announced")).toBeInTheDocument();
        expect(within(viewer).getByRole("link", { name: /HackNight 2026/ })).toHaveAttribute("href", "/events/e1");

        tapRight();
        expect(await screen.findByRole("dialog", { name: "Music Society stories" })).toBeInTheDocument();
        expect(screen.getByText("Open mic tonight")).toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    test("a watched club's ring turns grey", async () => {
        await setup();
        await userEvent.click(screen.getByRole("button", { name: /Music Society's story/ }));
        openImage();
        await waitFor(() => expect(storyApi.view).toHaveBeenCalledWith("s3"));
        fireEvent.keyDown(document, { key: "Escape" });

        expect(await screen.findByRole("button", { name: "Watch Music Society's story" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Watch Music Society's story" }).querySelector(".story-ring")).toHaveClass("is-seen");
    });

    test("viewers can like a story; counts are not shown to them", async () => {
        await setup();
        await userEvent.click(screen.getByRole("button", { name: /Coding Club's story/ }));
        expect(screen.queryByText(/viewers/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Like story" }));
        expect(storyApi.like).toHaveBeenCalledWith("s1", true);
        expect(screen.getByRole("button", { name: "Unlike story" })).toHaveAttribute("aria-pressed", "true");
    });

    test("the club's officers get 'Your story' first and can see who viewed each story", async () => {
        storyApi.viewers.mockResolvedValue({
            data: [
                { user: { _id: "u7", name: "Vihaan Gupta", departmentCode: "CE", batchCode: "25" }, viewedAt: ago(5), liked: true },
                { user: { _id: "u8", name: "Ananya Rao", departmentCode: "EC", batchCode: "24" }, viewedAt: ago(20), liked: false }
            ],
            meta: { total: 2, page: 1, totalPages: 1, viewCount: 12, likeCount: 3 }
        });
        await setup({ manageCoding: true });

        expect(screen.getByText("Your story")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Watch Coding Club's story" }));
        expect(screen.getByText("Disappears in 22h")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Like story" })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: /12 viewers/ }));
        const sheet = await screen.findByRole("dialog", { name: "Story viewers" });
        expect(within(sheet).getByText("Vihaan Gupta")).toBeInTheDocument();
        expect(within(sheet).getByText(/CE · Batch 2025/)).toBeInTheDocument();
        expect(within(sheet).getByLabelText("Liked")).toBeInTheDocument();
        expect(sheet.querySelector(".sv-sheet-head p")).toHaveTextContent("12 views · 3 likes");
        expect(storyApi.viewers).toHaveBeenCalledWith("s1", { page: 1, limit: 50 });
    });

    test("officers can share an upcoming event's poster straight to the story", async () => {
        eventApi.list.mockImplementation(async ({ timeframe }) => ({
            data: timeframe === "upcoming" ? [{ _id: "e1", title: "HackNight 2026", poster: "https://cdn.example.com/hack.jpg", startAt: later(48) }] : []
        }));
        storyApi.create.mockResolvedValue({ data: {} });
        await setup({ manageCoding: true });

        await userEvent.click(screen.getByRole("button", { name: "Add to story" }));
        const dialog = await screen.findByRole("dialog", { name: "Add to story" });
        expect(within(dialog).getByRole("button", { name: /Share to story/ })).toBeDisabled();

        await userEvent.click(await within(dialog).findByRole("button", { name: "HackNight 2026" }));
        await userEvent.type(within(dialog).getByLabelText("Caption"), "Last day to register!");
        await userEvent.click(within(dialog).getByRole("button", { name: /Share to story/ }));

        await waitFor(() =>
            expect(storyApi.create).toHaveBeenCalledWith({ club: "c1", event: "e1", media: { provider: "event" }, caption: "Last day to register!" })
        );
        expect(await screen.findByText("Added to Coding Club's story — it disappears in 24 hours")).toBeInTheDocument();
    });

    test("files that are not photos or videos are refused before uploading", async () => {
        await setup({ manageCoding: true });
        await userEvent.click(screen.getByRole("button", { name: "Add to story" }));
        const dialog = await screen.findByRole("dialog", { name: "Add to story" });

        const input = dialog.querySelector('input[type="file"]');
        await act(async () => {
            fireEvent.change(input, { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });
        });
        expect(await within(dialog).findByText(/Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video/)).toBeInTheDocument();
        expect(storyApi.uploadTicket).not.toHaveBeenCalled();
    });
});
