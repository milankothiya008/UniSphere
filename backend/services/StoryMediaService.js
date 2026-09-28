const { env } = require("../config/env");
const { createMediaStore } = require("./MediaStore");

// Where story photos and videos live (see MediaStore): Cloudinary in production, UPLOAD_DIR in development.
// Uploads are issued per club. Portrait-first delivery sizes, videos trimmed to the story length.

module.exports = createMediaStore({
    name: "Story",
    scopeLabel: "club",
    folder: (clubId) => `${env.cloudinary.folder}/stories/${clubId}`,
    localDir: "stories",
    macPurpose: "story-media",
    localPurpose: "story-local",
    tag: "campusconnect-story",
    limits: () => env.stories,
    transforms: {
        video: () => `c_limit,h_1280,w_720,q_auto,du_${env.stories.maxVideoSeconds}`,
        videoPoster: "so_0,c_limit,h_1280,w_720,q_auto",
        image: "c_limit,h_1920,w_1080,q_auto,f_auto",
        thumb: "c_fill,h_200,w_200,q_auto,f_auto"
    },
    localUploadUrl: () => "/stories/media"
});
