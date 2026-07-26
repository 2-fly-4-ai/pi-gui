import type { ComposerAttachment } from "./desktop-state";

export function safeAttachmentName(attachment: ComposerAttachment): string {
  const leaf = attachment.name.split(/[/\\]+/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return leaf || (attachment.kind === "image" ? "image" : "file");
}

export function attachmentTypeLabel(attachment: ComposerAttachment): string {
  if (attachment.kind === "image") {
    return attachment.mimeType.split("/").at(-1)?.toUpperCase() || "IMAGE";
  }
  const extension = safeAttachmentName(attachment).split(".").at(-1);
  if (extension && extension !== safeAttachmentName(attachment)) {
    return extension.slice(0, 8).toUpperCase();
  }
  return attachment.mimeType === "application/octet-stream"
    ? "FILE"
    : attachment.mimeType.split("/").at(-1)?.slice(0, 12).toUpperCase() || "FILE";
}

export function attachmentSizeBytes(attachment: ComposerAttachment): number | undefined {
  if (attachment.kind === "file") {
    return attachment.sizeBytes;
  }
  if (!attachment.data) {
    return undefined;
  }
  const padding = attachment.data.endsWith("==") ? 2 : attachment.data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((attachment.data.length * 3) / 4) - padding);
}

export function formatAttachmentSize(attachment: ComposerAttachment): string | undefined {
  const bytes = attachmentSizeBytes(attachment);
  if (bytes === undefined) {
    return undefined;
  }
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}

export function attachmentSourceLabel(attachment: ComposerAttachment): string {
  return attachment.kind === "image"
    ? "Copied attachment"
    : "Workspace reference";
}

export function attachmentStatusLabel(attachment: ComposerAttachment): string {
  switch (attachment.status ?? "ready") {
    case "pending": return "Processing";
    case "missing": return "Missing";
    case "failed": return "Failed";
    case "ready": return "Ready";
  }
}
