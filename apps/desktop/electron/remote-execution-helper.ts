import { realpath } from "node:fs/promises";
import { LocalExecutionEnvironment, LOOPBACK_EXECUTION_CAPABILITIES } from "./execution-environment";
import { encodeRemoteFrame, remoteCredentialMatches, RemoteFrameDecoder, validateRemoteRequest, type RemoteResponse } from "./remote-execution-protocol";
import { EXECUTION_PROTOCOL_VERSION } from "../src/execution-environment-types";

const credential = process.env.PI_LOOPBACK_CREDENTIAL ?? "";
const requestedRoot = process.env.PI_LOOPBACK_ROOT ?? "";
const startedAt = Date.now();
const decoder = new RemoteFrameDecoder();
const controllers = new Map<string, AbortController>();
let writing = Promise.resolve();

const environmentPromise = realpath(requestedRoot).then((root) => new LocalExecutionEnvironment(root));
process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const raw of decoder.push(chunk)) void handle(raw);
  } catch {
    process.exitCode = 65;
    process.stdin.pause();
  }
});
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

async function handle(raw: unknown): Promise<void> {
  let request;
  try { request = validateRemoteRequest(raw); } catch (error) { await respond({ version: EXECUTION_PROTOCOL_VERSION, id: extractId(raw), ok: false, error: { code: "PROTOCOL", message: message(error) } }); return; }
  if (!remoteCredentialMatches(credential, request.credential)) { await respond({ version: EXECUTION_PROTOCOL_VERSION, id: request.id, ok: false, error: { code: "AUTH", message: "Credential rejected." } }); return; }
  if (request.method === "cancel") {
    const targetId = typeof request.params?.targetId === "string" ? request.params.targetId : "";
    controllers.get(targetId)?.abort();
    await respond({ version: EXECUTION_PROTOCOL_VERSION, id: request.id, ok: true, result: { cancelled: Boolean(targetId) } });
    return;
  }
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const environment = await environmentPromise;
    let result: unknown;
    switch (request.method) {
      case "hello": result = { protocolVersion: EXECUTION_PROTOCOL_VERSION, capabilities: LOOPBACK_EXECUTION_CAPABILITIES }; break;
      case "health": {
        const delayMs = process.env.PI_APP_TEST_MODE && typeof request.params?.delayMs === "number" ? Math.max(0, Math.min(5_000, request.params.delayMs)) : 0;
        if (delayMs) await abortableDelay(delayMs, controller.signal);
        result = { ok: true, uptimeMs: Date.now() - startedAt };
        break;
      }
      case "root": result = { root: await environment.canonicalRoot() }; break;
      case "listDirectory": result = { entries: await environment.listDirectory(typeof request.params?.path === "string" ? request.params.path : ".", controller.signal) }; break;
      case "gitStatus": result = { entries: await environment.gitStatus(controller.signal) }; break;
      case "shutdown": result = { shuttingDown: true }; break;
      default: throw new Error("Method is not implemented.");
    }
    await respond({ version: EXECUTION_PROTOCOL_VERSION, id: request.id, ok: true, result });
    if (request.method === "shutdown") process.nextTick(() => process.exit(0));
  } catch (error) {
    await respond({ version: EXECUTION_PROTOCOL_VERSION, id: request.id, ok: false, error: { code: controller.signal.aborted ? "CANCELLED" : "OPERATION", message: controller.signal.aborted ? "Request cancelled." : message(error) } });
  } finally {
    controllers.delete(request.id);
  }
}

function respond(response: RemoteResponse): Promise<void> {
  writing = writing.then(() => new Promise<void>((resolve, reject) => process.stdout.write(encodeRemoteFrame(response), (error) => error ? reject(error) : resolve())));
  return writing;
}
function extractId(value: unknown): string { return value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id.slice(0, 100) : "invalid"; }
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replaceAll(requestedRoot, "<workspace>").slice(0, 500); }
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); const abort = () => { clearTimeout(timer); reject(new Error("Request cancelled.")); }; if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }); }
