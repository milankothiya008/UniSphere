const { env } = require("../config/env");
const { createMediaStore, KINDS } = require("./MediaStore");

// Chat photos, videos, voice notes and documents (see MediaStore): Cloudinary in production, UPLOAD_DIR in
// development. Uploads are issued per conversation, so a file can only be attached in the chat it was
// uploaded for, by the person who uploaded it.

const DOCUMENT_FORMATS = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "csv"];

module.exports = createMediaStore({
    name: "Chat",
    scopeLabel: "chat",
    folder: (conversationId) => `${env.cloudinary.folder}/chat/${conversationId}`,
    localDir: "chat",
    macPurpose: "chat-media",
    localPurpose: "chat-local",
    tag: "campusconnect-chat",
    kinds: [KINDS.IMAGE, KINDS.VIDEO, KINDS.AUDIO, KINDS.DOCUMENT],
    documentFormats: DOCUMENT_FORMATS,
    limits: () => env.chat,
    transforms: {
        video: () => `c_limit,h_1280,w_1280,q_auto,du_${env.chat.maxVideoSeconds}`,
        videoPoster: "so_0,c_limit,h_1280,w_1280,q_auto",
        image: "c_limit,h_2048,w_2048,q_auto,f_auto",
        thumb: "c_fill,h_400,w_400,q_auto,f_auto",
        audio: "q_auto"
    },
    localUploadUrl: (conversationId) => `/chat/media?conversation=${conversationId}`
});

module.exports.DOCUMENT_FORMATS = DOCUMENT_FORMATS;
