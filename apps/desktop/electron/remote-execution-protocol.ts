import { timingSafeEqual } from "node:crypto";
import { EXECUTION_PROTOCOL_VERSION } from "../src/execution-environment-types";

export const MAX_REMOTE_FRAME_BYTES = 64 * 1024;
export const MAX_REMOTE_PENDING_REQUESTS = 32;

export interface RemoteRequest {
  readonly version: number;
  readonly id: string;
  readonly credential: string;
  readonly method: "hello" | "health" | "root" | "listDirectory" | "gitStatus" | "cancel" | "shutdown";
  readonly params?: Record<string, unknown>;
}

export interface RemoteResponse {
  readonly version: number;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

export function encodeRemoteFrame(message: RemoteRequest | RemoteResponse): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.byteLength > MAX_REMOTE_FRAME_BYTES) throw new Error("Remote execution frame exceeds 64 KiB.");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.byteLength, 0);
  return Buffer.concat([header, body]);
}

export class RemoteFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer | Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.byteLength > MAX_REMOTE_FRAME_BYTES * 2 + 4) throw new Error("Remote execution receive buffer exceeded its bound.");
    const messages: unknown[] = [];
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length <= 0 || length > MAX_REMOTE_FRAME_BYTES) throw new Error("Remote execution frame length is invalid.");
      if (this.buffer.byteLength < length + 4) break;
      const raw = this.buffer.subarray(4, length + 4).toString("utf8");
      this.buffer = this.buffer.subarray(length + 4);
      messages.push(JSON.parse(raw));
    }
    return messages;
  }
}

export function validateRemoteRequest(value: unknown): RemoteRequest {
  if (!record(value) || value.version !== EXECUTION_PROTOCOL_VERSION || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 100 || typeof value.credential !== "string" || value.credential.length < 32 || value.credential.length > 200 || !REMOTE_METHODS.has(String(value.method))) {
    throw new Error("Remote execution request is invalid or uses an unsupported version.");
  }
  return value as unknown as RemoteRequest;
}

export function validateRemoteResponse(value: unknown): RemoteResponse {
  if (!record(value) || value.version !== EXECUTION_PROTOCOL_VERSION || typeof value.id !== "string" || typeof value.ok !== "boolean") throw new Error("Remote execution response is invalid or stale-versioned.");
  return value as unknown as RemoteResponse;
}

export function remoteCredentialMatches(expected: string, presented: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(presented, "utf8");
  return left.byteLength === right.byteLength && left.byteLength >= 32 && timingSafeEqual(left, right);
}

const REMOTE_METHODS = new Set(["hello", "health", "root", "listDirectory", "gitStatus", "cancel", "shutdown"]);
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
