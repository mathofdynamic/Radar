import { defineConfig } from "vitest/config";

// Current tests are deterministic unit tests and do not require deployed Cloudflare
// bindings. Keep them local so CI does not need a Cloudflare API token. Live D1,
// Queue, Workers AI, Vectorize and Telegram behavior remains deployment-smoke-test scope.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
