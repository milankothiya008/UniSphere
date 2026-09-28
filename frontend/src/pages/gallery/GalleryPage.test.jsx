import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import GalleryPage from "./GalleryPage";
import { galleryApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({ galleryApi: { events: vi.fn() } }));

const card = (id, title, overrides = {}) => ({
    event: { _id: id, title, poster: null, category: "CULTURAL", startAt: "2026-09-20T09:00:00.000Z", endAt: "2026-09-20T12:00:00.000Z", status: "COMPLETED", club: { _id: "c1", name: "ShutterBug" } },
    photos: 0,
    videos: 0,
    pending: 0,
    latestAt: null,
    cover: null,
    previews: [],
    ...overrides
});

const response = (items, meta = {}) => ({ data: items, meta: { page: 1, limit: 12, total: items.length, totalPages: 1, counts: { all: 2, photos: 1, review: 1 }, canReview: false, ...meta } });

describe("GalleryPage", () => {
    beforeEach(() => vi.clearAllMocks());

    test("lists events as cards that open their gallery, with counts and a collage", async () => {
        galleryApi.events.mockResolvedValue(
            response([
                card("e1", "Monsoon Frames", { photos: 7, videos: 1, latestAt: new Date().toISOString(), previews: ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"] }),
                card("e2", "Heritage Walk")
            ])
        );
        renderWithRouter(<GalleryPage />, { route: "/gallery", path: "/gallery" });

        const monsoon = await screen.findByRole("link", { name: /Monsoon Frames/ });
        expect(monsoon).toHaveAttribute("href", "/gallery/e1");
        expect(monsoon).toHaveTextContent("7 photos · 1 video");
        expect(monsoon.querySelectorAll(".gallery-card-collage img")).toHaveLength(3);
        expect(screen.getByRole("link", { name: /Heritage Walk/ })).toHaveTextContent("No photos yet");
        expect(screen.getByRole("button", { name: "All events (2)" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /To review/ })).not.toBeInTheDocument();
    });

    test("search and filters go to the server; presidents get a 'To review' filter and badges", async () => {
        galleryApi.events.mockResolvedValue(response([card("e1", "Heritage Walk", { photos: 2, pending: 3 })], { canReview: true }));
        renderWithRouter(<GalleryPage />, { route: "/gallery", path: "/gallery" });

        expect(await screen.findByText("3 to review")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "To review (1)" }));
        await waitFor(() => expect(galleryApi.events).toHaveBeenLastCalledWith(expect.objectContaining({ show: "review" })));

        await userEvent.type(screen.getByPlaceholderText("Search events…"), "walk");
        await waitFor(() => expect(galleryApi.events).toHaveBeenLastCalledWith(expect.objectContaining({ search: "walk" })));
    });
});
