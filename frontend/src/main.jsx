import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { LightboxProvider } from "./components/ui/Media";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/polish.css";
import "./styles/dashboard.css";
import "./styles/feed.css";
import "./styles/pages.css";
import "./styles/stories.css";
import "./styles/teams.css";
import "./styles/tickets.css";
import "./styles/gallery.css";
import "./styles/recruitment.css";
import "./styles/roles.css";
import "./styles/system.css";
import "./styles/planner.css";
import "./styles/insta.css";
import "./styles/social.css";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <BrowserRouter>
            <ToastProvider>
                <LightboxProvider>
                <AuthProvider>
                    <App />
                </AuthProvider>
                </LightboxProvider>
            </ToastProvider>
        </BrowserRouter>
    </StrictMode>
);
