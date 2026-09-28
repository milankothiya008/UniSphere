const request = require("supertest");
const db = require("../helpers/testDb");
const { app, seedReferenceData, makeStudent, makeFaculty, makeActiveClub, addMembership, eventPayload, futureDate, api } = require("../helpers/factory");
const Event = require("../../models/Event");
const EventMedia = require("../../models/EventMedia");
const EventRegistration = require("../../models/EventRegistration");
const Notification = require("../../models/Notification");
const AuditLog = require("../../models/AuditLog");

beforeAll(db.connect);
afterAll(db.disconnect);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64, 2)]);

describe("event gallery", () => {
    let venues, club, otherClub, mentor, president, vice, coordinator, member, asha, bina, outsider;
    let eventId;

    const publishEvent = async (overrides = {}) => {
        const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, overrides));
        expect(draft.status).toBe(201);
        const id = draft.body.data._id;
        await api(president).post(`/api/events/${id}/submit`);
        await api(mentor).post(`/api/events/${id}/approve`);
        await api(president).post(`/api/events/${id}/publish`);
        return id;
    };

    const startEvent = (id) => Event.updateOne({ _id: id }, { $set: { startAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const checkIn = (student, id) => EventRegistration.updateOne({ event: id, user: student._id }, { $set: { checkedInAt: new Date(), checkedInBy: president._id, checkInMethod: "MANUAL" } });

    const uploadFile = (user, id, buffer = PNG, name = "photo.png") =>
        request(app).post(`/api/events/${id}/gallery/media`).set("Authorization", `Bearer ${user.token}`).attach("file", buffer, name);

    // The full browser flow in development storage: ticket → file → attach.
    const add = async (user, id = eventId, buffer = PNG, name = "photo.png") => {
        const tickets = await api(user).post(`/api/events/${id}/gallery/uploads`, { kinds: [buffer === MP4 ? "VIDEO" : "IMAGE"] });
        if (tickets.status !== 201) {
            return tickets;
        }
        const uploaded = await uploadFile(user, id, buffer, name);
        if (uploaded.status !== 201) {
            return uploaded;
        }
        return api(user).post(`/api/events/${id}/gallery`, { media: { ...uploaded.body.data, width: 1200, height: 800 } });
    };

    const gallery = (user, id = eventId) => (user ? api(user).get(`/api/events/${id}/gallery`) : request(app).get(`/api/events/${id}/gallery`));

    beforeAll(async () => {
        await db.clear();
        venues = await seedReferenceData();
        [mentor, president, vice, coordinator, member, asha, bina, outsider] = await Promise.all([
            makeFaculty(),
            makeStudent({ name: "President" }),
            makeStudent({ name: "Vice President" }),
            makeStudent({ name: "Coordinator" }),
            makeStudent({ name: "Plain Member" }),
            makeStudent({ name: "Asha Patel" }),
            makeStudent({ name: "Bina Shah" }),
            makeStudent({ name: "Outsider" })
        ]);
        club = await makeActiveClub({ name: "Photo Club", mentor, president });
        otherClub = await makeActiveClub({ name: "Chess Club", mentor, president: outsider });
        await addMembership(club, vice, "VICE_PRESIDENT");
        await addMembership(club, coordinator, "EVENT_COORDINATOR");
        await addMembership(club, member, "MEMBER");

        eventId = await publishEvent({ title: "Heritage Walk", eventDate: futureDate(10) });
        await api(asha).post(`/api/events/${eventId}/register`);
        await api(bina).post(`/api/events/${eventId}/register`);
    });

    describe("who can upload, and when", () => {
        test("club members can add photos as soon as the event is published; the gallery says so", async () => {
            const view = await gallery(member);
            expect(view.status).toBe(200);
            expect(view.body.data.viewer).toMatchObject({ canUpload: true, canModerate: false, role: "MEMBER" });

            const added = await add(member);
            expect(added.status).toBe(201);
            expect(added.body.message).toBe("Sent for review");
            expect(added.body.data).toMatchObject({ kind: "IMAGE", status: "PENDING", mine: true, canDelete: true, uploaderRole: "MEMBER" });
            expect(added.body.data.url).toMatch(/\/uploads\/gallery\/[a-f0-9]{24}\/.+\.png$/);
        });

        test("registered students can't upload before the event starts or before they're checked in", async () => {
            let view = await gallery(asha);
            expect(view.body.data.viewer).toMatchObject({ canUpload: false, hint: expect.stringMatching(/once the event starts/) });
            expect((await add(asha)).status).toBe(403);

            await startEvent(eventId);
            view = await gallery(asha);
            expect(view.body.data.viewer.hint).toMatch(/Get checked in/);
            expect((await add(asha)).status).toBe(403);

            // Bina, registered but never checked in, loses the hint once the event is over.
            await Event.updateOne({ _id: eventId }, { $set: { endAt: new Date(Date.now() - 60000) } });
            expect((await gallery(bina)).body.data.viewer.hint).toBeNull();
            await Event.updateOne({ _id: eventId }, { $set: { endAt: new Date(Date.now() + 3 * 3600000) } });

            await checkIn(asha, eventId);
            view = await gallery(asha);
            expect(view.body.data.viewer).toMatchObject({ canUpload: true, role: "PARTICIPANT" });
            const added = await add(asha, eventId, MP4, "clip.mp4");
            expect(added.status).toBe(201);
            expect(added.body.data).toMatchObject({ kind: "VIDEO", status: "PENDING", uploaderRole: "PARTICIPANT" });
        });

        test("outsiders and signed-out visitors can't upload", async () => {
            expect((await gallery(outsider)).body.data.viewer).toMatchObject({ canUpload: false, hint: null });
            const refused = await add(outsider);
            expect(refused.status).toBe(403);
            expect(refused.body.message).toMatch(/Only club members and checked-in participants/);
            const anonymous = await gallery(null);
            expect(anonymous.status).toBe(200);
            expect(anonymous.body.data.viewer).toMatchObject({ canUpload: false, canModerate: false });
            expect((await request(app).post(`/api/events/${eventId}/gallery/uploads`).send({ kinds: ["IMAGE"] })).status).toBe(401);
        });

        test("an upload issued for one event or person can't be attached elsewhere", async () => {
            const other = await publishEvent({ title: "Other Event", eventDate: futureDate(12) });
            const uploaded = (await uploadFile(member, eventId)).body.data;
            expect((await api(member).post(`/api/events/${other}/gallery`, { media: uploaded })).body.message).toMatch(/not issued for this event/);
            expect((await api(coordinator).post(`/api/events/${eventId}/gallery`, { media: uploaded })).body.message).toMatch(/not issued for this event/);
        });

        test("drafts have no gallery", async () => {
            const draft = await api(president).post("/api/events", eventPayload(club, venues.auditorium, { title: "Draft Event", eventDate: futureDate(20) }));
            const draftId = draft.body.data._id;
            expect((await gallery(member, draftId)).body.data).toMatchObject({ items: [], viewer: { canUpload: false } });
            expect((await add(member, draftId)).status).toBe(403);
        });

        test("one request prepares up to 20 uploads, and a non-media kind is refused", async () => {
            const tickets = await api(member).post(`/api/events/${eventId}/gallery/uploads`, { kinds: ["IMAGE", "IMAGE", "VIDEO"] });
            expect(tickets.status).toBe(201);
            expect(tickets.body.data).toHaveLength(3);
            expect(tickets.body.data[0]).toMatchObject({ provider: "local", uploadUrl: `/events/${eventId}/gallery/media` });
            expect((await api(member).post(`/api/events/${eventId}/gallery/uploads`, { kinds: Array(21).fill("IMAGE") })).status).toBe(400);
            expect((await api(member).post(`/api/events/${eventId}/gallery/uploads`, { kinds: ["PDF"] })).status).toBe(400);
            expect((await uploadFile(member, eventId, Buffer.from("not an image at all, sorry"), "x.png")).status).toBe(400);
        });
    });

    describe("review", () => {
        test("pending uploads are hidden from everyone but their uploader and the president/VP", async () => {
            const publicView = (await gallery(bina)).body.data;
            expect(publicView.items).toHaveLength(0);
            expect(publicView.pending).toHaveLength(0);
            expect(publicView.mine).toHaveLength(0);

            const mine = (await gallery(asha)).body.data;
            expect(mine.mine).toHaveLength(1);
            expect(mine.counts.pending).toBe(1);

            const review = (await gallery(vice)).body.data;
            expect(review.viewer).toMatchObject({ canModerate: true });
            expect(review.pending.map((item) => item.uploader.name).sort()).toEqual(["Asha Patel", "Plain Member"]);
            expect(review.counts.pending).toBe(2);
        });

        test("the president and VP are told once per burst of uploads", async () => {
            const notices = await Notification.find({ type: "GALLERY_SUBMITTED" });
            const forPresident = notices.filter((notice) => String(notice.user) === String(president._id));
            expect(forPresident).toHaveLength(2); // one for the member, one for Asha
            expect(notices.some((notice) => String(notice.user) === String(vice._id))).toBe(true);
            expect(notices.some((notice) => String(notice.user) === String(coordinator._id))).toBe(false);
            expect(forPresident[0].link).toBe(`/events/${eventId}?gallery=review`);

            await add(member);
            expect(await Notification.countDocuments({ type: "GALLERY_SUBMITTED", user: president._id })).toBe(2);
        });

        test("officers without the permission can't approve; the VP can, and uploaders are notified", async () => {
            const pending = (await gallery(vice)).body.data.pending;
            const memberItems = pending.filter((item) => item.uploader.name === "Plain Member").map((item) => item._id);

            expect((await api(coordinator).post(`/api/events/${eventId}/gallery/approve`, { ids: memberItems })).status).toBe(403);
            expect((await api(mentor).post(`/api/events/${eventId}/gallery/approve`, { ids: memberItems })).status).toBe(403);

            const approved = await api(vice).post(`/api/events/${eventId}/gallery/approve`, { ids: memberItems });
            expect(approved.status).toBe(200);
            expect(approved.body.data).toMatchObject({ approved: 2, counts: { approved: 2, pending: 1 } });

            const notice = await Notification.findOne({ user: member._id, type: "GALLERY_APPROVED" });
            expect(notice.title).toBe("Your uploads are in the Heritage Walk gallery");
            expect(notice.message).toBe("2 photos you added are now on the event page.");
            expect(await AuditLog.exists({ action: "GALLERY_MEDIA_APPROVED", actor: vice._id })).toBeTruthy();

            const publicView = (await gallery(null)).body.data;
            expect(publicView.items).toHaveLength(2);
            expect(publicView.items[0]).toMatchObject({ status: "APPROVED", mine: false, canDelete: false });
            expect(publicView.counts.approved).toBe(2);
        });

        test("rejecting deletes the upload and tells the uploader why", async () => {
            const [video] = (await gallery(president)).body.data.pending;
            const rejected = await api(president).post(`/api/events/${eventId}/gallery/reject`, { ids: [video._id], reason: "Blurry" });
            expect(rejected.status).toBe(200);
            expect(rejected.body.data.rejected).toBe(1);
            expect(await EventMedia.exists({ _id: video._id })).toBeNull();

            const notice = await Notification.findOne({ user: asha._id, type: "GALLERY_REJECTED" });
            expect(notice.message).toBe("The club didn't add 1 video you uploaded. Reason: Blurry");
            expect((await gallery(asha)).body.data.mine).toHaveLength(0);
        });

        test("reviewing again, or items from another event, does nothing", async () => {
            const [item] = (await gallery(null)).body.data.items;
            const again = await api(president).post(`/api/events/${eventId}/gallery/approve`, { ids: [item._id] });
            expect(again.body.data.approved).toBe(0);
            expect((await api(president).post(`/api/events/${eventId}/gallery/approve`, { ids: ["not-an-id"] })).status).toBe(400);
        });

        test("the president's and VP's own uploads go straight into the gallery", async () => {
            const added = await add(president);
            expect(added.body.message).toBe("Added to the gallery");
            expect(added.body.data.status).toBe("APPROVED");
            expect((await gallery(null)).body.data.counts.approved).toBe(3);
        });
    });

    describe("deleting", () => {
        test("uploaders delete their own; the president/VP can remove anyone's; others can't", async () => {
            const items = (await gallery(null)).body.data.items;
            const memberItem = items.find((item) => item.uploader.name === "Plain Member");

            expect((await api(bina).delete(`/api/events/${eventId}/gallery/${memberItem._id}`)).status).toBe(403);
            expect((await api(coordinator).delete(`/api/events/${eventId}/gallery/${memberItem._id}`)).status).toBe(403);
            expect((await api(member).delete(`/api/events/${eventId}/gallery/${memberItem._id}`)).status).toBe(200);

            const presidentItem = items.find((item) => item.uploader.name === "President");
            expect((await api(vice).delete(`/api/events/${eventId}/gallery/${presidentItem._id}`)).status).toBe(200);
            expect(await AuditLog.countDocuments({ action: "GALLERY_MEDIA_REMOVED" })).toBe(2);
            expect((await api(vice).delete(`/api/events/${eventId}/gallery/${presidentItem._id}`)).status).toBe(404);
        });
    });

    describe("limits", () => {
        test("a person can have only so many uploads waiting for review", async () => {
            const { env } = require("../../config/env");
            const before = env.gallery.maxPendingPerUser;
            env.gallery.maxPendingPerUser = 2;
            try {
                await EventMedia.deleteMany({ uploader: member._id, status: "PENDING" });
                expect((await add(member)).status).toBe(201);
                expect((await add(member)).status).toBe(201);
                const blocked = await api(member).post(`/api/events/${eventId}/gallery/uploads`, { kinds: ["IMAGE"] });
                expect(blocked.status).toBe(409);
                expect(blocked.body.message).toMatch(/2 uploads waiting for review/);
            } finally {
                env.gallery.maxPendingPerUser = before;
            }
        });

        test("the gallery pages its approved items", async () => {
            await EventMedia.insertMany(
                Array.from({ length: 30 }, (_, i) => ({
                    event: eventId,
                    club: club._id,
                    uploader: president._id,
                    uploaderRole: "MEMBER",
                    status: "APPROVED",
                    media: { kind: "IMAGE", provider: "local", key: `gallery/${eventId}/seed-${i}.png` }
                }))
            );
            const first = await gallery(null);
            expect(first.body.data.items).toHaveLength(24);
            expect(first.body.meta).toMatchObject({ page: 1, totalPages: 2 });
            const second = await request(app).get(`/api/events/${eventId}/gallery?page=2`);
            expect(second.body.data.items.length).toBeGreaterThan(0);
            expect(otherClub).toBeTruthy();
        });
    });
});
