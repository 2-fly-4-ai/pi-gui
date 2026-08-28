/// <reference lib="dom" />

import type { ComposerAttachment, ComposerFileAttachment, ComposerImageAttachment } from "./desktop-state";

export const SUPPORTED_COMPOSER_IMAGE_TYPES = [
  { extension: "png", mimeType: "image/png" },
  { extension: "jpg", mimeType: "image/jpeg" },
  { extension: "jpeg", mimeType: "image/jpeg" },
  { extension: "gif", mimeType: "image/gif" },
  { extension: "webp", mimeType: "image/webp" },
] as const;
export const MAX_COMPOSER_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_COMPOSER_ATTACHMENTS = 12;
export const MAX_COMPOSER_ATTACHMENTS_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_COMPOSER_TEXT_LENGTH = 500_000;
export const MAX_COMPOSER_TEXT_BYTES = 1024 * 1024;
export const MAX_COMPOSER_IMAGE_DIMENSION = 8_192;
export const MAX_COMPOSER_METADATA_BYTES = 64 * 1024;
const MAX_COMPOSER_METADATA_NODES = 2_000;
const MAX_COMPOSER_METADATA_DEPTH = 16;
const MAX_ATTACHMENT_ID_LENGTH = 256;
const MAX_ATTACHMENT_NAME_LENGTH = 1_024;
const MAX_ATTACHMENT_MIME_TYPE_LENGTH = 256;
const MAX_ATTACHMENT_PATH_LENGTH = 32_768;

type ComposerImageMimeType = (typeof SUPPORTED_COMPOSER_IMAGE_TYPES)[number]["mimeType"];
type FileWithPath = File & { readonly path?: string };

const SUPPORTED_COMPOSER_IMAGE_MIME_TYPES = new Set(SUPPORTED_COMPOSER_IMAGE_TYPES.map((type) => type.mimeType));
const IMAGE_MIME_TYPE_BY_EXTENSION = new Map(
  SUPPORTED_COMPOSER_IMAGE_TYPES.map((type) => [type.extension, type.mimeType] as const),
);

function inferImageMimeType(file: Pick<File, "name" | "type">): ComposerImageMimeType | undefined {
  if (SUPPORTED_COMPOSER_IMAGE_MIME_TYPES.has(file.type as ComposerImageMimeType)) {
    return file.type as ComposerImageMimeType;
  }

  const extension = file.name.split(".").pop()?.trim().toLowerCase();
  if (!extension) {
    return undefined;
  }

  return IMAGE_MIME_TYPE_BY_EXTENSION.get(
    extension as (typeof SUPPORTED_COMPOSER_IMAGE_TYPES)[number]["extension"],
  );
}

function isImageFile(file: Pick<File, "name" | "type">): boolean {
  return Boolean(inferImageMimeType(file));
}

function fileSignature(file: FileWithPath): string {
  return `${file.path ?? ""}:${file.name}:${file.type}:${file.size}:${file.lastModified}`;
}

function dedupeFiles(files: readonly File[]): File[] {
  const seen = new Set<string>();
  const unique: File[] = [];
  for (const file of files) {
    const signature = fileSignature(file as FileWithPath);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    unique.push(file);
  }
  return unique;
}

export function hasFilesInDataTransfer(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) {
    return false;
  }

  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes("Files")) {
    return true;
  }

  if (Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file")) {
    return true;
  }

  return (dataTransfer.files?.length ?? 0) > 0;
}

export function extractImageFilesFromClipboardData(clipboardData: DataTransfer | null | undefined): File[] {
  if (!clipboardData) {
    return [];
  }

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .filter(isImageFile);
  const clipboardFiles = Array.from(clipboardData.files ?? []).filter(isImageFile);
  return dedupeFiles([...itemFiles, ...clipboardFiles]);
}

export function extractFilesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) {
    return [];
  }

  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const transferFiles = Array.from(dataTransfer.files ?? []);
  return dedupeFiles([...itemFiles, ...transferFiles]);
}

export async function readComposerAttachmentsFromFiles(files: readonly File[]): Promise<ComposerAttachment[]> {
  const attachments = await Promise.all(dedupeFiles(files).map(readComposerAttachmentFromFile));
  return [...validateComposerAttachmentLimits(
    attachments.filter((attachment): attachment is ComposerAttachment => Boolean(attachment)),
  )];
}

export function boundComposerAttachments(
  attachments: readonly ComposerAttachment[],
): ComposerAttachment[] {
  const bounded: ComposerAttachment[] = [];
  const seenIds = new Set<string>();
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (seenIds.has(attachment.id)) continue;
    const bytes = attachment.kind === "image"
      ? approximateBase64Bytes(attachment.data)
      : Math.max(0, attachment.sizeBytes ?? 0);
    if (
      bounded.length >= MAX_COMPOSER_ATTACHMENTS
      || totalBytes + bytes > MAX_COMPOSER_ATTACHMENTS_TOTAL_BYTES
    ) {
      break;
    }
    seenIds.add(attachment.id);
    bounded.push(attachment);
    totalBytes += bytes;
  }
  return bounded;
}

export function validateComposerAttachmentLimits(
  attachments: readonly ComposerAttachment[],
): readonly ComposerAttachment[] {
  if (attachments.length > MAX_COMPOSER_ATTACHMENTS) {
    throw new Error(`Attach up to ${MAX_COMPOSER_ATTACHMENTS} files or images at a time.`);
  }
  const seenIds = new Set<string>();
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (
      !attachment.id
      || attachment.id.length > MAX_ATTACHMENT_ID_LENGTH
      || seenIds.has(attachment.id)
    ) {
      throw new Error("Each attachment must have a unique ID.");
    }
    if (!attachment.name || attachment.name.length > MAX_ATTACHMENT_NAME_LENGTH) {
      throw new Error("Attachment names must be 1,024 characters or shorter.");
    }
    if (!attachment.mimeType || attachment.mimeType.length > MAX_ATTACHMENT_MIME_TYPE_LENGTH) {
      throw new Error("Attachment MIME types must be 256 characters or shorter.");
    }
    if (
      attachment.kind === "file"
      && (!attachment.fsPath || attachment.fsPath.length > MAX_ATTACHMENT_PATH_LENGTH)
    ) {
      throw new Error("Attachment paths must be 32,768 characters or shorter.");
    }
    seenIds.add(attachment.id);
    const bytes = attachment.kind === "image"
      ? approximateBase64Bytes(attachment.data)
      : Math.max(0, attachment.sizeBytes ?? 0);
    if (attachment.kind === "image" && bytes > MAX_COMPOSER_IMAGE_BYTES) {
      throw new Error("Images must be 10 MB or smaller.");
    }
    totalBytes += bytes;
    if (totalBytes > MAX_COMPOSER_ATTACHMENTS_TOTAL_BYTES) {
      throw new Error("Attachments must be 32 MB or smaller in total.");
    }
  }
  return attachments;
}

export function validateComposerText(text: string): string {
  if (typeof text !== "string") {
    throw new Error("Message text must be a string.");
  }
  if (text.length > MAX_COMPOSER_TEXT_LENGTH) {
    throw new Error(`Messages must be ${MAX_COMPOSER_TEXT_LENGTH.toLocaleString()} characters or shorter.`);
  }
  if (new TextEncoder().encode(text).byteLength > MAX_COMPOSER_TEXT_BYTES) {
    throw new Error("Messages must be 1 MB or smaller.");
  }
  return text;
}

export function validateComposerMessageMetadata(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_COMPOSER_METADATA_NODES || current.depth > MAX_COMPOSER_METADATA_DEPTH) {
      throw new Error("Message metadata is too complex.");
    }
    if (
      current.value === null
      || typeof current.value === "boolean"
      || typeof current.value === "number"
    ) {
      bytes += 8;
    } else if (typeof current.value === "string") {
      bytes += new TextEncoder().encode(current.value).byteLength;
    } else if (Array.isArray(current.value)) {
      if (seen.has(current.value)) {
        throw new Error("Message metadata cannot contain cycles.");
      }
      seen.add(current.value);
      for (const nested of current.value) {
        pending.push({ value: nested, depth: current.depth + 1 });
      }
    } else if (typeof current.value === "object") {
      if (seen.has(current.value)) {
        throw new Error("Message metadata cannot contain cycles.");
      }
      seen.add(current.value);
      for (const [key, nested] of Object.entries(current.value)) {
        bytes += new TextEncoder().encode(key).byteLength;
        pending.push({ value: nested, depth: current.depth + 1 });
      }
    } else {
      throw new Error("Message metadata contains an unsupported value.");
    }
    if (bytes > MAX_COMPOSER_METADATA_BYTES) {
      throw new Error("Message metadata must be 64 KB or smaller.");
    }
  }
  return value;
}

async function readComposerAttachmentFromFile(file: File): Promise<ComposerAttachment | null> {
  if (isImageFile(file)) {
    if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
      throw new Error("Images must be 10 MB or smaller.");
    }
    await validateImageDimensions(file);
    return readImageAttachmentFromFile(file);
  }

  return readFileAttachmentFromFile(file as FileWithPath);
}

async function validateImageDimensions(file: File): Promise<void> {
  if (typeof createImageBitmap !== "function") {
    return;
  }
  const image = await createImageBitmap(file);
  try {
    if (image.width > MAX_COMPOSER_IMAGE_DIMENSION || image.height > MAX_COMPOSER_IMAGE_DIMENSION) {
      throw new Error(`Images must be ${MAX_COMPOSER_IMAGE_DIMENSION.toLocaleString()} pixels or smaller per side.`);
    }
  } finally {
    image.close();
  }
}

function readImageAttachmentFromFile(file: File): Promise<ComposerImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const commaIndex = dataUrl.indexOf(",");
      resolve({
        id: crypto.randomUUID(),
        kind: "image",
        name: file.name || "pasted-image.png",
        mimeType: inferImageMimeType(file) ?? "image/png",
        data: dataUrl.slice(commaIndex + 1),
        source: "copied",
        status: "ready",
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name || "the selected image"}.`));
    reader.readAsDataURL(file);
  });
}

function readFileAttachmentFromFile(file: FileWithPath): ComposerFileAttachment | null {
  const fsPath = resolveFilePath(file);
  if (!fsPath) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    kind: "file",
    name: file.name || fileNameFromPath(fsPath) || "attached-file",
    mimeType: file.type || "application/octet-stream",
    fsPath,
    source: "workspace-reference",
    status: "ready",
    ...(typeof file.size === "number" ? { sizeBytes: file.size } : {}),
  };
}

function resolveFilePath(file: FileWithPath): string | null {
  const directPath = file.path?.trim();
  if (directPath) {
    return directPath;
  }

  const bridgePath = window.piApp?.getPathForFile?.(file)?.trim();
  return bridgePath || null;
}

function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[/\\]+/);
  return segments[segments.length - 1] ?? "";
}

function approximateBase64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}
