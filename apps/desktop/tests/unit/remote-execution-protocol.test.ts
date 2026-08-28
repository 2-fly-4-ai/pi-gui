import { describe, expect, it } from "vitest";
import { EXECUTION_PROTOCOL_VERSION } from "../../src/execution-environment-types";
import { parseGitStatus, resolveWithin } from "../../electron/execution-environment";
import { encodeRemoteFrame, MAX_REMOTE_FRAME_BYTES, remoteCredentialMatches, RemoteFrameDecoder, validateRemoteRequest, validateRemoteResponse } from "../../electron/remote-execution-protocol";

describe("remote execution protocol", () => {
  const request = { version: EXECUTION_PROTOCOL_VERSION, id: "request-1", credential: "x".repeat(32), method: "health" as const };

  it("decodes fragmented and coalesced bounded frames", () => {
    const first = encodeRemoteFrame(request);
    const second = encodeRemoteFrame({ version: EXECUTION_PROTOCOL_VERSION, id: "request-1", ok: true, result: { ok: true } });
    const decoder = new RemoteFrameDecoder();
    expect(decoder.push(first.subarray(0, 3))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([request, { version: 1, id: "request-1", ok: true, result: { ok: true } }]);
  });

  it("rejects oversized frames, bad credentials, and version mismatches", () => {
    expect(() => encodeRemoteFrame({ ...request, params: { value: "x".repeat(MAX_REMOTE_FRAME_BYTES) } })).toThrow(/64 KiB/);
    expect(() => validateRemoteRequest({ ...request, credential: "short" })).toThrow(/invalid/i);
    expect(() => validateRemoteRequest({ ...request, version: 99 })).toThrow(/version/i);
    expect(() => validateRemoteResponse({ version: 99, id: "x", ok: true })).toThrow(/version/i);
    expect(remoteCredentialMatches("x".repeat(32), "x".repeat(32))).toBe(true);
    expect(remoteCredentialMatches("x".repeat(32), "y".repeat(32))).toBe(false);
    expect(remoteCredentialMatches("x".repeat(32), "short")).toBe(false);
  });

  it("rejects workspace traversal and parses bounded Git status semantics", () => {
    expect(resolveWithin("/tmp/workspace", "src/file.ts")).toBe("/tmp/workspace/src/file.ts");
    expect(() => resolveWithin("/tmp/workspace", "../secret")).toThrow(/escapes/i);
    expect(parseGitStatus("M  staged.ts\n M changed.ts\n?? new.ts\nR  old.ts -> renamed.ts\n")).toEqual([
      { path: "staged.ts", status: "modified", staged: true },
      { path: "changed.ts", status: "modified", staged: false },
      { path: "new.ts", status: "untracked", staged: false },
      { path: "renamed.ts", status: "modified", staged: true },
    ]);
  });
});
