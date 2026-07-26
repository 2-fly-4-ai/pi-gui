import { describe, expect, it } from "vitest";
import {
  attachmentSizeBytes,
  attachmentSourceLabel,
  attachmentStatusLabel,
  attachmentTypeLabel,
  formatAttachmentSize,
  safeAttachmentName,
} from "../../src/attachment-presentation";

describe("attachment presentation", () => {
  it("never exposes path components from a display name", () => {
    const attachment = {
      id: "file-1",
      kind: "file",
      name: "/private/tmp/report.txt",
      mimeType: "text/plain",
      fsPath: "/private/tmp/report.txt",
      sizeBytes: 2_048,
    } as const;
    expect(safeAttachmentName(attachment)).toBe("report.txt");
    expect(attachmentTypeLabel(attachment)).toBe("TXT");
    expect(formatAttachmentSize(attachment)).toBe("2.0 KB");
    expect(attachmentSourceLabel(attachment)).toBe("Workspace reference");
    expect(attachmentStatusLabel(attachment)).toBe("Ready");
  });

  it("estimates decoded image size without retaining a second payload", () => {
    const attachment = {
      id: "image-1",
      kind: "image",
      name: "pasted.png",
      mimeType: "image/png",
      data: "AQIDBA==",
    } as const;
    expect(attachmentSizeBytes(attachment)).toBe(4);
    expect(formatAttachmentSize(attachment)).toBe("4 B");
    expect(attachmentSourceLabel(attachment)).toBe("Copied attachment");
    expect(attachmentStatusLabel({ ...attachment, status: "pending" })).toBe("Processing");
  });

  it("distinguishes missing and failed lifecycle states", () => {
    const attachment = {
      id: "file-2",
      kind: "file",
      name: "missing.txt",
      mimeType: "text/plain",
      fsPath: "/workspace/missing.txt",
      source: "workspace-reference",
      status: "missing",
    } as const;
    expect(attachmentSourceLabel(attachment)).toBe("Workspace reference");
    expect(attachmentStatusLabel(attachment)).toBe("Missing");
    expect(attachmentStatusLabel({ ...attachment, status: "failed" })).toBe("Failed");
  });
});
