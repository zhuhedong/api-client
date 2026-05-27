import { invoke } from "@tauri-apps/api/core";
import type { ResponseData, ScriptLog, ScriptRunOutcome, TestResult } from "../types";

/** What the caller hands the runner. */
export interface ScriptRunInput {
  kind: "pre" | "test";
  source: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: ResponseData;
  /** Active environment scope. */
  environment: Record<string, string>;
  /** Workspace-global scope. Postman's `pm.globals`. */
  globals: Record<string, string>;
  /** Collection-scoped vars (request's owning collection).
   *  Postman's `pm.collectionVariables`. */
  collectionVariables: Record<string, string>;
  /** Transient (per-execution) overrides used by `pm.variables`. */
  variables: Record<string, string>;
  /** Iteration data row (CSV-driven runs). Read-only inside scripts. */
  iterationData?: Record<string, string>;
  /** Wall-clock deadline in ms. Default 5000. */
  timeoutMs?: number;
}

/** What the runner returns. */
export interface ScriptRunResult extends ScriptRunOutcome {
  /** Final state of the env scope after mutations. */
  environment: Record<string, string>;
  /** Final state of the workspace-global scope after mutations. */
  globals: Record<string, string>;
  /** Final state of the collection scope after mutations. */
  collectionVariables: Record<string, string>;
  /** Final state of the variable scope after mutations. */
  variables: Record<string, string>;
}

interface SendRequestPayloadFromWorker {
  url: string;
  method?: string;
  headers?: { key: string; value: string }[];
  body?: string | null;
}

interface SendRequestMessage {
  type: "sendRequest";
  id: number;
  payload: SendRequestPayloadFromWorker;
}

interface DoneMessage {
  type: "done";
  ok: boolean;
  error?: string;
  tests: TestResult[];
  logs: ScriptLog[];
  environment: Record<string, string>;
  globals: Record<string, string>;
  collectionVariables: Record<string, string>;
  variables: Record<string, string>;
}

type WorkerOutMessage = SendRequestMessage | DoneMessage;

/**
 * Run a user script in a sandboxed Web Worker. The Worker is terminated
 * after `timeoutMs` so a malicious / buggy `while(true)` can't wedge the
 * UI thread.
 *
 * Trims down to a no-op result when `source` is empty so callers can
 * blindly invoke this without branching on "is there a script?".
 *
 * The runner also brokers `pm.sendRequest` calls coming back from the
 * worker — the worker can't call Tauri directly, so it posts `sendRequest`
 * messages here, we forward them to the backend, and post the result back
 * over the same channel.
 */
export async function runScript(input: ScriptRunInput): Promise<ScriptRunResult> {
  const trimmed = input.source.trim();
  if (!trimmed) {
    return {
      ok: true,
      tests: [],
      logs: [],
      environment: { ...input.environment },
      globals: { ...input.globals },
      collectionVariables: { ...input.collectionVariables },
      variables: { ...input.variables },
    };
  }

  const timeout = input.timeoutMs ?? 5000;
  // Built via Vite's worker import. The `?worker&inline` query yields a
  // constructor that ships the worker source inline in the main bundle —
  // simpler than a separate chunked file when the worker is small.
  const WorkerCtor = (await import("./scriptWorker.ts?worker&inline")).default;
  const worker = new WorkerCtor();

  return new Promise<ScriptRunResult>((resolve) => {
    let settled = false;
    const finish = (result: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      worker.terminate();
      resolve(result);
    };

    const killTimer = setTimeout(() => {
      finish({
        ok: false,
        error: `Script exceeded ${timeout}ms and was terminated.`,
        tests: [],
        logs: [],
        environment: { ...input.environment },
        globals: { ...input.globals },
        collectionVariables: { ...input.collectionVariables },
        variables: { ...input.variables },
      });
    }, timeout);

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const m = e.data;

      // The worker is asking us to fire an HTTP request via the Tauri
      // backend. We invoke `send_request` with a normalized payload and
      // post the result back over the same channel — the worker is
      // already waiting on a Promise correlated by id.
      if (m.type === "sendRequest") {
        handleSendRequest(worker, m).catch((err: unknown) => {
          worker.postMessage({
            type: "sendRequestResult",
            id: m.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return;
      }

      finish({
        ok: m.ok,
        error: m.error,
        tests: m.tests,
        logs: m.logs,
        environment: m.environment,
        globals: m.globals,
        collectionVariables: m.collectionVariables,
        variables: m.variables,
      });
    };

    worker.onerror = (e: ErrorEvent) => {
      finish({
        ok: false,
        error: e.message || "Worker crashed",
        tests: [],
        logs: [],
        environment: { ...input.environment },
        globals: { ...input.globals },
        collectionVariables: { ...input.collectionVariables },
        variables: { ...input.variables },
      });
    };

    worker.postMessage({
      type: "init",
      kind: input.kind,
      source: input.source,
      context: {
        request: input.request,
        response: input.response
          ? {
              status: input.response.status,
              statusText: input.response.status_text,
              headers: input.response.headers,
              body: input.response.body,
              bodyEncoding: input.response.body_encoding,
              timeMs: input.response.time_ms,
              sizeBytes: input.response.size_bytes,
            }
          : undefined,
        environment: input.environment,
        globals: input.globals,
        collectionVariables: input.collectionVariables,
        variables: input.variables,
        iterationData: input.iterationData ?? {},
      },
    });
  });
}

/**
 * Forward a `pm.sendRequest` message from the worker to the Tauri backend.
 * The user's script is awaiting on this result, so the deadline still
 * applies — if the request takes too long, the script timeout will kill
 * the worker anyway. We send unauthenticated, no per-request defaults: the
 * intent is "give me a low-level HTTP call from inside a script", not "run
 * the full request pipeline".
 */
async function handleSendRequest(
  worker: Worker,
  msg: SendRequestMessage,
): Promise<void> {
  const { id, payload } = msg;
  const headers = (payload.headers ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    enabled: true,
    is_file: false,
  }));
  const reqPayload = {
    method: (payload.method ?? "GET").toUpperCase(),
    url: payload.url,
    headers,
    body: payload.body ?? null,
    body_type: payload.body ? "raw" : null,
    form_data: null,
    timeout_ms: null,
    request_id: `pm-${id}-${Date.now()}`,
    verify_tls: null,
    redirect_policy: null,
    max_redirects: null,
    proxy_url: null,
    client_cert: null,
  };
  const response = await invoke<ResponseData>("send_request", {
    payload: reqPayload,
  });
  worker.postMessage({
    type: "sendRequestResult",
    id,
    response,
  });
}
