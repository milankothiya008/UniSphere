const { env } = require("../config/env");
const { createMediaStore, KINDS } = require("./MediaStore");

// Files attached to recruitment applications (resumes, portfolios): PDFs or photos, issued per drive.
// Only the applicant, the club president and the faculty mentor are ever shown their links.

module.exports = createMediaStore({
    name: "Recruitment",
    scopeLabel: "recruitment drive",
    folder: (driveId) => `${env.cloudinary.folder}/recruitment/${driveId}`,
    localDir: "recruitment",
    macPurpose: "recruitment-media",
    localPurpose: "recruitment-local",
    tag: "campusconnect-recruitment",
    kinds: [KINDS.DOCUMENT, KINDS.IMAGE],
    limits: () => env.recruitment,
    transforms: {
        video: () => "",
        videoPoster: "",
        image: "c_limit,h_2048,w_2048,q_auto,f_auto",
        thumb: "c_fill,h_240,w_240,q_auto,f_auto"
    },
    localUploadUrl: (driveId) => `/recruitment/${driveId}/media`
});
