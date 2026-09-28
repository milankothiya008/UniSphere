const media = require("../../services/RecruitmentMediaService");

const DRIVE = "64b000000000000000000001";
const USER = "64b000000000000000000002";

describe("recruitment files", () => {
    test("PDF uploads get a .pdf public ID that is still tied to the drive and the student", () => {
        const id = media.issuePublicId(DRIVE, USER, "DOCUMENT");
        expect(id).toMatch(/\/recruitment\/64b000000000000000000001\/[a-f0-9]+_[a-f0-9]+\.pdf$/);
        expect(media.publicIdIssuedTo(id, DRIVE, USER)).toBe(true);
        expect(media.publicIdIssuedTo(id, DRIVE, "64b000000000000000000009")).toBe(false);
        expect(media.publicIdIssuedTo(id.replace(".pdf", "x.pdf"), DRIVE, USER)).toBe(false);
    });

    test("PDFs are linked through a signed download that expires; photos use the CDN", () => {
        const pdf = media.mediaUrls({ provider: "cloudinary", kind: "DOCUMENT", key: "campusconnect/recruitment/d/a_b.pdf", version: 3 });
        const url = new URL(pdf.url);
        expect(url.pathname).toMatch(/\/raw\/download$/);
        expect(url.searchParams.get("public_id")).toBe("campusconnect/recruitment/d/a_b.pdf");
        expect(url.searchParams.get("type")).toBe("upload");
        expect(Number(url.searchParams.get("expires_at")) - Number(url.searchParams.get("timestamp"))).toBe(3600);
        expect(url.searchParams.get("signature")).toMatch(/^[a-f0-9]{40}$/);

        const photo = media.mediaUrls({ provider: "cloudinary", kind: "IMAGE", key: "campusconnect/recruitment/d/c_d", version: 3 });
        expect(photo.url).toMatch(/\/image\/upload\/.+\/v3\/campusconnect\/recruitment\/d\/c_d$/);
    });

    test("only PDFs and photos are accepted, and PDFs are recognised from their bytes", async () => {
        const ticket = media.createUploadTicket(DRIVE, USER, "DOCUMENT");
        expect(ticket).toMatchObject({ provider: "local", kind: "DOCUMENT", uploadUrl: `/recruitment/${DRIVE}/media`, maxBytes: 5 * 1024 * 1024 });
        await expect(media.saveLocalFile({ buffer: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16)]) }, DRIVE, USER)).rejects.toThrow(
            "Only JPEG, PNG or WebP photos and PDF files are allowed"
        );
        const saved = await media.saveLocalFile({ buffer: Buffer.concat([Buffer.from("%PDF-1.5\n"), Buffer.alloc(32)]) }, DRIVE, USER);
        expect(saved).toMatchObject({ kind: "DOCUMENT", format: "pdf" });
    });
});
