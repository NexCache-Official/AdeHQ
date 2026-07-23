import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { createVoiceWorkerRuntime } from "./bootstrap.js";
import type { VoiceWorkerRuntime } from "./runtime.js";

const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "0.0.0.0";
const startedAt = Date.now();

export function createVoiceWorkerServer(runtime: VoiceWorkerRuntime): Server {
  return createServer((request, response) => {
    void handleRequest(runtime, request, response);
  });
}

const runtime = createVoiceWorkerRuntime(process.env);
const server = createVoiceWorkerServer(runtime);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: "voice_worker.started", host, port }));
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close((error) => {
        if (error) console.error(JSON.stringify({ event: "voice_worker.stop_failed", error }));
        process.exitCode = error ? 1 : 0;
      });
    });
  }
}

async function handleRequest(
  runtime: VoiceWorkerRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const path = new URL(request.url ?? "/", "http://voice-worker.local").pathname;
    if (request.method === "GET" && path === "/healthz") {
      return json(response, 200, {
        ok: true,
        service: "adehq-voice-worker",
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      });
    }
    if (request.method === "GET" && path === "/readyz") {
      const status = runtime.readiness();
      return json(response, status.ready ? 200 : 503, {
        ok: status.ready,
        cutoverReady: false,
        capabilities: status.capabilities,
        activeSessions: runtime.sessions.size,
      });
    }
    if (request.method === "GET" && path === "/") {
      return json(response, 200, {
        service: "adehq-voice-worker",
        runtime: "node",
        acceleration: "cpu",
        endpoints: ["/healthz", "/readyz", "/v1/sessions"],
      });
    }
    const result = await runtime.handle({
      method: request.method ?? "GET",
      path,
      authorization: request.headers.authorization,
      body: ["POST", "PUT", "PATCH"].includes(request.method ?? "")
        ? await readJson(request)
        : undefined,
    });
    return json(response, result.status, result.body);
  } catch (error) {
    return json(response, 400, {
      error: error instanceof Error ? error.message : "Invalid request",
    });
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "8080");
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 8080;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(bytes);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
