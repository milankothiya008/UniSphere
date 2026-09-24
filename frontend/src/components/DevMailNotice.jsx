import { Link } from "react-router-dom";
import { Inbox } from "lucide-react";
import { useEmailDelivery } from "../hooks/useEmailDelivery";
import { Alert } from "./ui";

// When the server has no SMTP configured (development), emails are captured instead of sent.
export const DevMailNotice = ({ email }) => {
    const mode = useEmailDelivery();

    if (mode !== "preview") {
        return null;
    }

    const to = email ? `?to=${encodeURIComponent(email.trim().toLowerCase())}` : "";

    return (
        <Alert type="info" title="Development mode: email sending is not set up">
            Emails aren't delivered to real inboxes on this server yet.{" "}
            <Link to={`/dev/inbox${to}`} style={{ fontWeight: 600 }}>
                <Inbox size={14} style={{ verticalAlign: "-2px" }} /> Open the development inbox
            </Link>{" "}
            to find your code.
        </Alert>
    );
};
