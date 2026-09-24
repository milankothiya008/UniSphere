import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { EventRegistrations } from "./ClubInsights";
import { ClubHQ } from "./ClubHQ";

const insights = {
    totalMembers: 42,
    totalEvents: 5,
    eventsInPipeline: 2,
    totalRegistrations: 180,
    upcomingEvents: 2,
    completedEvents: 3,
    averageParticipation: 36,
    seatFillRate: 81,
    waitlisted: 7,
    eventWise: [
        { _id: "e1", title: "HackNight 2026", startAt: "2026-10-06T12:30:00.000Z", status: "PUBLISHED", upcoming: true, registered: 60, capacity: 60, waitlist: 7 },
        { _id: "e2", title: "CodeSprint", startAt: "2026-09-17T04:30:00.000Z", status: "COMPLETED", upcoming: false, registered: 32, capacity: 50, waitlist: 0 },
        { _id: "e3", title: "Open Talk", startAt: "2026-09-01T10:00:00.000Z", status: "COMPLETED", upcoming: false, registered: 88, capacity: null, waitlist: 0 }
    ]
};

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();
const clubEvent = (id, title, extra = {}) => ({ _id: id, title, startAt: inDays(5), endAt: inDays(5.1), registeredCount: 10, maxParticipants: 20, waitlistCount: 0, venue: { name: "Auditorium" }, ...extra });

const workspace = (overrides = {}) => ({
    club: { _id: "c1", name: "Coding Club", category: "TECHNOLOGY" },
    role: "PRESIDENT",
    permissions: ["MANAGE_CLUB", "MANAGE_MEMBERS", "MANAGE_EVENTS", "PUBLISH_EVENTS", "MANAGE_RESULTS"],
    memberCount: 42,
    pendingMembershipRequests: 3,
    drafts: [clubEvent("d1", "Draft idea")],
    needsChanges: [],
    pendingApproval: [clubEvent("p1", "Git Workshop")],
    readyToPublish: [clubEvent("r1", "Quiz Night")],
    upcoming: [clubEvent("u1", "HackNight 2026", { registeredCount: 20, maxParticipants: 20, waitlistCount: 4 })],
    awaitingCompletion: [],
    resultsPending: [{ ...clubEvent("c2", "CodeSprint"), resultStatus: "DRAFT" }],
    insights,
    ...overrides
});

describe("event-wise registrations", () => {
    test("charts registrations per event with capacity, waitlist and a tooltip", async () => {
        renderWithRouter(<EventRegistrations insights={insights} />);

        const hack = screen.getByRole("link", { name: "HackNight 2026: 60 registered of 60, 7 on the waitlist" });
        expect(hack).toHaveAttribute("href", "/events/e1/participants");
        expect(within(hack).getByText("+7 waiting")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open Talk: 88 registered" })).toBeInTheDocument();

        await userEvent.hover(screen.getByRole("link", { name: /CodeSprint/ }));
        const tooltip = screen.getByRole("tooltip");
        expect(within(tooltip).getByText("32 registrations of 50 seats (64%)")).toBeInTheDocument();
        expect(within(tooltip).getByText(/Completed/)).toBeInTheDocument();
    });

    test("offers the same data as a table", async () => {
        renderWithRouter(<EventRegistrations insights={insights} />);
        await userEvent.click(screen.getByRole("button", { name: /table/i }));

        const rows = within(screen.getByRole("table")).getAllByRole("row");
        expect(rows).toHaveLength(4);
        expect(within(rows[1]).getByText("100%")).toBeInTheDocument();
        expect(within(rows[3]).getAllByText("—").length).toBeGreaterThan(0);
    });

    test("explains an empty chart", () => {
        renderWithRouter(<EventRegistrations insights={{ ...insights, totalEvents: 0, eventWise: [] }} />);
        expect(screen.getByText(/appear here once your first event is published/)).toBeInTheDocument();
    });
});

describe("Club HQ", () => {
    test("the president sees each headline number once, with the chart", () => {
        renderWithRouter(<ClubHQ workspaces={[workspace()]} />);
        const tile = (label) => screen.getByText(label).closest(".stat");

        expect(within(tile("Members")).getByText("42")).toBeInTheDocument();
        expect(within(tile("Events hosted")).getByText("2 upcoming · 3 completed")).toBeInTheDocument();
        expect(within(tile("Registrations")).getByText("+7 on waitlists")).toBeInTheDocument();
        expect(within(tile("Avg. participation")).getByText("per event · 81% of seats filled")).toBeInTheDocument();
        // No second "members" tile or separate join-requests tile for the president.
        expect(screen.getAllByText("Members")).toHaveLength(1);
        expect(screen.queryByText("Join requests")).not.toBeInTheDocument();
        expect(screen.getByText("Event-wise registrations")).toBeInTheDocument();
    });

    test("the action center lists everything that needs doing, most urgent first", () => {
        renderWithRouter(<ClubHQ workspaces={[workspace()]} />);
        const center = screen.getByText("Action center").closest(".hq-panel");
        const items = within(center).getAllByRole("link");

        expect(items.map((link) => link.textContent)).toEqual([
            "3 join requests to reviewStudents waiting to join",
            "Quiz NightApproved — ready to publish",
            "CodeSprintResults drafted — publish them",
            "Git WorkshopWith your faculty mentor for review",
            "1 draft not submittedFinish and send for approval"
        ]);
        expect(items[0]).toHaveAttribute("href", "/clubs/c1/members");
        expect(within(center).getByText("5")).toBeInTheDocument();
    });

    test("shows the club's upcoming events with how full they are", () => {
        renderWithRouter(<ClubHQ workspaces={[workspace()]} />);
        const row = screen.getByText("HackNight 2026", { selector: ".club-upcoming-main strong" }).closest("a");
        expect(within(row).getByText("+4 waiting")).toBeInTheDocument();
        expect(within(row).getByText("/ 20")).toBeInTheDocument();
    });

    test("other officers see their workload instead of club analytics", () => {
        renderWithRouter(
            <ClubHQ
                workspaces={[
                    workspace({
                        role: "EVENT_COORDINATOR",
                        permissions: ["MANAGE_EVENTS", "VIEW_PARTICIPANTS", "MANAGE_PARTICIPANTS", "MANAGE_RESULTS"],
                        insights: null,
                        pendingMembershipRequests: null,
                        drafts: [],
                        pendingApproval: [],
                        readyToPublish: [],
                        resultsPending: []
                    })
                ]}
            />
        );
        expect(screen.getByText("With mentor")).toBeInTheDocument();
        expect(screen.queryByText("Event-wise registrations")).not.toBeInTheDocument();
        expect(screen.queryByText("Join requests")).not.toBeInTheDocument();
        expect(screen.getByText("All caught up")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /manage club/i })).not.toBeInTheDocument();
    });

    test("switches between clubs with tabs", async () => {
        const second = workspace({ club: { _id: "c2", name: "Music Society", category: "MUSIC" }, role: "VICE_PRESIDENT", insights: null, memberCount: 9 });
        renderWithRouter(<ClubHQ workspaces={[workspace(), second]} />);

        await userEvent.click(screen.getByRole("tab", { name: /Music Society/ }));
        expect(screen.getByRole("heading", { name: "Music Society" })).toBeInTheDocument();
        expect(screen.getByText(/9 members/)).toBeInTheDocument();
    });
});
