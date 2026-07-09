import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pi-gui/catalogs": fromRoot("./packages/catalogs/src/index.ts"),
      "@pi-gui/pi-sdk-driver": fromRoot("./packages/pi-sdk-driver/src/index.ts"),
      "@pi-gui/session-driver": fromRoot("./packages/session-driver/src/index.ts"),
      "@pi-gui/session-driver/runtime-types": fromRoot("./packages/session-driver/src/runtime-types.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["apps/desktop/tests/unit/**/*.test.ts", "packages/*/tests/unit/**/*.test.ts"],
    restoreMocks: true,
  },
});
