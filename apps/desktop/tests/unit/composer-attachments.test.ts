import { describe, expect, it } from "vitest";
import {
  MAX_COMPOSER_ATTACHMENTS,
  MAX_COMPOSER_METADATA_BYTES,
  MAX_COMPOSER_TEXT_LENGTH,
  validateComposerAttachmentLimits,
  validateComposerMessageMetadata,
  validateComposerText,
} from "../../src/composer-attachments";
import type { ComposerAttachment } from "../../src/desktop-state";

function file(id: string, sizeBytes = 1): ComposerAttachment {
  return {
    id,
    kind: "file",
    name: `${id}.txt`,
    mimeType: "text/plain",
    fsPath: `/tmp/${id}.txt`,
    sizeBytes,
  };
}

describe("composer payload limits", () => {
  it("accepts a normal message and rejects oversized character and UTF-8 payloads", () => {
    expect(validateComposerText("hello")).toBe("hello");
    expect(() => validateComposerText("x".repeat(MAX_COMPOSER_TEXT_LENGTH + 1)))
      .toThrow("characters or shorter");
    expect(() => validateComposerText("界".repeat(400_000))).toThrow("1 MB or smaller");
  });

  it("rejects too many attachments without silently discarding the tail", () => {
    const attachments = Array.from(
      { length: MAX_COMPOSER_ATTACHMENTS + 1 },
      (_, index) => file(`file-${index}`),
    );
    expect(() => validateComposerAttachmentLimits(attachments)).toThrow("Attach up to");
  });

  it("rejects duplicate IDs and total payloads over the attachment budget", () => {
    expect(() => validateComposerAttachmentLimits([file("same"), file("same")]))
      .toThrow("unique ID");
    expect(() => validateComposerAttachmentLimits([
      file("large-1", 20 * 1024 * 1024),
      file("large-2", 20 * 1024 * 1024),
    ])).toThrow("32 MB or smaller");
  });

  it("rejects oversized and overly complex message metadata", () => {
    expect(validateComposerMessageMetadata({ source: "suggestion", index: 1 }))
      .toEqual({ source: "suggestion", index: 1 });
    expect(() => validateComposerMessageMetadata("x".repeat(MAX_COMPOSER_METADATA_BYTES + 1)))
      .toThrow("64 KB or smaller");
    let nested: unknown = "leaf";
    for (let index = 0; index < 20; index += 1) {
      nested = { nested };
    }
    expect(() => validateComposerMessageMetadata(nested)).toThrow("too complex");
  });
});
