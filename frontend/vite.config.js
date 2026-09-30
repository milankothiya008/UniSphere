import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_PROXY || "http://localhost:5000";

export default defineConfig({
    plugins: [react()],
    build: {
        rolldownOptions: {
            output: {
                // React and the router change far less often than the app, so they get their own
                // long-cached file and a deploy only re-downloads the app code.
                codeSplitting: {
                    groups: [{ name: "vendor", test: /node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/, priority: 20 }]
                }
            }
        }
    },
    server: {
        port: Number(process.env.VITE_PORT) || 3000,
        proxy: {
            "/api": { target: apiTarget, changeOrigin: true },
            "/uploads": { target: apiTarget, changeOrigin: true }
        }
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: "./src/test/setup.js",
        css: false
    }
});
