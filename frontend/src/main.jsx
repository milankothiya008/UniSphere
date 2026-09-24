import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
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

createRoot(document.getElementById("root")).render(
    <StrictMode>
        <BrowserRouter>
            <ToastProvider>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </ToastProvider>
        </BrowserRouter>
    </StrictMode>
);
