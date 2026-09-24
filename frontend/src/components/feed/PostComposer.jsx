import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { clubApi, feedApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, ImageUpload, Input, Select, Textarea } from "../ui";

const TYPES = [
    { value: "ANNOUNCEMENT", label: "Announcement" },
    { value: "CLUB_UPDATE", label: "Club update" },
    { value: "EVENT_UPDATE", label: "Update about an event" }
];

const emptyPost = { type: "ANNOUNCEMENT", title: "", body: "", visibility: "PUBLIC", image: "", event: "" };

// Lets members with POST_UPDATES send a club announcement; public ones notify every user.
export const PostComposer = ({ clubs, onPosted, fixedClubId }) => {
    const toast = useToast();
    const [clubId, setClubId] = useState(fixedClubId || clubs[0]?.club?._id || "");
    const [post, setPost] = useState(emptyPost);
    const [events, setEvents] = useState([]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (fixedClubId) {
            setClubId(fixedClubId);
        }
    }, [fixedClubId]);

    useEffect(() => {
        if (post.type !== "EVENT_UPDATE" || !clubId) {
            return;
        }
        clubApi
            .events(clubId, { limit: 50 })
            .then((response) => setEvents(response.data.filter((event) => ["PUBLISHED", "COMPLETED"].includes(event.status))))
            .catch(() => setEvents([]));
    }, [post.type, clubId]);

    const update = (field) => (event) => setPost((prev) => ({ ...prev, [field]: event.target.value }));

    const submit = async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            const response = await feedApi.create({
                club: clubId,
                type: post.type,
                title: post.title.trim(),
                body: post.body.trim(),
                visibility: post.visibility,
                image: post.image || undefined,
                event: post.type === "EVENT_UPDATE" ? post.event : undefined
            });
            toast.success(post.visibility === "MEMBERS" ? "Announcement sent to club members" : "Announcement sent — everyone on campus has been notified");
            setPost(emptyPost);
            onPosted?.(response.data);
        } catch (err) {
            setError(err);
        } finally {
            setPending(false);
        }
    };

    const needsEvent = post.type === "EVENT_UPDATE";

    return (
        <form className="stack" onSubmit={submit}>
            <div className="form-grid">
                {!fixedClubId && (
                    <Select
                        label="Announce as"
                        value={clubId}
                        onChange={(event) => setClubId(event.target.value)}
                        options={clubs.map((membership) => ({ value: membership.club._id, label: membership.club.name }))}
                    />
                )}
                <Select label="Type" value={post.type} onChange={update("type")} options={TYPES} />
                {needsEvent && (
                    <Select
                        label="Event"
                        value={post.event}
                        onChange={update("event")}
                        placeholder={events.length ? "Choose an event" : "No published events"}
                        options={events.map((item) => ({ value: item._id, label: item.title }))}
                        required
                    />
                )}
                <Select
                    label="Visibility"
                    value={post.visibility}
                    onChange={update("visibility")}
                    options={[
                        { value: "PUBLIC", label: "Everyone (notifies all users)" },
                        { value: "MEMBERS", label: "Club members only" }
                    ]}
                />
            </div>
            <Input label="Title" value={post.title} onChange={update("title")} maxLength={200} required placeholder="What do you want everyone to know?" />
            <Textarea label="Details" value={post.body} onChange={update("body")} maxLength={4000} rows={4} />
            <ImageUpload label="Image (optional)" value={post.image} onChange={(url) => setPost((prev) => ({ ...prev, image: url }))} folder="feed" wide />
            <ApiErrorAlert error={error} />
            <div className="form-actions">
                <Button type="submit" loading={pending} disabled={!clubId || post.title.trim().length < 3 || (needsEvent && !post.event)}>
                    <Send size={15} /> Send announcement
                </Button>
            </div>
        </form>
    );
};
