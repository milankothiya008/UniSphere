import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
    { ignores: ["dist", "coverage"] },
    {
        files: ["**/*.{js,jsx}"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node },
            parserOptions: { ecmaFeatures: { jsx: true } }
        },
        settings: { react: { version: "detect" } },
        plugins: { react, "react-hooks": reactHooks },
        rules: {
            ...js.configs.recommended.rules,
            "react/jsx-uses-vars": "error",
            "react/jsx-uses-react": "off",
            "react/jsx-no-undef": "error",
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }]
        }
    },
    {
        files: ["src/**/*.test.{js,jsx}", "src/test/**"],
        languageOptions: { globals: { ...globals.vitest } }
    }
];
