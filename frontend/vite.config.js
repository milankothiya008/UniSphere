import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_PROXY || "http://localhost:5000";

export default defineConfig({
    plugins: [react()],
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
