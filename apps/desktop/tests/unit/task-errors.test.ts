import { describe, expect, it } from "vitest";
import {
  classifyTaskError,
  redactedTaskErrorDiagnostics,
} from "../../src/product-experience/task-errors";

describe("task error recovery", () => {
  it("maps structured and message-only failures to safe recovery actions", () => {
    expect(classifyTaskError({
      code: "AUTH_REQUIRED",
      message: "Provider login expired",
    })).toMatchObject({
      category: "provider-auth",
      recoveryActions: ["reauthenticate", "open-settings", "copy-diagnostics"],
      attemptCount: 1,
    });
    expect(classifyTaskError({
      message: "Playwright test failed",
      attemptCount: 2,
    })).toMatchObject({
      category: "test-failure",
      attemptCount: 2,
    });
    expect(classifyTaskError({ message: "Something unusual happened" }).category).toBe("unknown");
  });

  it("redacts secrets, emails, and private paths from copied details", () => {
    const classified = classifyTaskError({
      message: "Unauthorized",
      code: "AUTH_REQUIRED",
    });
    const diagnostics = redactedTaskErrorDiagnostics({
      classified,
      message: "API_KEY=super-secret person@example.com /Users/example/private.txt",
    });
    expect(diagnostics).toContain("API_KEY=[redacted]");
    expect(diagnostics).toContain("[email]");
    expect(diagnostics).toContain("[path]");
    expect(diagnostics).not.toContain("super-secret");
    expect(diagnostics).not.toContain("person@example.com");
  });
});
