import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { clubApi, feedApi } from "../../api/endpoints";
import { useToast } from "../../context/ToastContext";
import { ApiErrorAlert, Button, ImageUpload, Input, Select, Switch, Textarea } from "../ui";
import { AudiencePicker, audienceIsEmpty, audiencePayload, emptyAudience } from "./AudiencePicker";

const TYPES = [
    { value: "ANNOUNCEMENT", label: "Announcement" },
    { value: "CLUB_UPDATE", label: "Club update" },
    { value: "EVENT_UPDATE", label: "Update about an event" }
];

const emptyPost = { type: "ANNOUNCEMENT", title: "", body: "", image: "", event: "", sendEmail: true };

const SENT = {
    EVERYONE: "Announcement sent — everyone on campus has been notified",
    FOLLOWERS: "Announcement sent to the club's followers",
    MEMBERS: "Announcement sent to club members",
    CUSTOM: "Announcement sent to the people you chose"
};

// Lets members with POST_UPDATES send a club announcement to the audience they choose.
export const PostComposer = ({ clubs, onPosted, fixedClubId }) => {
    const toast = useToast();
    const [clubId, setClubId] = useState(fixedClubId || clubs[0]?.club?._id || "");
    const [post, setPost] = useState(emptyPost);
    const [audience, setAudience] = useState(emptyAudience);
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
                audience: audiencePayload(audience),
                sendEmail: post.sendEmail,
                image: post.image || undefined,
                event: post.type === "EVENT_UPDATE" ? post.event : undefined
            });
            toast.success(SENT[audience.mode]);
            setPost(emptyPost);
            setAudience(emptyAudience());
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
            </div>
            <AudiencePicker clubId={clubId} value={audience} onChange={setAudience} />
            <Switch
                checked={post.sendEmail}
                onChange={(value) => setPost((prev) => ({ ...prev, sendEmail: value }))}
                label="Also send by email"
                description="Email goes only to the same audience, and respects everyone's email settings."
            />
            <Input label="Title" value={post.title} onChange={update("title")} maxLength={200} required placeholder="What do you want everyone to know?" />
            <Textarea label="Details" value={post.body} onChange={update("body")} maxLength={4000} rows={4} />
            <ImageUpload label="Image (optional)" value={post.image} onChange={(url) => setPost((prev) => ({ ...prev, image: url }))} folder="feed" wide />
            <ApiErrorAlert error={error} />
            <div className="form-actions">
                <Button type="submit" loading={pending} disabled={!clubId || post.title.trim().length < 3 || (needsEvent && !post.event) || audienceIsEmpty(audience)}>
                    <Send size={15} /> Send announcement
                </Button>
            </div>
        </form>
    );
};
