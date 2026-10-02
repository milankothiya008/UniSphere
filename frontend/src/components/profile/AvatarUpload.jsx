import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { uploadApi, userApi } from "../../api/endpoints";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Avatar } from "../ui";
import { PhotoCropDialog } from "./PhotoCropper";

// The original can be large: it is cropped and shrunk to a small JPEG in the browser before upload.
const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

/** The signed-in user's profile photo: pick one, crop it in a preview, then it's saved; or remove it. */
export const AvatarUpload = ({ size = "xl", allowRemove = true }) => {
    const { user, setUser } = useAuth();
    const toast = useToast();
    const input = useRef(null);
    const [pending, setPending] = useState(false);
    const [choosing, setChoosing] = useState(null);

    const save = async (avatar) => {
        const response = await userApi.update(user._id, { avatar });
        setUser((prev) => ({ ...prev, avatar: response.data.avatar }));
    };

    const pick = (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!ACCEPT.includes(file.type)) return toast.error("Choose a JPEG, PNG or WebP photo");
        if (file.size > MAX_BYTES) return toast.error("The photo must be 20 MB or smaller");
        setChoosing(file);
    };

    const upload = async (file) => {
        setChoosing(null);
        setPending(true);
        try {
            const uploaded = await uploadApi.image(file, "avatars");
            await save(uploaded.data.url);
            toast.success("Profile photo updated");
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    const remove = async () => {
        setPending(true);
        try {
            await save(null);
            toast.info("Profile photo removed");
        } catch (error) {
            toast.error(error);
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="avatar-upload">
            <button
                type="button"
                className={`avatar-upload-button ${pending ? "is-busy" : ""}`}
                onClick={() => input.current?.click()}
                disabled={pending}
                aria-label={user.avatar ? "Change profile photo" : "Add a profile photo"}
            >
                <Avatar name={user.name} src={user.avatar} size={size} />
                <span className="avatar-upload-badge" aria-hidden="true">
                    {pending ? <span className="spinner spinner-sm" /> : <Camera size={15} />}
                </span>
            </button>
            <input ref={input} type="file" accept={ACCEPT.join(",")} hidden onChange={pick} />
            <PhotoCropDialog file={choosing} onClose={() => setChoosing(null)} onCropped={upload} />
            {allowRemove && user.avatar && (
                <button type="button" className="link-button small" onClick={remove} disabled={pending}>
                    <Trash2 size={13} /> Remove photo
                </button>
            )}
        </div>
    );
};
