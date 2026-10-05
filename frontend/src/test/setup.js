import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The whole suite runs files in parallel; on a busy machine screens can take longer than the default
// 1 second to appear, so wait up to 5 before calling it a failure.
configure({ asyncUtilTimeout: 5000 });
