const request = require("supertest");
const db = require("../helpers/testDb");
const { app, makeStudent, makeFaculty, makeAdmin, makeActiveClub, addMembership, api } = require("../helpers/factory");
const Message = require("../../models/Message");
const ClubMembership = require("../../models/ClubMembership");
const Club = require("../../models/Club");
const { isPublicAddress, parse, firstLink } = require("../../services/LinkPreviewService");

beforeAll(db.connect);
afterAll(db.disconnect);

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const PDF = Buffer.from("%PDF-1.4\n%test\n");
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);

// Development storage: upload to /api/chat/media, then attach the returned token on send.
const upload = async (user, conversationId, buffer, filename, kind) => {
    const ext = filename.split(".").pop();
    const res = await request(app)
        .post(`/api/chat/media?conversation=${conversationId}&kind=${kind}&ext=${ext}`)
        .set("Authorization", `Bearer ${user.token}`)
        .attach("file", buffer, filename);
    return res;
};

describe("chat", () => {
    let asha, bina, chirag, dev, mentor, admin, president, club;

    beforeAll(async () => {
        await db.clear();
        [asha, bina, chirag, dev, president] = await Promise.all([
            makeStudent({ name: "Asha" }),
            makeStudent({ name: "Bina" }),
            makeStudent({ name: "Chirag" }),
            makeStudent({ name: "Dev" }),
            makeStudent({ name: "Prez" })
        ]);
        mentor = await makeFaculty({ name: "Dr Mentor" });
        admin = await makeAdmin();
        club = await makeActiveClub({ name: "Coding Club", mentor, president });
        await addMembership(club, asha);
        await addMembership(club, bina);
    });

    test("one-to-one: anyone can message anyone, with unread counts, read receipts, edit, unsend, reactions and replies", async () => {
        const opened = await api(asha).post("/api/chat/direct", { userId: String(mentor._id) });
        expect(opened.status).toBe(200);
        const chatId = opened.body.data._id;
        expect(opened.body.data.title).toBe("Dr Mentor");

        // Nothing in the mentor's list until there's a message.
        expect((await api(mentor).get("/api/chat/conversations")).body.data.filter((row) => row.type === "DIRECT")).toHaveLength(0);

        const first = await api(asha).post(`/api/chat/conversations/${chatId}/messages`, { text: "Good morning sir", clientId: "c-1" });
        expect(first.status).toBe(200);
        // A resend with the same clientId isn't stored twice.
        await api(asha).post(`/api/chat/conversations/${chatId}/messages`, { text: "Good morning sir", clientId: "c-1" });
        expect(await Message.countDocuments({ conversation: chatId })).toBe(1);

        const list = (await api(mentor).get("/api/chat/conversations")).body.data;
        const row = list.find((item) => String(item._id) === chatId);
        expect(row).toMatchObject({ title: "Asha", unread: 1, lastMessage: expect.objectContaining({ preview: "Good morning sir", mine: false }) });
        expect((await api(mentor).get("/api/chat/unread")).body.data).toMatchObject({ chats: 1, messages: 1 });

        const reply = await api(mentor).post(`/api/chat/conversations/${chatId}/messages`, { text: "Morning!", replyTo: first.body.data._id });
        expect(reply.body.data.replyTo).toMatchObject({ text: "Good morning sir" });
        await api(mentor).post(`/api/chat/conversations/${chatId}/read`);
        const detail = (await api(asha).get(`/api/chat/conversations/${chatId}`)).body.data;
        expect(detail.receipts[0].readAt).toBeTruthy();

        const edited = await api(asha).patch(`/api/chat/messages/${first.body.data._id}`, { text: "Good morning, sir" });
        expect(edited.body.data).toMatchObject({ text: "Good morning, sir", editedAt: expect.any(String) });
        expect((await api(mentor).patch(`/api/chat/messages/${first.body.data._id}`, { text: "hacked" })).status).toBe(403);

        const reacted = await api(mentor).put(`/api/chat/messages/${first.body.data._id}/reaction`, { emoji: "❤️" });
        expect(reacted.body.data.reactions).toEqual([expect.objectContaining({ emoji: "❤️", count: 1, mine: true })]);
        expect((await api(mentor).put(`/api/chat/messages/${first.body.data._id}/reaction`, { emoji: "not an emoji" })).status).toBe(400);

        expect((await api(mentor).delete(`/api/chat/messages/${first.body.data._id}?for=everyone`)).status).toBe(403);
        await api(asha).delete(`/api/chat/messages/${first.body.data._id}?for=everyone`);
        const page = (await api(mentor).get(`/api/chat/conversations/${chatId}/messages`)).body.data.items;
        expect(page[0]).toMatchObject({ deleted: true, text: "" });

        // Delete for me hides it only for me.
        await api(asha).delete(`/api/chat/messages/${reply.body.data._id}?for=me`);
        expect((await api(asha).get(`/api/chat/conversations/${chatId}/messages`)).body.data.items.map((item) => item.text)).not.toContain("Morning!");
        expect((await api(mentor).get(`/api/chat/conversations/${chatId}/messages`)).body.data.items.map((item) => item.text)).toContain("Morning!");

        // Strangers can't read it.
        expect((await api(chirag).get(`/api/chat/conversations/${chatId}/messages`)).status).toBe(404);
    });

    test("blocking stops one-to-one messages both ways until unblocked", async () => {
        const chatId = (await api(chirag).post("/api/chat/direct", { userId: String(dev._id) })).body.data._id;
        await api(chirag).post(`/api/chat/conversations/${chatId}/messages`, { text: "hey" });
        await api(dev).put(`/api/chat/blocks/${chirag._id}`, { blocked: true });

        const refused = await api(chirag).post(`/api/chat/conversations/${chatId}/messages`, { text: "hello?" });
        expect(refused.status).toBe(403);
        expect((await api(dev).post(`/api/chat/conversations/${chatId}/messages`, { text: "x" })).body.message).toMatch(/Unblock/);
        expect((await api(dev).get("/api/chat/blocks")).body.data.map((user) => user.name)).toEqual(["Chirag"]);

        await api(dev).put(`/api/chat/blocks/${chirag._id}`, { blocked: false });
        expect((await api(chirag).post(`/api/chat/conversations/${chatId}/messages`, { text: "hello again" })).status).toBe(200);
    });

    test("groups: create, add and remove people, announce-only, admins and leaving", async () => {
        const created = await api(asha).post("/api/chat/groups", { name: "Hackathon squad", members: [String(bina._id), String(chirag._id)] });
        expect(created.status).toBe(200);
        const groupId = created.body.data._id;
        expect(created.body.data.members.map((member) => [member.name, member.role])).toEqual([
            ["Asha", "ADMIN"],
            ["Bina", "MEMBER"],
            ["Chirag", "MEMBER"]
        ]);

        expect((await api(bina).post(`/api/chat/conversations/${groupId}/members`, { userIds: [String(dev._id)] })).status).toBe(403);
        await api(asha).post(`/api/chat/conversations/${groupId}/members`, { userIds: [String(dev._id)] });
        await api(asha).delete(`/api/chat/conversations/${groupId}/members/${chirag._id}`);
        expect((await api(chirag).get(`/api/chat/conversations/${groupId}`)).status).toBe(404);

        await api(asha).patch(`/api/chat/conversations/${groupId}`, { announceOnly: true, name: "Squad" });
        expect((await api(bina).post(`/api/chat/conversations/${groupId}/messages`, { text: "can I talk?" })).status).toBe(403);
        expect((await api(asha).post(`/api/chat/conversations/${groupId}/messages`, { text: "Announcement" })).status).toBe(200);

        // System messages record what happened.
        const texts = (await api(dev).get(`/api/chat/conversations/${groupId}/messages`)).body.data.items.map((item) => item.text);
        expect(texts).toEqual(expect.arrayContaining(["Asha removed Chirag", 'Asha renamed the group to "Squad"', "Announcement"]));
        // Dev was added later: the creation message isn't in their history.
        expect(texts.some((text) => text.includes("created the group"))).toBe(false);

        // The only admin leaving hands admin to the longest-standing member.
        await api(asha).post(`/api/chat/conversations/${groupId}/leave`);
        const after = (await api(bina).get(`/api/chat/conversations/${groupId}`)).body.data;
        expect(after.members.find((member) => member.name === "Bina").role).toBe("ADMIN");
    });

    test("club group: every approved member is in it, the mentor and outsiders are not, and leaving the club removes access", async () => {
        const ashaList = (await api(asha).get("/api/chat/conversations?filter=clubs")).body.data;
        expect(ashaList).toHaveLength(1);
        const clubChat = ashaList[0];
        expect(clubChat).toMatchObject({ type: "CLUB", title: "Coding Club", memberCount: 3 });

        expect((await api(mentor).get("/api/chat/conversations?filter=clubs")).body.data).toHaveLength(0);
        expect((await api(mentor).get(`/api/chat/conversations/${clubChat._id}`)).status).toBe(404);
        expect((await api(dev).get(`/api/chat/conversations/${clubChat._id}/messages`)).status).toBe(404);

        await api(bina).post(`/api/chat/conversations/${clubChat._id}/messages`, { text: "Meeting at 5?" });
        const presList = (await api(president).get("/api/chat/conversations")).body.data;
        expect(presList.find((row) => row.type === "CLUB")).toMatchObject({ unread: 1 });

        // Only holders of "Manage club chat" (the president) can switch on announce-only or pin.
        expect((await api(asha).patch(`/api/chat/conversations/${clubChat._id}`, { announceOnly: true })).status).toBe(403);
        await api(president).patch(`/api/chat/conversations/${clubChat._id}`, { announceOnly: true });
        expect((await api(asha).post(`/api/chat/conversations/${clubChat._id}/messages`, { text: "hi" })).status).toBe(403);
        const notice = await api(president).post(`/api/chat/conversations/${clubChat._id}/messages`, { text: "Notice: meeting moved" });
        const pinned = await api(president).put(`/api/chat/conversations/${clubChat._id}/pins/${notice.body.data._id}`, { pinned: true });
        expect(pinned.body.data.pinned.map((message) => message.text)).toEqual(["Notice: meeting moved"]);
        await api(president).patch(`/api/chat/conversations/${clubChat._id}`, { announceOnly: false });

        // Granting the authority to a role lets its holders manage the chat too.
        const current = await Club.findById(club._id);
        current.roles = [...(current.roles?.length ? current.roles : require("../../utils/ClubRoles").DEFAULT_ROLES())];
        current.roles.find((role) => role.key === "MEMBER").permissions = ["MANAGE_CHAT"];
        await current.save();
        expect((await api(asha).get(`/api/chat/conversations/${clubChat._id}`)).body.data.isAdmin).toBe(true);

        await api(bina).post(`/api/clubs/${club._id}/leave`);
        await ClubMembership.deleteOne({ club: club._id, user: bina._id });
        expect((await api(bina).get(`/api/chat/conversations/${clubChat._id}/messages`)).status).toBe(404);
        expect((await api(bina).get("/api/chat/conversations?filter=clubs")).body.data).toHaveLength(0);
    });

    test("photos, documents and voice notes are uploaded for one chat and sent as attachments; forwarding copies them", async () => {
        const chatId = (await api(asha).post("/api/chat/direct", { userId: String(bina._id) })).body.data._id;

        const photo = await upload(asha, chatId, PNG, "photo.png", "IMAGE");
        expect(photo.status).toBe(200);
        const pdf = await upload(asha, chatId, PDF, "notes.pdf", "DOCUMENT");
        const docx = await upload(asha, chatId, DOCX, "report.docx", "DOCUMENT");
        expect([pdf.status, docx.status]).toEqual([200, 200]);
        // A file pretending to be a Word document is refused.
        expect((await upload(asha, chatId, Buffer.from("just text"), "fake.docx", "DOCUMENT")).status).toBe(400);
        // Someone outside the chat can't upload into it.
        expect((await upload(chirag, chatId, PNG, "x.png", "IMAGE")).status).toBe(404);

        const sentPhoto = await api(asha).post(`/api/chat/conversations/${chatId}/messages`, { text: "Poster draft", attachments: [photo.body.data] });
        expect(sentPhoto.body.data).toMatchObject({ type: "MEDIA", attachments: [expect.objectContaining({ kind: "IMAGE", url: expect.any(String) })] });
        const sentDocs = await api(asha).post(`/api/chat/conversations/${chatId}/messages`, { attachments: [{ ...pdf.body.data, name: "notes.pdf" }, { ...docx.body.data, name: "report.docx" }] });
        expect(sentDocs.body.data.type).toBe("FILE");
        expect(sentDocs.body.data.attachments.map((file) => [file.name, file.format])).toEqual([
            ["notes.pdf", "pdf"],
            ["report.docx", "docx"]
        ]);

        // An upload issued for one chat can't be attached in another.
        const other = (await api(asha).post("/api/chat/direct", { userId: String(dev._id) })).body.data._id;
        expect((await api(asha).post(`/api/chat/conversations/${other}/messages`, { attachments: [photo.body.data] })).status).toBe(400);

        const forwarded = await api(asha).post(`/api/chat/messages/${sentPhoto.body.data._id}/forward`, { conversationIds: [other] });
        expect(forwarded.body.data.forwardedTo).toEqual([other]);
        const copy = (await api(dev).get(`/api/chat/conversations/${other}/messages`)).body.data.items.at(-1);
        expect(copy).toMatchObject({ forwarded: true, text: "Poster draft", attachments: [expect.objectContaining({ kind: "IMAGE" })] });

        const shared = (await api(bina).get(`/api/chat/conversations/${chatId}/shared?kind=docs`)).body.data;
        expect(shared).toHaveLength(1);
    });

    test("new messages notify everyone in the chat except the sender, people who muted it and people who turned notifications off", async () => {
        const push = jest.spyOn(require("../../services/PushService"), "pushToUsers").mockImplementation(() => {});
        const group = (await api(asha).post("/api/chat/groups", { name: "Notify test", members: [String(bina._id), String(chirag._id), String(dev._id)] })).body.data;
        push.mockClear();

        // Instagram's mute choices; the bell state comes back on the chat.
        expect((await api(bina).put(`/api/chat/conversations/${group._id}/mute`, { duration: "15m" })).body.data.muted).toBe(true);
        expect((await api(bina).put(`/api/chat/conversations/${group._id}/mute`, { duration: "2d" })).status).toBe(400);
        expect((await api(bina).get(`/api/chat/conversations/${group._id}`)).body.data.muted).toBe(true);
        await api(dev).put("/api/chat/settings", { chatNotifications: false });

        await api(asha).post(`/api/chat/conversations/${group._id}/messages`, { text: "Standup at 10" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(push).toHaveBeenCalledTimes(1);
        const [targets, payload] = push.mock.calls[0];
        expect(targets).toEqual([String(chirag._id)]);
        expect(payload).toMatchObject({ title: "Notify test", body: "Asha: Standup at 10", url: `/messages/${group._id}`, kind: "chat", conversationId: String(group._id) });

        // Unmuting brings notifications back; one-to-one chats are titled with the sender's name.
        await api(bina).put(`/api/chat/conversations/${group._id}/mute`, { duration: null });
        push.mockClear();
        const direct = (await api(chirag).post("/api/chat/direct", { userId: String(bina._id) })).body.data;
        await api(chirag).post(`/api/chat/conversations/${direct._id}/messages`, { text: "Hi Bina" });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(push.mock.calls[0]).toEqual([[String(bina._id)], expect.objectContaining({ title: "Chirag", body: "Hi Bina" })]);

        await api(dev).put("/api/chat/settings", { chatNotifications: true });
        push.mockRestore();
    });

    test("reports reach the university admin with the message text", async () => {
        const chatId = (await api(dev).post("/api/chat/direct", { userId: String(asha._id) })).body.data._id;
        const rude = await api(dev).post(`/api/chat/conversations/${chatId}/messages`, { text: "something rude" });
        expect((await api(dev).post(`/api/chat/messages/${rude.body.data._id}/report`, { reason: "x" })).status).toBe(400);
        expect((await api(asha).post(`/api/chat/messages/${rude.body.data._id}/report`, { reason: "Harassment" })).status).toBe(200);

        expect((await api(asha).get("/api/chat/reports")).status).toBe(403);
        const reports = (await api(admin).get("/api/chat/reports")).body.data;
        expect(reports[0]).toMatchObject({ text: "something rude", reason: "Harassment", status: "OPEN", sender: expect.objectContaining({ name: "Dev" }) });
        await api(admin).put(`/api/chat/reports/${reports[0]._id}`, { note: "Warned" });
        expect((await api(admin).get("/api/chat/reports")).body.data).toHaveLength(0);
    });

    test("people search finds students and faculty, never the admin or yourself; activity status can be hidden", async () => {
        const found = (await api(asha).get("/api/chat/people?q=Dr")).body.data.map((user) => user.name);
        expect(found).toContain("Dr Mentor");
        const everyone = (await api(asha).get("/api/chat/people?q=a")).body.data.map((user) => user.name);
        expect(everyone).not.toContain("Asha");
        expect(everyone.some((name) => /admin/i.test(name))).toBe(false);

        expect((await api(asha).put("/api/chat/settings", { showActivityStatus: false })).body.data).toEqual({ showActivityStatus: false, chatNotifications: true });
    });
});

describe("link previews", () => {
    test("only public addresses are fetched", () => {
        ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.20.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"].forEach((ip) => expect(isPublicAddress(ip)).toBe(false));
        ["8.8.8.8", "142.250.183.14", "2606:4700:4700::1111"].forEach((ip) => expect(isPublicAddress(ip)).toBe(true));
    });

    test("reads Open Graph tags and finds the first link", () => {
        const html = '<html><head><meta property="og:title" content="CampusConnect &amp; you"><meta name="description" content="Clubs and events"><meta property="og:image" content="/cover.png"></head></html>';
        expect(parse(html, "https://example.com/page")).toEqual({ url: "https://example.com/page", title: "CampusConnect & you", description: "Clubs and events", image: "https://example.com/cover.png", site: "example.com" });
        expect(firstLink("see https://ddu.ac.in/events, thanks")).toBe("https://ddu.ac.in/events");
    });
});
