import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../test/renderWithProviders";
import NotificationSettingsPage from "./NotificationSettingsPage";
import UnsubscribePage from "./UnsubscribePage";
import { NotifyBell } from "../components/clubs/NotifyBell";
import { clubApi, notificationApi } from "../api/endpoints";

vi.mock("../api/endpoints", () => ({
    notificationApi: {
        preferences: vi.fn(),
        updatePreferences: vi.fn(),
        subscriptions: vi.fn(),
        describeUnsubscribe: vi.fn(),
        unsubscribe: vi.fn()
    },
    clubApi: { setSubscription: vi.fn() }
}));

const categories = [
    { key: "clubUpdates", label: "Clubs you follow", description: "New events and announcements from clubs whose bell you turned on." },
    { key: "eventRecommendations", label: "New events for you", description: "Newly published campus events you are eligible to join." },
    { key: "eventActivity", label: "Your events", description: "Updates, cancellations and results for events you registered for." }
];

describe("notification settings", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        notificationApi.preferences.mockResolvedValue({ data: { categories, preferences: { clubUpdates: true, eventRecommendations: true, eventActivity: true } } });
        notificationApi.subscriptions.mockResolvedValue({
            data: [{ club: { _id: "c1", name: "Coding Club", category: "TECHNOLOGY" }, isMember: true }]
        });
    });

    test("switching a category off saves it", async () => {
        notificationApi.updatePreferences.mockResolvedValue({ data: { categories, preferences: { clubUpdates: true, eventRecommendations: false, eventActivity: true } } });
        renderWithRouter(<NotificationSettingsPage />);

        const recommendations = await screen.findByRole("switch", { name: /New events for you/ });
        expect(recommendations).toHaveAttribute("aria-checked", "true");
        await userEvent.click(recommendations);

        expect(notificationApi.updatePreferences).toHaveBeenCalledWith({ eventRecommendations: false });
        await waitFor(() => expect(recommendations).toHaveAttribute("aria-checked", "false"));
        expect(screen.getByText(/Account emails .* are always sent/)).toBeInTheDocument();
    });

    test("lists followed clubs and unfollows one", async () => {
        clubApi.setSubscription.mockResolvedValue({ data: { subscribed: false } });
        renderWithRouter(<NotificationSettingsPage />);

        const row = (await screen.findByRole("link", { name: "Coding Club" })).closest(".list-row");
        expect(within(row).getByText(/Member \(on by default\)/)).toBeInTheDocument();
        await userEvent.click(within(row).getByRole("button", { name: "Unfollow" }));

        expect(clubApi.setSubscription).toHaveBeenCalledWith("c1", false);
        expect(await screen.findByText("No clubs yet")).toBeInTheDocument();
    });
});

describe("follow button", () => {
    const club = { _id: "c1", name: "Coding Club", status: "ACTIVE", followerCount: 12, viewer: { subscribed: false } };

    test("Follow turns into Unfollow and updates the follower count", async () => {
        clubApi.setSubscription.mockResolvedValue({ data: { subscribed: true, emailsEnabled: true, followerCount: 13 } });
        renderWithRouter(<NotifyBell club={club} />);

        const bell = screen.getByRole("button", { name: "Follow" });
        expect(bell).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByText("12 followers")).toBeInTheDocument();

        await userEvent.click(bell);
        expect(clubApi.setSubscription).toHaveBeenCalledWith("c1", true);
        expect(await screen.findByRole("button", { name: "Unfollow" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("13 followers")).toBeInTheDocument();
        expect(screen.getByText(/You're following Coding Club/)).toBeInTheDocument();
    });

    test("warns when club emails are switched off in settings", async () => {
        clubApi.setSubscription.mockResolvedValue({ data: { subscribed: true, emailsEnabled: false, followerCount: 13 } });
        renderWithRouter(<NotifyBell club={club} />);
        await userEvent.click(screen.getByRole("button", { name: "Follow" }));
        expect(await screen.findByText(/emails are off in your email settings/)).toBeInTheDocument();
    });

    test("reverts if the server refuses", async () => {
        clubApi.setSubscription.mockRejectedValue(new Error("You can only turn on notifications for active clubs"));
        renderWithRouter(<NotifyBell club={club} />);
        await userEvent.click(screen.getByRole("button", { name: "Follow" }));
        expect(await screen.findByText("You can only turn on notifications for active clubs")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Follow" })).toHaveAttribute("aria-pressed", "false");
    });

    test("is hidden for inactive clubs you don't follow", () => {
        renderWithRouter(<NotifyBell club={{ ...club, status: "SUSPENDED" }} />);
        expect(screen.queryByRole("button", { name: "Follow" })).not.toBeInTheDocument();
    });
});

describe("unsubscribe page", () => {
    test("asks before unsubscribing, then confirms", async () => {
        notificationApi.describeUnsubscribe.mockResolvedValue({ data: { scope: "club", label: "Emails from Coding Club", email: "24***@ddu.ac.in" } });
        notificationApi.unsubscribe.mockResolvedValue({ data: { unsubscribed: true } });
        renderWithRouter(<UnsubscribePage />, { route: "/unsubscribe?token=abc.def", path: "/unsubscribe" });

        expect(await screen.findByText("Emails from Coding Club")).toBeInTheDocument();
        expect(notificationApi.unsubscribe).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: /unsubscribe/i }));
        expect(notificationApi.unsubscribe).toHaveBeenCalledWith("abc.def");
        expect(await screen.findByText("You're unsubscribed")).toBeInTheDocument();
    });

    test("explains a broken link", async () => {
        notificationApi.describeUnsubscribe.mockRejectedValue(new Error("invalid"));
        renderWithRouter(<UnsubscribePage />, { route: "/unsubscribe?token=bad", path: "/unsubscribe" });
        expect(await screen.findByText("This link doesn't work")).toBeInTheDocument();
    });
});
