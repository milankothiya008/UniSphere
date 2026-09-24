const crypto = require("crypto");
const { env } = require("../../config/env");
const media = require("../../services/StoryMediaService");

// Cloudinary is exercised without the network: the ticket's signature and the check of Cloudinary's
// upload response follow Cloudinary's documented signing scheme (sorted params + API secret, SHA-1).
describe("story media storage (Cloudinary)", () => {
    const CLUB = "64b000000000000000000001";
    const USER = "64b000000000000000000002";
    const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");

    beforeAll(() => {
        Object.assign(env.cloudinary, { cloudName: "demo-campus", apiKey: "key123", apiSecret: "shh-secret", folder: "campusconnect" });
    });

    afterAll(() => {
        Object.assign(env.cloudinary, { cloudName: "", apiKey: "", apiSecret: "" });
    });

    const cloudinaryResponse = (ticket, overrides = {}) => {
        const version = 1727000000;
        const publicId = ticket.fields.public_id;
        return {
            provider: "cloudinary",
            kind: ticket.kind,
            publicId,
            version,
            signature: sha1(`public_id=${publicId}&version=${version}shh-secret`),
            format: ticket.kind === "VIDEO" ? "mp4" : "jpg",
            width: 1080,
            height: 1920,
            duration: 14.2,
            bytes: 2048,
            ...overrides
        };
    };

    test("the browser gets a signed ticket to upload straight to Cloudinary", () => {
        const ticket = media.createUploadTicket(CLUB, USER, "VIDEO");
        expect(ticket.provider).toBe("cloudinary");
        expect(ticket.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo-campus/video/upload");
        expect(ticket.fields.api_key).toBe("key123");
        expect(ticket.fields.public_id).toMatch(new RegExp(`^campusconnect/stories/${CLUB}/[a-f0-9]{16}_[a-f0-9]{20}$`));
        expect(ticket.fields.allowed_formats).toBe("mp4,mov,webm");
        expect(ticket.fields.eager).toBe("c_limit,h_1280,w_720,q_auto,du_30/mp4|so_0,c_limit,h_1280,w_720,q_auto/jpg");

        const { api_key: apiKey, signature, ...signed } = ticket.fields;
        const expected = sha1(
            `${Object.keys(signed)
                .sort()
                .map((key) => `${key}=${signed[key]}`)
                .join("&")}shh-secret`
        );
        expect(apiKey).toBe("key123");
        expect(signature).toBe(expected);
        expect(JSON.stringify(ticket)).not.toContain("shh-secret");
    });

    test("a genuine Cloudinary response is accepted and stored as a reference only", () => {
        const ticket = media.createUploadTicket(CLUB, USER, "VIDEO");
        const stored = media.verifyUpload(cloudinaryResponse(ticket, { duration: 95 }), CLUB, USER);
        expect(stored).toMatchObject({ provider: "cloudinary", kind: "VIDEO", key: ticket.fields.public_id, version: 1727000000, duration: 30 });
    });

    test("forged or re-used Cloudinary responses are rejected", () => {
        const ticket = media.createUploadTicket(CLUB, USER, "IMAGE");
        const genuine = cloudinaryResponse(ticket);

        expect(() => media.verifyUpload({ ...genuine, signature: "0".repeat(40) }, CLUB, USER)).toThrow("The upload could not be verified");
        expect(() => media.verifyUpload({ ...genuine, version: genuine.version + 1 }, CLUB, USER)).toThrow("The upload could not be verified");
        expect(() => media.verifyUpload(genuine, CLUB, "64b000000000000000000009")).toThrow("This upload was not issued for this club");
        expect(() => media.verifyUpload(genuine, "64b000000000000000000008", USER)).toThrow("This upload was not issued for this club");
        expect(() => media.verifyUpload({ ...genuine, format: "svg" }, CLUB, USER)).toThrow("Unsupported file format");
    });

    test("viewers get CDN URLs with size and quality optimisations; no lookup needed", () => {
        const image = media.mediaUrls({ provider: "cloudinary", kind: "IMAGE", key: "campusconnect/stories/c/a_b", version: 7 });
        expect(image.url).toBe("https://res.cloudinary.com/demo-campus/image/upload/c_limit,h_1920,w_1080,q_auto,f_auto/v7/campusconnect/stories/c/a_b");
        expect(image.thumb).toBe("https://res.cloudinary.com/demo-campus/image/upload/c_fill,h_200,w_200,q_auto,f_auto/v7/campusconnect/stories/c/a_b");

        const video = media.mediaUrls({ provider: "cloudinary", kind: "VIDEO", key: "campusconnect/stories/c/a_b", version: 7 });
        expect(video.url).toBe("https://res.cloudinary.com/demo-campus/video/upload/c_limit,h_1280,w_720,q_auto,du_30/v7/campusconnect/stories/c/a_b.mp4");
        expect(video.poster).toBe("https://res.cloudinary.com/demo-campus/video/upload/so_0,c_limit,h_1280,w_720,q_auto/v7/campusconnect/stories/c/a_b.jpg");

        const shared = media.mediaUrls({ provider: "event", kind: "IMAGE", key: "https://res.cloudinary.com/demo-campus/image/upload/v1/campusconnect/event-posters/p.jpg" });
        expect(shared.thumb).toBe("https://res.cloudinary.com/demo-campus/image/upload/c_fill,h_200,w_200,q_auto,f_auto/v1/campusconnect/event-posters/p.jpg");
        expect(media.mediaUrls({ provider: "event", kind: "IMAGE", key: "https://example.com/p.jpg" }).url).toBe("https://example.com/p.jpg");
    });

    test("video files are recognised from their bytes", () => {
        expect(media.detectVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(8)]))).toMatchObject({ ext: "mp4" });
        expect(media.detectVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(8)]))).toMatchObject({ ext: "mov" });
        expect(media.detectVideo(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(12)]))).toMatchObject({ ext: "webm" });
        expect(media.detectVideo(Buffer.from("hello world, not a video"))).toBeNull();
    });
});
