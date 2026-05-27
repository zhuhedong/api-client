/**
 * Sandbox Web Worker that evaluates user-supplied pre-request / test scripts.
 *
 * Why a Worker:
 *  - Isolates user code from the main thread (no DOM, no Tauri APIs, no
 *    window). The user can still spin forever; the main thread terminates
 *    the worker after the timeout in `scriptRunner.ts`.
 *  - Postman-flavoured `pm.*` API surface so existing Postman tests/scripts
 *    can be copy-pasted with minimal edits.
 *
 * pm.* surface implemented:
 *  - pm.request, pm.response
 *  - pm.environment, pm.globals, pm.collectionVariables, pm.variables
 *    (CRUD: get/set/unset/has/toObject)
 *  - pm.iterationData (read-only: get/has/toObject)
 *  - pm.sendRequest(req, cb?) → returns a Promise + invokes the optional
 *    Postman-style `(err, res)` callback. Honoured both as
 *    `pm.sendRequest("https://…", cb)` and as
 *    `pm.sendRequest({url, method, header, body}, cb)`. Awaitable.
 *  - pm.expect(actual).to.{equal,eql,include,match,have.status,have.property,
 *    have.lengthOf, be.{ok,true,false,null,undefined,a,an,empty},
 *    above,below,greaterThan,lessThan,deep.equal}
 *  - pm.test(name, fn) — collects pass/fail into `out.tests`.
 *
 * Limitations (intentional, documented for users):
 *  - No `fetch`/`XMLHttpRequest` exposed via `pm`; use `pm.sendRequest` so
 *    requests go through the same backend (auth, cookies, history, redirect
 *    policy) as a regular Send.
 *  - No filesystem / Tauri access.
 *  - `setTimeout` exists in the Worker but the runner's deadline will kill
 *    the worker anyway.
 *
 * Protocol — tagged messages in both directions:
 *  IN  init:               { type: "init",              kind, source, context }
 *  OUT sendRequest:        { type: "sendRequest",       id, payload }
 *  IN  sendRequestResult:  { type: "sendRequestResult", id, response?, error? }
 *  OUT done:               { type: "done", ok, error?, environment, globals,
 *                           collectionVariables, variables, tests, logs }
 */

interface WorkerInitMessage {
  type: "init";
  kind: "pre" | "test";
  source: string;
  context: {
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    response?: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      bodyEncoding: "text" | "base64";
      timeMs: number;
      sizeBytes: number;
    };
    environment: Record<string, string>;
    globals: Record<string, string>;
    collectionVariables: Record<string, string>;
    variables: Record<string, string>;
    iterationData: Record<string, string>;
  };
}

interface SendRequestResultMessage {
  type: "sendRequestResult";
  id: number;
  /** Backend response on success. The shape mirrors `ResponseData` on the
   *  Rust side so user scripts can read it with the same field names they
   *  see on `pm.response`. */
  response?: {
    status: number;
    status_text: string;
    headers: Record<string, string>;
    body: string;
    body_encoding: "text" | "base64";
    body_truncated?: boolean;
    time_ms: number;
    size_bytes: number;
  };
  error?: string;
}

type WorkerInMessage = WorkerInitMessage | SendRequestResultMessage;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface ScriptLog {
  level: "log" | "warn" | "error";
  args: string[];
}

interface WorkerDoneMessage {
  type: "done";
  ok: boolean;
  error?: string;
  environment: Record<string, string>;
  globals: Record<string, string>;
  collectionVariables: Record<string, string>;
  variables: Record<string, string>;
  tests: TestResult[];
  logs: ScriptLog[];
}

/** Outbound request the worker would like the main thread to perform. The
 *  shape mirrors Postman's `pm.sendRequest` argument so existing scripts
 *  port over directly. Either a bare URL string or an object. */
interface SendRequestPayload {
  url: string;
  method?: string;
  /** Postman-style `header: { "X-Foo": "bar" }` or `header: [{key, value}]`.
   *  We normalize to a flat array of {key, value} on the way out. */
  headers?: { key: string; value: string }[];
  /** Body. Plain string for JSON / text; `null` for none. */
  body?: string | null;
}

interface SendRequestMessage {
  type: "sendRequest";
  id: number;
  payload: SendRequestPayload;
}

// ---- Sandbox `pm` API factory ------------------------------------------------
//
// The actual chain / scope wrappers live in `./scriptApi` (pure module, no
// Worker globals) so unit tests can import and exercise them in Node.
// `scriptWorker.ts` itself can't be loaded in a non-Worker environment
// because of the `self.onmessage` assignment at the bottom.

import {
  makeExpect,
  readonlyScopeApi,
  scopeApi,
} from "./scriptApi";

interface ScopeMap {
  env: Record<string, string>;
  globals: Record<string, string>;
  collectionVariables: Record<string, string>;
  vars: Record<string, string>;
}


/** Map of in-flight `pm.sendRequest` calls to the resolvers their Promises
 *  are waiting on. Keyed by the integer id we sent to the main thread. */
const pending: Map<
  number,
  (msg: SendRequestResultMessage) => void
> = new Map();
let nextRequestId = 1;

function buildPm(
  msg: WorkerInitMessage,
  out: WorkerDoneMessage,
  scope: ScopeMap,
) {
  const expect = makeExpect();

  /**
   * `pm.sendRequest` — fire a request through the main-thread Tauri
   * backend and resolve with the response. Honoured both as a positional
   * callback (`pm.sendRequest(req, (err, res) => …)`) and as an awaitable
   * Promise (`const res = await pm.sendRequest(req);`). Errors surface in
   * the callback's first arg and as a Promise rejection.
   */
  const sendRequest = (
    reqOrUrl: string | (SendRequestPayload & { header?: Record<string, string> | { key: string; value: string }[] }),
    cb?: (err: Error | null, res?: unknown) => void,
  ): Promise<unknown> => {
    let payload: SendRequestPayload;
    if (typeof reqOrUrl === "string") {
      payload = { url: reqOrUrl };
    } else {
      // Normalize headers. Postman uses `header` (singular); Postman's UI
      // emits either a `{name: value}` object or an array of
      // `{key, value}`. We accept both and ship a canonical array.
      const h = reqOrUrl.headers ?? normalizeHeader(reqOrUrl.header);
      payload = {
        url: reqOrUrl.url,
        method: reqOrUrl.method,
        headers: h,
        body: reqOrUrl.body ?? null,
      };
    }
    const id = nextRequestId++;
    const outbound: SendRequestMessage = { type: "sendRequest", id, payload };
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, (result) => {
        pending.delete(id);
        if (result.error) {
          const err = new Error(result.error);
          if (cb) { cb(err); resolve(undefined); return; }
          reject(err);
          return;
        }
        if (cb) { cb(null, result.response); resolve(result.response); return; }
        resolve(result.response);
      });
      (self as unknown as Worker).postMessage(outbound);
    });
  };

  const pm: Record<string, unknown> = {
    request: msg.context.request,
    environment: scopeApi(scope.env),
    globals: scopeApi(scope.globals),
    collectionVariables: scopeApi(scope.collectionVariables),
    variables: scopeApi(scope.vars),
    iterationData: readonlyScopeApi(
      msg.context.iterationData,
      "pm.iterationData",
    ),
    expect,
    sendRequest,
  };

  if (msg.kind === "test" && msg.context.response) {
    const r = msg.context.response;
    let cachedJson: unknown = undefined;
    let cachedJsonError: Error | null = null;
    pm.response = {
      ...r,
      // `pm.response.json()` parses the body once (matches Postman).
      json: () => {
        if (cachedJson !== undefined) return cachedJson;
        if (cachedJsonError) throw cachedJsonError;
        try {
          cachedJson = JSON.parse(r.body);
          return cachedJson;
        } catch (e) {
          cachedJsonError = e as Error;
          throw e;
        }
      },
      text: () => r.body,
      // `.to.have.status(...)` works on response, too.
      get status() {
        return r.status;
      },
    };
    pm.test = (name: string, fn: () => void | Promise<void>) => {
      try {
        const result = fn();
        // `pm.test` accepts async test bodies in Postman. We keep the
        // signature synchronous-looking but adopt a returned Promise so
        // failures inside async tests still report correctly.
        if (result && typeof (result as Promise<void>).then === "function") {
          // Wait for the promise — the AsyncFunction wrapper around the
          // user script already awaits the final return value, so as
          // long as the user awaits this themselves, errors propagate.
          return (result as Promise<void>).then(
            () => out.tests.push({ name, passed: true }),
            (e: Error) =>
              out.tests.push({
                name,
                passed: false,
                error: e?.message ?? String(e),
              }),
          );
        }
        out.tests.push({ name, passed: true });
      } catch (e) {
        out.tests.push({ name, passed: false, error: (e as Error).message });
      }
    };
  } else {
    // Pre-request scripts get a no-op pm.test so shared snippets don't
    // explode when run pre-flight.
    pm.test = () => {};
  }

  // Snapshot end state so we can ship mutations back.
  pm.__capture = () => {
    out.environment = scope.env;
    out.globals = scope.globals;
    out.collectionVariables = scope.collectionVariables;
    out.variables = scope.vars;
  };

  return pm;
}

function normalizeHeader(
  header: Record<string, string> | { key: string; value: string }[] | undefined,
): { key: string; value: string }[] | undefined {
  if (!header) return undefined;
  if (Array.isArray(header)) return header;
  return Object.entries(header).map(([key, value]) => ({ key, value }));
}

// ---- Console capture ---------------------------------------------------------

function buildConsole(out: WorkerDoneMessage) {
  const stringify = (v: unknown) => {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const make = (level: "log" | "warn" | "error") =>
    (...args: unknown[]) => {
      out.logs.push({ level, args: args.map(stringify) });
    };
  return { log: make("log"), warn: make("warn"), error: make("error") };
}

// ---- Worker entrypoint -------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  // Dispatch sendRequest results back to the awaiting promise. Multiple
  // calls can be in flight; the id discriminates.
  if (msg.type === "sendRequestResult") {
    const resolver = pending.get(msg.id);
    if (resolver) resolver(msg);
    return;
  }

  // Otherwise this is the initial "run the script" message.
  const out: WorkerDoneMessage = {
    type: "done",
    ok: false,
    environment: { ...msg.context.environment },
    globals: { ...msg.context.globals },
    collectionVariables: { ...msg.context.collectionVariables },
    variables: { ...msg.context.variables },
    tests: [],
    logs: [],
  };

  try {
    const scope: ScopeMap = {
      env: { ...msg.context.environment },
      globals: { ...msg.context.globals },
      collectionVariables: { ...msg.context.collectionVariables },
      vars: { ...msg.context.variables },
    };
    const pm = buildPm(msg, out, scope);
    const sandboxedConsole = buildConsole(out);
    // Use AsyncFunction so user scripts can `await` async tasks (e.g.
    // pm.sendRequest, fetch, timers). The runner will terminate this
    // Worker if the returned promise outlives the deadline.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("pm", "console", msg.source);
    Promise.resolve(fn(pm, sandboxedConsole))
      .then(() => {
        (pm.__capture as () => void)();
        out.ok = true;
        (self as unknown as Worker).postMessage(out);
      })
      .catch((err: Error) => {
        (pm.__capture as () => void)();
        out.error = err.message || String(err);
        (self as unknown as Worker).postMessage(out);
      });
  } catch (e) {
    out.error = (e as Error).message || String(e);
    (self as unknown as Worker).postMessage(out);
  }
};
