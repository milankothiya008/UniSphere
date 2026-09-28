import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithRouter } from "../../test/renderWithProviders";
import { EventGallery } from "./EventGallery";
import { galleryApi } from "../../api/endpoints";

vi.mock("../../api/endpoints", () => ({
    galleryApi: { list: vi.fn(), uploadTickets: vi.fn(), add: vi.fn(), approve: vi.fn(), reject: vi.fn(), remove: vi.fn() }
}));

const event = { _id: "e1", title: "Heritage Walk", status: "PUBLISHED" };
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const item = (id, overrides = {}) => ({
    _id: id,
    kind: "IMAGE",
    url: `https://cdn.test/${id}.jpg`,
    thumb: `https://cdn.test/${id}-thumb.jpg`,
    poster: null,
    status: "APPROVED",
    uploader: { _id: "u9", name: "Kabir Joshi" },
    uploaderRole: "MEMBER",
    createdAt: ago(5),
    mine: false,
    canDelete: false,
    ...overrides
});

const LIMITS = { maxImageBytes: 15e6, maxVideoBytes: 80e6, maxVideoSeconds: 90, maxPendingPerUser: 30 };

const gallery = ({ items = [], pending = [], mine = [], viewer = {}, total } = {}) => ({
    data: {
        items,
        pending,
        mine,
        counts: { approved: total ?? items.length, pending: pending.length || mine.length },
        viewer: { canUpload: false, canModerate: false, role: null, hint: null, limits: LIMITS, ...viewer }
    },
    meta: { page: 1, limit: 24, total: total ?? items.length, totalPages: Math.max(1, Math.ceil((total ?? items.length) / 24)) }
});

const render = (route = "/events/e1") => renderWithRouter(<EventGallery event={event} />, { route, path: "/events/:id" });

describe("EventGallery", () => {
    beforeEach(() => vi.clearAllMocks());

    test("stays out of the way when there's nothing to show and nothing the viewer can do", async () => {
        galleryApi.list.mockResolvedValue(gallery({ viewer: { hint: "Club members and checked-in participants can add photos and videos." } }));
        const { container } = render();
        await waitFor(() => expect(galleryApi.list).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(container.querySelector("#gallery")).toBeNull();
    });

    test("shows approved photos as a mosaic and opens them full screen, with arrows", async () => {
        const items = Array.from({ length: 9 }, (_, i) => item(`m${i}`, { uploader: { _id: "u9", name: `Uploader ${i}` } }));
        galleryApi.list.mockResolvedValue(gallery({ items }));
        render();

        expect(await screen.findByRole("heading", { name: /Photos & videos/ })).toHaveTextContent("9");
        // Nine fill the mosaic exactly, so the newest is shown large.
        expect(document.querySelector(".gallery-grid")).toHaveClass("has-feature");
        expect(screen.queryByRole("button", { name: /Add photos/ })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Open photo by Uploader 0" }));
        const viewer = screen.getByRole("dialog", { name: /Heritage Walk/ });
        expect(within(viewer).getByText("1 / 9")).toBeInTheDocument();
        expect(within(viewer).getByRole("img", { name: "Photo by Uploader 0" })).toHaveAttribute("src", "https://cdn.test/m0.jpg");
        expect(within(viewer).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

        await userEvent.click(within(viewer).getByRole("button", { name: "Next" }));
        expect(within(viewer).getByText("2 / 9")).toBeInTheDocument();
        await userEvent.keyboard("{ArrowRight}");
        expect(within(viewer).getByText("3 / 9")).toBeInTheDocument();
        await userEvent.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("fewer than nine photos use an even grid", async () => {
        galleryApi.list.mockResolvedValue(gallery({ items: Array.from({ length: 6 }, (_, i) => item(`m${i}`)) }));
        render();
        await screen.findByRole("heading", { name: /Photos & videos/ });
        expect(document.querySelector(".gallery-grid")).not.toHaveClass("has-feature");
        expect(document.querySelectorAll(".gallery-tile")).toHaveLength(6);
    });

    test("more than nine: the last tile and 'View all' open the full gallery", async () => {
        const items = Array.from({ length: 12 }, (_, i) => item(`m${i}`));
        galleryApi.list.mockResolvedValue(gallery({ items, total: 30 }));
        render();

        expect(await screen.findByRole("button", { name: "Show all — 22 more" })).toHaveTextContent("+22");
        await userEvent.click(screen.getByRole("button", { name: /View all 30/ }));
        expect(screen.getByRole("dialog", { name: "Photos & videos · 30" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    test("uploaders see an empty drop zone, their uploads waiting for approval, and how approval works", async () => {
        galleryApi.list.mockResolvedValue(
            gallery({ mine: [item("p1", { status: "PENDING", mine: true, canDelete: true })], viewer: { canUpload: true, role: "PARTICIPANT" } })
        );
        galleryApi.remove.mockResolvedValue({ message: "Deleted from the gallery", data: { counts: { approved: 0, pending: 0 } } });
        render();

        expect(await screen.findByRole("button", { name: /Add photos/ })).toBeInTheDocument();
        expect(screen.getByText("No photos yet")).toBeInTheDocument();
        expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
        expect(screen.getByText(/president or vice-president approves them/)).toBeInTheDocument();

        await userEvent.click(screen.getByRole("button", { name: "Delete this upload" }));
        await userEvent.click(within(screen.getByRole("dialog", { name: "Delete this photo?" })).getByRole("button", { name: "Delete" }));
        await waitFor(() => expect(galleryApi.remove).toHaveBeenCalledWith("e1", "p1"));
        expect(await screen.findByText("Deleted from the gallery")).toBeInTheDocument();
        expect(screen.queryByText("Waiting for approval")).not.toBeInTheDocument();
    });

    test("the president reviews: approve a selection, decline the rest with a reason", async () => {
        const pending = [
            item("p1", { status: "PENDING", uploader: { _id: "a", name: "Asha Patel" }, uploaderRole: "PARTICIPANT" }),
            item("p2", { status: "PENDING", kind: "VIDEO", duration: 23, uploader: { _id: "b", name: "Bina Shah" } })
        ];
        galleryApi.list.mockResolvedValue(gallery({ items: [item("m1")], pending, viewer: { canUpload: true, canModerate: true, role: "MEMBER" } }));
        galleryApi.approve.mockResolvedValue({ message: "Approved — it's now in the gallery", data: { approved: 1, counts: { approved: 2, pending: 1 } } });
        galleryApi.reject.mockResolvedValue({ message: "Declined and deleted", data: { rejected: 1, counts: { approved: 2, pending: 0 } } });
        render("/events/e1?gallery=review");

        // The dashboard / notification link opens the review queue.
        await waitFor(() => expect(screen.getByRole("tab", { name: /To review/ })).toHaveAttribute("aria-selected", "true"));
        expect(screen.getByText("2 uploads waiting")).toBeInTheDocument();
        expect(screen.getByText("0:23")).toBeInTheDocument();

        const [first] = screen.getAllByRole("button", { name: "Select" });
        await userEvent.click(first);
        expect(screen.getByText("1 selected")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Approve 1" }));
        await waitFor(() => expect(galleryApi.approve).toHaveBeenCalledWith("e1", ["p1"]));
        expect(await screen.findByText("Approved — it's now in the gallery")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText("1 upload waiting")).toBeInTheDocument());

        await userEvent.click(screen.getByRole("button", { name: /Decline all/ }));
        const dialog = screen.getByRole("dialog", { name: "Decline this upload?" });
        await userEvent.type(within(dialog).getByLabelText(/Reason for the uploader/), "Not from this event");
        await userEvent.click(within(dialog).getByRole("button", { name: "Decline and delete" }));
        await waitFor(() => expect(galleryApi.reject).toHaveBeenCalledWith("e1", ["p2"], "Not from this event"));

        // Nothing left to review: back to the gallery, which now includes the approved photo.
        await waitFor(() => expect(screen.queryByRole("tab", { name: /To review/ })).not.toBeInTheDocument());
        expect(screen.getByRole("heading", { name: /Photos & videos/ })).toHaveTextContent("2");
    });

    test("uploading: files go up with tickets, then wait for review", async () => {
        galleryApi.list.mockResolvedValue(gallery({ viewer: { canUpload: true, role: "MEMBER" } }));
        galleryApi.uploadTickets.mockResolvedValue({ data: [{ provider: "cloudinary", kind: "IMAGE", uploadUrl: "https://api.cloudinary.test/upload", fields: { signature: "s" }, maxBytes: 15e6 }] });
        galleryApi.add.mockResolvedValue({ data: item("new", { status: "PENDING", mine: true, canDelete: true }) });

        // jsdom has no network: stand in for XMLHttpRequest and image decoding.
        const sent = [];
        class FakeXhr {
            upload = {};
            open(method, url) {
                this.url = url;
            }
            setRequestHeader() {}
            send(form) {
                sent.push({ url: this.url, form });
                this.status = 200;
                this.responseText = JSON.stringify({ public_id: "campusconnect/gallery/e1/abc_def", version: 3, signature: "sig", format: "jpg", width: 10, height: 10, bytes: 4 });
                setTimeout(() => this.onload(), 0);
            }
        }
        vi.stubGlobal("XMLHttpRequest", FakeXhr);
        vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:preview", revokeObjectURL: () => {} });
        class FakeImage {
            set src(value) {
                this._src = value;
                setTimeout(() => this.onload?.(), 0);
            }
            naturalWidth = 1200;
            naturalHeight = 800;
        }
        vi.stubGlobal("Image", FakeImage);

        try {
            render();
            await screen.findByRole("button", { name: /Add photos/ });
            const file = new File(["jpeg"], "walk.jpg", { type: "image/jpeg" });
            await userEvent.upload(screen.getByTestId("gallery-file-input"), file);

            await waitFor(() => expect(galleryApi.add).toHaveBeenCalled());
            expect(galleryApi.uploadTickets).toHaveBeenCalledWith("e1", ["IMAGE"]);
            expect(sent[0].url).toBe("https://api.cloudinary.test/upload");
            expect(galleryApi.add.mock.calls[0][1]).toMatchObject({ provider: "cloudinary", kind: "IMAGE", publicId: "campusconnect/gallery/e1/abc_def", version: 3 });
            expect(await screen.findByText("1 file sent for review")).toBeInTheDocument();
            expect(await screen.findByText(/Sent 1 photo for review/)).toBeInTheDocument();
            expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
