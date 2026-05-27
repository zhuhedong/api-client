import { useState, useRef, useEffect, useMemo } from "react";
import { Send, XCircle, Copy, FileDown, Check, Code2, Timer, Cable, Radio, ShieldCheck, ShieldAlert, Globe, Lock, ArrowRightCircle, Tag, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { CodegenModal } from "./CodegenModal";
import { AuthEditor } from "./AuthEditor";
import { VariablePreview } from "./VariablePreview";
import { CodeEditor } from "./CodeEditor";
import type { CodeLanguage } from "./CodeEditor";
import { exportCurl, parseCurl } from "../utils/curl";
import { describeInherited } from "../utils/auth";
import { tagColor } from "../utils/tagColor";
import { buildScopedVars } from "../utils/variableScope";
import type { HttpMethod } from "../types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function bodyTypeToLanguage(bodyType: string): CodeLanguage {
  switch (bodyType) {
    case "json":
      return "json";
    case "xml":
      return "xml";
    case "html":
      return "html";
    case "javascript":
      return "javascript";
    default:
      return "plain";
  }
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-success",
  POST: "text-orange",
  PUT: "text-accent",
  PATCH: "text-purple",
  DELETE: "text-error",
  HEAD: "text-text-secondary",
  OPTIONS: "text-text-secondary",
};

type RequestTab = "params" | "headers" | "body" | "auth" | "pre" | "tests" | "settings";

export function RequestPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RequestTab>("params");
  const {
    activeRequest,
    loading,
    setMethod,
    setUrl,
    setHeaders,
    setParams,
    setBody,
    setBodyType,
    setFormData,
    setAuth,
    setName,
    setTimeoutMs,
    setVerifyTls,
    setRedirectPolicy,
    setMaxRedirects,
    setProxyUrl,
    setClientCert,
    setProtocol,
    setGraphqlQuery,
    setGraphqlVariables,
    setPreScript,
    setTestScript,
    setTags,
    sendRequest,
    cancelRequest,
    defaultTimeoutMs,
    verifyTlsDefault,
  } = useRequestStore();

  const urlRef = useRef<HTMLInputElement>(null);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [curlCopied, setCurlCopied] = useState(false);
  const [showCodegen, setShowCodegen] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const existing = activeRequest?.tags ?? [];
    if (existing.includes(t)) return;
    setTags([...existing, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => {
    const existing = activeRequest?.tags ?? [];
    setTags(existing.filter((x) => x !== t));
  };

  useEffect(() => {
    urlRef.current?.focus();
  }, [activeRequest?.id]);

  const collections = useRequestStore((s) => s.collections);
  const environments = useRequestStore((s) => s.environments);
  const workspace = useRequestStore((s) => s.workspace);

  /** Variable lookup table used by the preview tooltip. Mirrors what
   *  `requestPipeline` builds at send time so the preview matches what
   *  the user will actually send (modulo transient script overrides which
   *  aren't known until pre-scripts run). */
  const scopedVars = useMemo(
    () =>
      activeRequest
        ? buildScopedVars({
            workspace,
            collections,
            environments,
            request: activeRequest,
          })
        : {},
    [workspace, collections, environments, activeRequest],
  );

  if (!activeRequest) return null;
  const isWs = activeRequest.protocol === "websocket";
  const isSse = activeRequest.protocol === "sse";
  // SSE and WebSocket are both header-only request protocols: no body, no auth
  // editor (use a header), and pre/post scripts don't fit the long-lived
  // stream model. Keep Params + Headers + Settings so users can still inject
  // env vars, query string, and per-stream TLS/timeout.
  const isStreaming = isWs || isSse;

  const tabs: { id: RequestTab; label: string }[] = [
    { id: "params", label: t("request.params") },
    { id: "headers", label: t("request.headers") },
    ...(isStreaming
      ? []
      : ([
          { id: "body" as const, label: t("request.body") },
          { id: "auth" as const, label: t("request.auth") },
          { id: "pre" as const, label: t("request.pre_request") },
          { id: "tests" as const, label: t("request.tests") },
        ])),
    { id: "settings", label: t("request.settings") },
  ];

  const paramCount = activeRequest.params.filter((p) => p.key).length;
  const headerCount = activeRequest.headers.filter((h) => h.key).length;
  const currentAuth = activeRequest.auth || { auth_type: "none" as const };
  const inheritedDescription = describeInherited(activeRequest, collections);

  return (
    <div className="flex flex-col h-full">
      {/* Request Name + action buttons */}
      <div className="px-4 pt-3 pb-0 flex items-center gap-2">
        <input
          type="text"
          value={activeRequest.name}
          onChange={(e) => setName(e.target.value)}
          className="text-[13px] text-text-secondary bg-transparent border-0 outline-none flex-1 px-0 py-0.5 placeholder-text-tertiary focus:text-text-primary transition-colors"
          placeholder={t("request.name_placeholder")}
        />
        <div className="segmented-control">
          <button
            onClick={() => setProtocol("http")}
            className={`segment !text-[11px] ${!isWs && !isSse ? "segment-active" : ""}`}
            title="HTTP"
          >
            HTTP
          </button>
          <button
            onClick={() => setProtocol("websocket")}
            className={`segment !text-[11px] ${isWs ? "segment-active" : ""}`}
            title="WebSocket"
          >
            <Cable size={11} className="inline -mt-0.5 mr-0.5" />
            WS
          </button>
          <button
            onClick={() => setProtocol("sse")}
            className={`segment !text-[11px] ${isSse ? "segment-active" : ""}`}
            title="Server-Sent Events"
          >
            <Radio size={11} className="inline -mt-0.5 mr-0.5" />
            SSE
          </button>
        </div>
        <button
          onClick={() => {
            // `scopedVars` already flattens global / collection / folder /
            // env layers (same layers `requestPipeline` uses at send time),
            // so the copied curl matches what would actually fly across
            // the wire when the user hits Send.
            const curl = exportCurl(activeRequest, scopedVars);
            navigator.clipboard.writeText(curl);
            setCurlCopied(true);
            setTimeout(() => setCurlCopied(false), 2000);
          }}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors shrink-0"
          title="Copy as cURL"
        >
          {curlCopied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          cURL
        </button>
        <button
          onClick={() => setShowCurlImport(true)}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors shrink-0"
          title="Import from cURL"
        >
          <FileDown size={12} />
          Import
        </button>
        <button
          onClick={() => setShowCodegen(true)}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors shrink-0"
          title="Generate code"
        >
          <Code2 size={12} />
          Code
        </button>
      </div>

      {/* cURL Import Modal */}
      {showCurlImport && (
        <div className="px-4 pt-2 pb-1">
          <div className="bg-surface-secondary rounded-apple p-3 space-y-2">
            <textarea
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={'Paste cURL command here...\ncurl -X POST https://api.example.com -H "Content-Type: application/json" -d \'{"key":"value"}\'  '}
              className="input-apple w-full h-20 font-mono text-[11px] resize-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setShowCurlImport(false); setCurlInput(""); }}
                className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (curlInput.trim()) {
                    const parsed = parseCurl(curlInput);
                    useRequestStore.getState().updateActiveRequest(parsed);
                  }
                  setShowCurlImport(false);
                  setCurlInput("");
                }}
                className="text-[11px] text-accent font-medium px-3 py-1 bg-accent/10 rounded-md hover:bg-accent/20 transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        {!isStreaming && (
          <select
            value={activeRequest.method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
            className={`input-apple font-semibold w-[100px] ${METHOD_COLORS[activeRequest.method]}`}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        {isWs && (
          <div className="input-apple font-semibold w-[100px] text-accent text-center">WS</div>
        )}
        {isSse && (
          <div className="input-apple font-semibold w-[100px] text-accent text-center">SSE</div>
        )}

        <input
          ref={urlRef}
          type="text"
          value={activeRequest.url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isStreaming) sendRequest();
          }}
          placeholder={
            isWs
              ? t("request.ws_url_placeholder")
              : isSse
                ? t("request.sse_url_placeholder")
                : t("request.url_placeholder")
          }
          className="input-apple flex-1"
        />

        <VariablePreview value={activeRequest.url} vars={scopedVars} />

        {!isStreaming && (
          loading ? (
            <button
              onClick={cancelRequest}
              className="px-4 py-2 bg-error text-white font-medium rounded-apple text-[13px] hover:bg-error/90 active:scale-[0.97] transition-all shadow-apple-sm flex items-center gap-1.5"
            >
              <XCircle size={14} />
              {t("request.cancel")}
            </button>
          ) : (
            <button
              onClick={sendRequest}
              disabled={!activeRequest.url}
              className="btn-send flex items-center gap-1.5"
            >
              <Send size={14} />
              {t("request.send")}
            </button>
          )
        )}
      </div>

      {/* Segmented Tabs */}
      <div className="px-4 pb-3">
        <div className="segmented-control">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`segment ${activeTab === tab.id ? "segment-active" : ""}`}
            >
              {tab.label}
              {tab.id === "params" && paramCount > 0 && (
                <span className="ml-1 text-[10px] text-accent">{paramCount}</span>
              )}
              {tab.id === "headers" && headerCount > 0 && (
                <span className="ml-1 text-[10px] text-accent">{headerCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "params" && (
          <KeyValueEditor
            items={activeRequest.params}
            onChange={setParams}
            keyPlaceholder="Parameter"
            valuePlaceholder="Value"
            previewVars={scopedVars}
          />
        )}

        {activeTab === "headers" && (
          <KeyValueEditor
            items={activeRequest.headers}
            onChange={setHeaders}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
            previewVars={scopedVars}
          />
        )}

        {activeTab === "body" && !isStreaming && (
          <div className="space-y-3">
            <div className="segmented-control flex-wrap">
              {(["none", "json", "text", "xml", "form-data", "graphql"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setBodyType(type)}
                  className={`segment ${activeRequest.bodyType === type ? "segment-active" : ""}`}
                >
                  {type === "form-data" ? "Form" : type === "graphql" ? "GraphQL" : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            {activeRequest.bodyType === "form-data" && (
              <KeyValueEditor
                items={activeRequest.formData}
                onChange={setFormData}
                keyPlaceholder="Field name"
                valuePlaceholder="Value"
                allowFiles
                previewVars={scopedVars}
              />
            )}
            {activeRequest.bodyType === "graphql" && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Query</label>
                <CodeEditor
                  value={activeRequest.graphqlQuery || ""}
                  onChange={setGraphqlQuery}
                  language="graphql"
                  height={160}
                  placeholder={"query Example {\n  field\n}"}
                />
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Variables (JSON)</label>
                <CodeEditor
                  value={activeRequest.graphqlVariables || ""}
                  onChange={setGraphqlVariables}
                  language="json"
                  height={120}
                  placeholder={'{\n  "id": 1\n}'}
                />
              </div>
            )}
            {activeRequest.bodyType !== "none" &&
              activeRequest.bodyType !== "form-data" &&
              activeRequest.bodyType !== "graphql" && (
                <CodeEditor
                  value={activeRequest.body}
                  onChange={setBody}
                  language={bodyTypeToLanguage(activeRequest.bodyType)}
                  height={220}
                  placeholder={
                    activeRequest.bodyType === "json"
                      ? '{\n  "key": "value"\n}'
                      : "Enter request body..."
                  }
                />
              )}
          </div>
        )}

        {activeTab === "auth" && !isStreaming && (
          <div className="space-y-3">
            <AuthEditor
              value={currentAuth}
              onChange={setAuth}
              allowInherit={!!activeRequest.collectionId}
              inheritedFrom={inheritedDescription}
            />
          </div>
        )}

        {activeTab === "pre" && !isStreaming && (
          <div className="space-y-2">
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Runs before the request is sent. Mutate variables with{" "}
              <code className="text-text-secondary">pm.environment.set(k, v)</code> /{" "}
              <code className="text-text-secondary">pm.variables.set(k, v)</code>. Script is
              terminated after 5s.
            </p>
            <CodeEditor
              value={activeRequest.preScript ?? ""}
              onChange={setPreScript}
              language="javascript"
              height={300}
              placeholder={
                "// Example: stamp every request with a fresh token\n" +
                "pm.environment.set('ts', String(Date.now()));\n" +
                "pm.variables.set('nonce', Math.random().toString(36).slice(2));"
              }
            />
          </div>
        )}

        {activeTab === "tests" && !isStreaming && (
          <div className="space-y-2">
            <p className="text-[11px] text-text-tertiary leading-relaxed">
              Runs after the response arrives. Use{" "}
              <code className="text-text-secondary">pm.test('name', fn)</code> with{" "}
              <code className="text-text-secondary">pm.expect(...)</code>. Results show in the
              response panel.
            </p>
            <CodeEditor
              value={activeRequest.testScript ?? ""}
              onChange={setTestScript}
              language="javascript"
              height={300}
              placeholder={
                "// Example assertions\n" +
                "pm.test('responds with 200', () => {\n" +
                "  pm.expect(pm.response).to.have.status(200);\n" +
                "});\n" +
                "pm.test('body has id', () => {\n" +
                "  const json = pm.response.json();\n" +
                "  pm.expect(json).to.have.property('id');\n" +
                "});"
              }
            />
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-3">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <Timer size={11} />
                Timeout (ms)
              </label>
              <input
                type="number"
                value={activeRequest.timeoutMs ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") setTimeoutMs(undefined);
                  else {
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n > 0) setTimeoutMs(n);
                  }
                }}
                placeholder={`Default: ${defaultTimeoutMs} ms`}
                className="input-apple w-48 text-[12px]"
                min={1}
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                Leave empty to use the global default.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <Tag size={11} />
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(activeRequest.tags ?? []).map((t) => {
                  const c = tagColor(t);
                  return (
                    <span
                      key={t}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="hover:opacity-70"
                        title={`Remove tag "${t}"`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
                {(activeRequest.tags ?? []).length === 0 && (
                  <span className="text-[11px] text-text-tertiary">No tags</span>
                )}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  } else if (e.key === "Backspace" && !tagInput) {
                    const tags = activeRequest.tags ?? [];
                    if (tags.length > 0) removeTag(tags[tags.length - 1]);
                  }
                }}
                placeholder="Add tag and press Enter (e.g. auth, v2, broken)"
                className="input-apple w-full text-[12px]"
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                Tags help you filter and color-code requests in the sidebar. Persisted with the
                collection on save.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <ShieldCheck size={11} />
                TLS verification
              </label>
              <select
                value={
                  activeRequest.verifyTls === undefined
                    ? "default"
                    : activeRequest.verifyTls
                    ? "on"
                    : "off"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "default") setVerifyTls(undefined);
                  else setVerifyTls(v === "on");
                }}
                className="input-apple w-48 text-[12px]"
              >
                <option value="default">
                  Use default ({verifyTlsDefault ? "verify" : "skip"})
                </option>
                <option value="on">Verify certificates</option>
                <option value="off">Skip verification (insecure)</option>
              </select>
              {activeRequest.verifyTls === false && (
                <p className="text-[11px] text-warning mt-1 flex items-center gap-1">
                  <ShieldAlert size={11} />
                  This request skips TLS verification.
                </p>
              )}
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <ArrowRightCircle size={11} />
                Redirects
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={activeRequest.redirectPolicy ?? "follow"}
                  onChange={(e) =>
                    setRedirectPolicy(e.target.value as "follow" | "none" | "manual")
                  }
                  className="input-apple w-40 text-[12px]"
                >
                  <option value="follow">Follow (default)</option>
                  <option value="none">Do not follow</option>
                </select>
                {(activeRequest.redirectPolicy ?? "follow") === "follow" && (
                  <>
                    <span className="text-[11px] text-text-tertiary">max</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={activeRequest.maxRedirects ?? ""}
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        if (v === "") setMaxRedirects(undefined);
                        else {
                          const n = parseInt(v, 10);
                          if (Number.isFinite(n) && n >= 0) setMaxRedirects(n);
                        }
                      }}
                      placeholder="10"
                      className="input-apple w-20 text-[12px]"
                    />
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <Globe size={11} />
                Proxy
              </label>
              <input
                type="text"
                value={activeRequest.proxyUrl ?? ""}
                onChange={(e) => setProxyUrl(e.target.value || undefined)}
                placeholder="http://user:pass@host:8080  or  socks5://host:1080"
                className="input-apple w-full text-[12px] font-mono"
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                Routes this request through the given proxy. Supports HTTP, HTTPS, and SOCKS5.
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                <Lock size={11} />
                Client certificate (mTLS)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={activeRequest.clientCert?.path ?? ""}
                  onChange={(e) => {
                    const path = e.target.value;
                    if (!path) setClientCert(undefined);
                    else
                      setClientCert({
                        path,
                        password: activeRequest.clientCert?.password,
                      });
                  }}
                  placeholder="Path to .p12 / .pfx bundle"
                  className="input-apple flex-1 text-[12px] font-mono"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await openFileDialog({
                      multiple: false,
                      filters: [
                        { name: "PKCS#12 bundle", extensions: ["p12", "pfx"] },
                      ],
                    });
                    if (typeof picked === "string")
                      setClientCert({
                        path: picked,
                        password: activeRequest.clientCert?.password,
                      });
                  }}
                  className="text-[11px] px-2 py-1 rounded-md bg-surface-secondary hover:bg-surface-tertiary text-text-secondary"
                >
                  Browse…
                </button>
                {activeRequest.clientCert?.path && (
                  <button
                    type="button"
                    onClick={() => setClientCert(undefined)}
                    className="text-[11px] px-2 py-1 rounded-md hover:bg-error/10 text-error"
                  >
                    Clear
                  </button>
                )}
              </div>
              {activeRequest.clientCert?.path && (
                <input
                  type="password"
                  value={activeRequest.clientCert?.password ?? ""}
                  onChange={(e) =>
                    setClientCert({
                      path: activeRequest.clientCert!.path,
                      password: e.target.value || undefined,
                    })
                  }
                  placeholder="Bundle passphrase (optional)"
                  className="input-apple w-full mt-2 text-[12px] font-mono"
                />
              )}
              <p className="text-[11px] text-text-tertiary mt-1">
                PKCS#12 bundle containing both the client cert and its private key.
              </p>
            </div>
          </div>
        )}
      </div>

      {showCodegen && activeRequest && (
        <CodegenModal request={activeRequest} onClose={() => setShowCodegen(false)} />
      )}
    </div>
  );
}
