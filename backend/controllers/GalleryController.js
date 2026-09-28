const gallery = require("../services/GalleryService");
const asyncHandler = require("../utils/AsyncHandler");
const { sendSuccess } = require("../utils/ApiResponse");

const listEvents = asyncHandler(async (req, res) => {
    const { items, meta } = await gallery.listGalleries(req.user, req.query);
    sendSuccess(res, 200, "Galleries fetched", items, { meta });
});

const list = asyncHandler(async (req, res) => {
    const { items, meta, ...rest } = await gallery.getGallery(req.user, req.params.id, req.query);
    sendSuccess(res, 200, "Gallery fetched", { items, ...rest }, { meta });
});

const uploadTickets = asyncHandler(async (req, res) => {
    sendSuccess(res, 201, "Uploads ready", await gallery.createUploadTickets(req.user, req.params.id, req.body.kinds));
});

const uploadLocal = asyncHandler(async (req, res) => {
    sendSuccess(res, 201, "Media uploaded", await gallery.uploadLocalMedia(req.user, req.params.id, req.file));
});

const add = asyncHandler(async (req, res) => {
    const item = await gallery.addMedia(req.user, req.params.id, req.body);
    sendSuccess(res, 201, item.status === "APPROVED" ? "Added to the gallery" : "Sent for review", item);
});

const approve = asyncHandler(async (req, res) => {
    const result = await gallery.approveMedia(req.user, req.params.id, req.body.ids);
    sendSuccess(res, 200, result.approved === 1 ? "Approved — it's now in the gallery" : `Approved ${result.approved} — they're now in the gallery`, result);
});

const reject = asyncHandler(async (req, res) => {
    const result = await gallery.rejectMedia(req.user, req.params.id, req.body.ids, req.body.reason);
    sendSuccess(res, 200, result.rejected === 1 ? "Declined and deleted" : `Declined and deleted ${result.rejected}`, result);
});

const remove = asyncHandler(async (req, res) => {
    sendSuccess(res, 200, "Deleted from the gallery", { counts: await gallery.removeMedia(req.user, req.params.id, req.params.mediaId) });
});

module.exports = { listEvents, list, uploadTickets, uploadLocal, add, approve, reject, remove };
