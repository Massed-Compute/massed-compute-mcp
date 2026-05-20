import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    // Use child-process forks instead of worker threads so each test file
    // gets a real OS process. Worker threads share libc with the parent and
    // do not propagate `process.env` mutations to `getenv()`, which means
    // `os.homedir()` keeps returning the developer's real home dir even
    // after a test overrides HOME — silently writing test fixtures into
    // the real config dir. Forks fix this by giving each file its own libc.
    pool: "forks",
  },
});
