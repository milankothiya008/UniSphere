import { Compass } from "lucide-react";
import { ButtonLink, EmptyState } from "../components/ui";

const NotFoundPage = () => (
    <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={<ButtonLink to="/feed" variant="secondary">Go home</ButtonLink>}
    />
);

export default NotFoundPage;
