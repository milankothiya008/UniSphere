const { env } = require("../config/env");
const { createMediaStore } = require("./MediaStore");

// Where event gallery photos and videos live (see MediaStore). Uploads are issued per event. Unlike stories
// the gallery keeps landscape photos at full width, and the grid uses square, subject-centred thumbnails.

module.exports = createMediaStore({
    name: "Gallery",
    scopeLabel: "event",
    folder: (eventId) => `${env.cloudinary.folder}/gallery/${eventId}`,
    localDir: "gallery",
    macPurpose: "gallery-media",
    localPurpose: "gallery-local",
    tag: "campusconnect-gallery",
    limits: () => env.gallery,
    transforms: {
        video: () => `c_limit,h_1280,w_1280,q_auto,du_${env.gallery.maxVideoSeconds}`,
        videoPoster: "so_0,c_limit,h_1280,w_1280,q_auto",
        image: "c_limit,h_2048,w_2048,q_auto,f_auto",
        thumb: "c_fill,g_auto,h_480,w_480,q_auto,f_auto"
    },
    localUploadUrl: (eventId) => `/events/${eventId}/gallery/media`
});
