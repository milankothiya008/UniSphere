import { useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { uploadApi } from "../../api/endpoints";
import { Field } from "./Form";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

// Uploads to the backend (Cloudinary or local storage) and reports the resulting URL.
export const ImageUpload = ({ label, value, onChange, folder, wide = false, hint = "JPEG, PNG or WebP, up to 5 MB" }) => {
    const inputRef = useRef(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    const pick = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) {
            return;
        }
        if (!ACCEPT.includes(file.type)) {
            setError("Only JPEG, PNG or WebP images are allowed");
            return;
        }
        if (file.size > MAX_BYTES) {
            setError("Image must be 5 MB or smaller");
            return;
        }

        setPending(true);
        setError(null);
        try {
            const response = await uploadApi.image(file, folder);
            onChange(response.data.url);
        } catch (err) {
            setError(err.message);
        } finally {
            setPending(false);
        }
    };

    return (
        <Field label={label} hint={hint} error={error}>
            <div className="upload">
                <div className={`upload-preview ${wide ? "wide" : ""}`}>{value ? <img src={value} alt="" /> : <ImagePlus size={24} />}</div>
                <div className="row">
                    <input ref={inputRef} type="file" accept={ACCEPT.join(",")} hidden onChange={pick} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()} disabled={pending}>
                        {pending ? <span className="spinner spinner-sm" /> : <Upload size={14} />}
                        {value ? "Replace" : "Upload"}
                    </button>
                    {value && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
                            <Trash2 size={14} /> Remove
                        </button>
                    )}
                </div>
            </div>
        </Field>
    );
};
