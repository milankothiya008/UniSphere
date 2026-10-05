import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "react-router-dom";
import { renderWithRouter, authValue } from "../../test/renderWithProviders";
import MessagesPage from "../../pages/messages/MessagesPage";
import { useAuth } from "../../context/AuthContext";
import { chatApi } from "../../api/endpoints";
import { ChatProvider } from "../../context/ChatContext";

vi.mock("../../context/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("../../api/endpoints", () => ({
    chatApi: {
        conversations: vi.fn(),
        get: vi.fn(),
        messages: vi.fn(),
        send: vi.fn(),
        read: vi.fn().mockResolvedValue({ data: {} }),
        react: vi.fn(),
        people: vi.fn(),
        openDirect: vi.fn(),
        createGroup: vi.fn(),
        unread: vi.fn().mockResolvedValue({ data: { chats: 0, messages: 0 } }),
        shared: vi.fn().mockResolvedValue({ data: [] }),
        mute: vi.fn(),
        settings: vi.fn().mockResolvedValue({ data: { showActivityStatus: true, chatNotifications: true } })
    }
}));

// A pretend socket for the live-update tests.
const socketHandlers = {};
const fakeSocket = {
    connected: true,
    on: (event, handler) => ((socketHandlers[event] = socketHandlers[event] || new Set()).add(handler)),
    off: (event, handler) => socketHandlers[event]?.delete(handler),
    emit: vi.fn(),
    fire: (event, payload) => socketHandlers[event]?.forEach((handler) => handler(payload))
};
vi.mock("../../lib/chatSocket", () => ({ connectChat: () => fakeSocket, disconnectChat: vi.fn(), chatSocket: () => fakeSocket }));

const me = { _id: "u1", name: "Asha Patel" };
const rows = [
    {
        _id: "c1",
        type: "DIRECT",
        title: "Dr Mentor",
        other: { _id: "u9", name: "Dr Mentor" },
        unread: 2,
        lastMessage: { preview: "See you at 5", mine: false },
        lastMessageAt: new Date().toISOString(),
        memberCount: 2
    },
    { _id: "c2", type: "CLUB", title: "Coding Club", unread: 0, lastMessage: null, lastMessageAt: null, memberCount: 12, createdAt: new Date().toISOString() },
    {
        _id: "c3",
        type: "GROUP",
        title: "Hackathon squad",
        unread: 0,
        lastMessage: { preview: "Asha created the group", mine: false, system: true },
        lastMessageAt: new Date().toISOString(),
        memberCount: 3
    }
];

const detail = {
    _id: "c1",
    type: "DIRECT",
    title: "Dr Mentor",
    other: { _id: "u9", name: "Dr Mentor", accountType: "FACULTY", departmentCode: "CE" },
    memberCount: 2,
    members: [
        { _id: "u1", name: "Asha Patel", role: "MEMBER" },
        { _id: "u9", name: "Dr Mentor", role: "MEMBER" }
    ],
    pinned: [],
    receipts: [{ userId: "u9", readAt: new Date(Date.now() + 86400000).toISOString(), deliveredAt: null }],
    presence: { userId: "u9", online: true },
    canSend: true,
    sendBlockedReason: null,
    canPin: true,
    isAdmin: false
};

const message = (id, text, mine, extra = {}) => ({
    _id: id,
    type: "TEXT",
    text,
    mine,
    sender: mine ? { _id: "u1", name: "Asha Patel" } : { _id: "u9", name: "Dr Mentor" },
    attachments: [],
    reactions: [],
    createdAt: new Date().toISOString(),
    ...extra
});

describe("Messages", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue({ user: me }));
        chatApi.conversations.mockResolvedValue({ data: rows });
        Element.prototype.scrollTo = vi.fn();
        Element.prototype.scrollIntoView = vi.fn();
    });

    test("the chat list shows unread counts, previews and filters", async () => {
        renderWithRouter(<MessagesPage />, { route: "/messages", path: "/messages" });
        const mentor = await screen.findByRole("link", { name: /Dr Mentor/ });
        expect(within(mentor).getByText("2")).toBeInTheDocument();
        expect(within(mentor).getByText("See you at 5")).toBeInTheDocument();
        // System notes don't get a "You:" prefix.
        expect(screen.getByText("Asha created the group")).toBeInTheDocument();
        expect(screen.getByText("Your messages")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("tab", { name: "Clubs" }));
        expect(screen.queryByRole("link", { name: /Dr Mentor/ })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Coding Club/ })).toBeInTheDocument();

        await userEvent.click(screen.getByRole("tab", { name: "Unread" }));
        expect(screen.getByRole("link", { name: /Dr Mentor/ })).toBeInTheDocument();
    });

    test("an open chat shows messages with seen ticks, sends at once and reacts with a double tap", async () => {
        chatApi.get.mockResolvedValue({ data: detail });
        chatApi.messages.mockResolvedValue({
            data: { items: [message("m1", "Good morning sir", true), message("m2", "Morning! Come at 5", false)], hasMore: false }
        });
        chatApi.send.mockImplementation((id, body) => Promise.resolve({ data: message("m3", body.text, true, { clientId: body.clientId }) }));
        chatApi.react.mockResolvedValue({ data: { reactions: [{ emoji: "❤️", users: ["u1"], count: 1, mine: true }] } });

        renderWithRouter(<MessagesPage />, { route: "/messages/c1", path: "/messages/:id" });
        expect(await screen.findByText("Good morning sir")).toBeInTheDocument();
        expect(screen.getByText("Active now")).toBeInTheDocument();
        expect(screen.getByLabelText("Seen")).toBeInTheDocument();
        await waitFor(() => expect(chatApi.read).toHaveBeenCalledWith("c1"));

        const box = screen.getByLabelText("Message");
        await userEvent.type(box, "On my way");
        await userEvent.click(screen.getByRole("button", { name: "Send" }));
        expect(await screen.findByText("On my way")).toBeInTheDocument();
        expect(chatApi.send).toHaveBeenCalledWith("c1", expect.objectContaining({ text: "On my way", attachments: [], clientId: expect.any(String) }));

        fireEvent.doubleClick(screen.getByText("Morning! Come at 5").closest(".bubble"));
        await waitFor(() => expect(chatApi.react).toHaveBeenCalledWith("m2", "❤️"));
        expect(await screen.findByRole("button", { name: "See reactions" })).toHaveTextContent("❤️");
    });

    test("a chat you can't send in explains why", async () => {
        chatApi.get.mockResolvedValue({ data: { ...detail, canSend: false, sendBlockedReason: "You can't message this account" } });
        chatApi.messages.mockResolvedValue({ data: { items: [], hasMore: false } });
        renderWithRouter(<MessagesPage />, { route: "/messages/c1", path: "/messages/:id" });
        expect(await screen.findByText("You can't message this account")).toBeInTheDocument();
        expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    });

    test("new message: pick someone and the chat opens", async () => {
        chatApi.people.mockResolvedValue({ data: [{ _id: "u9", name: "Dr Mentor", accountType: "FACULTY", departmentCode: "CE" }] });
        chatApi.openDirect.mockResolvedValue({ data: { _id: "c1" } });
        chatApi.get.mockResolvedValue({ data: detail });
        chatApi.messages.mockResolvedValue({ data: { items: [], hasMore: false } });
        renderWithRouter(<MessagesPage />, { route: "/messages", path: "/messages", extraRoutes: <Route path="/messages/:id" element={<MessagesPage />} /> });

        await userEvent.click(await screen.findByRole("button", { name: "New message" }));
        const dialog = screen.getByRole("dialog", { name: "New message" });
        await userEvent.click(await within(dialog).findByRole("option", { name: /Dr Mentor/ }));
        await waitFor(() => expect(chatApi.openDirect).toHaveBeenCalledWith("u9"));
        expect(await screen.findByLabelText("Message")).toBeInTheDocument();
    });

    test("chats can be muted from the list like Instagram (right-click or long-press)", async () => {
        chatApi.mute.mockResolvedValue({ data: { muted: true, mutedUntil: new Date(Date.now() + 3600000).toISOString() } });
        renderWithRouter(<MessagesPage />, { route: "/messages", path: "/messages" });
        const row = await screen.findByRole("link", { name: /Dr Mentor/ });
        fireEvent.contextMenu(row);
        const sheet = screen.getByRole("dialog", { name: "Dr Mentor" });
        await userEvent.click(within(sheet).getByRole("button", { name: /Mute messages/ }));
        expect(within(screen.getByRole("dialog", { name: "Mute messages" })).getAllByRole("button").map((button) => button.textContent)).toEqual(
            expect.arrayContaining(["For 15 minutes", "For 1 hour", "For 8 hours", "For 24 hours", "Until I change it"])
        );
        await userEvent.click(screen.getByRole("button", { name: "For 1 hour" }));
        expect(chatApi.mute).toHaveBeenCalledWith("c1", "1h");
        expect(await within(screen.getByRole("link", { name: /Dr Mentor/ })).findByLabelText("Muted")).toBeInTheDocument();
    });
});

describe("new-message banners", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuth.mockReturnValue(authValue({ user: me }));
        chatApi.unread.mockResolvedValue({ data: { chats: 1, messages: 1 } });
    });

    const incoming = (extra = {}) => ({
        conversationId: "c1",
        message: { _id: `m${Math.random()}`, type: "TEXT", text: "See you at 5", sender: { _id: "u9", name: "Dr Mentor" }, attachments: [] },
        conversation: { _id: "c1", type: "DIRECT", title: "Dr Mentor" },
        mutedFor: [],
        ...extra
    });

    test("a message for another chat shows a banner that opens the chat; muted chats stay quiet", async () => {
        renderWithRouter(
            <ChatProvider>
                <p>Feed</p>
            </ChatProvider>,
            { route: "/feed", path: "/feed", extraRoutes: <Route path="/messages/:id" element={<p>Chat opened</p>} /> }
        );
        await waitFor(() => expect(fakeSocket.emit).toHaveBeenCalledWith("viewing", expect.anything()));

        act(() => fakeSocket.fire("message:new", incoming({ mutedFor: ["u1"] })));
        expect(screen.queryByText("See you at 5")).not.toBeInTheDocument();
        expect(fakeSocket.emit).toHaveBeenCalledWith("delivered", { conversationId: "c1" });

        act(() => fakeSocket.fire("message:new", incoming()));
        const banner = await screen.findByText("See you at 5");
        expect(screen.getByText("Dr Mentor")).toBeInTheDocument();
        await userEvent.click(banner);
        expect(await screen.findByText("Chat opened")).toBeInTheDocument();
    });
});
