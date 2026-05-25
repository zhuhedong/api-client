import { useState, useRef, useEffect } from "react";
import { Send, XCircle, Copy, FileDown, Check, Code2, Timer, Cable, ShieldCheck, ShieldAlert, Globe, Lock, ArrowRightCircle } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { CodegenModal } from "./CodegenModal";
import { exportCurl, parseCurl } from "../utils/curl";
import type { HttpMethod } from "../types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-success",
  POST: "text-orange",
  PUT: "text-accent",
  PATCH: "text-purple",
  DELETE: "text-error",
  HEAD: "text-text-secondary",
  OPTIONS: "text-text-secondary",
};

type RequestTab = "params" | "headers" | "body" | "auth" | "settings";

export function RequestPanel() {
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

  useEffect(() => {
    urlRef.current?.focus();
  }, [activeRequest?.id]);

  if (!activeRequest) return null;
  const isWs = activeRequest.protocol === "websocket";

  const tabs: { id: RequestTab; label: string }[] = [
    { id: "params", label: "Params" },
    { id: "headers", label: "Headers" },
    ...(isWs ? [] : ([{ id: "body" as const, label: "Body" }, { id: "auth" as const, label: "Auth" }])),
    { id: "settings", label: "Settings" },
  ];

  const paramCount = activeRequest.params.filter((p) => p.key).length;
  const headerCount = activeRequest.headers.filter((h) => h.key).length;
  const currentAuth = activeRequest.auth || { auth_type: "none" as const };

  return (
    <div className="flex flex-col h-full">
      {/* Request Name + action buttons */}
      <div className="px-4 pt-3 pb-0 flex items-center gap-2">
        <input
          type="text"
          value={activeRequest.name}
          onChange={(e) => setName(e.target.value)}
          className="text-[13px] text-text-secondary bg-transparent border-0 outline-none flex-1 px-0 py-0.5 placeholder-text-tertiary focus:text-text-primary transition-colors"
          placeholder="Request name..."
        />
        <div className="segmented-control">
          <button
            onClick={() => setProtocol("http")}
            className={`segment !text-[11px] ${!isWs ? "segment-active" : ""}`}
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
        </div>
        <button
          onClick={() => {
            const curl = exportCurl(activeRequest);
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
        {!isWs && (
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

        <input
          ref={urlRef}
          type="text"
          value={activeRequest.url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isWs) sendRequest();
          }}
          placeholder={
            isWs ? "wss://echo.websocket.events" : "https://api.example.com/endpoint"
          }
          className="input-apple flex-1"
        />

        {!isWs && (
          loading ? (
            <button
              onClick={cancelRequest}
              className="px-4 py-2 bg-error text-white font-medium rounded-apple text-[13px] hover:bg-error/90 active:scale-[0.97] transition-all shadow-apple-sm flex items-center gap-1.5"
            >
              <XCircle size={14} />
              Cancel
            </button>
          ) : (
            <button
              onClick={sendRequest}
              disabled={!activeRequest.url}
              className="btn-send flex items-center gap-1.5"
            >
              <Send size={14} />
              Send
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
          />
        )}

        {activeTab === "headers" && (
          <KeyValueEditor
            items={activeRequest.headers}
            onChange={setHeaders}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
          />
        )}

        {activeTab === "body" && !isWs && (
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
              />
            )}
            {activeRequest.bodyType === "graphql" && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Query</label>
                <textarea
                  value={activeRequest.graphqlQuery || ""}
                  onChange={(e) => setGraphqlQuery(e.target.value)}
                  placeholder={"query Example {\n  field\n}"}
                  className="input-apple w-full h-32 font-mono text-[12px] resize-none leading-relaxed"
                  spellCheck={false}
                />
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Variables (JSON)</label>
                <textarea
                  value={activeRequest.graphqlVariables || ""}
                  onChange={(e) => setGraphqlVariables(e.target.value)}
                  placeholder={'{\n  "id": 1\n}'}
                  className="input-apple w-full h-24 font-mono text-[12px] resize-none leading-relaxed"
                  spellCheck={false}
                />
              </div>
            )}
            {activeRequest.bodyType !== "none" &&
              activeRequest.bodyType !== "form-data" &&
              activeRequest.bodyType !== "graphql" && (
                <textarea
                  value={activeRequest.body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    activeRequest.bodyType === "json"
                      ? '{\n  "key": "value"\n}'
                      : "Enter request body..."
                  }
                  className="input-apple w-full h-40 font-mono text-[12px] resize-none leading-relaxed"
                  spellCheck={false}
                />
              )}
          </div>
        )}

        {activeTab === "auth" && !isWs && (
          <div className="space-y-3">
            <div className="segmented-control">
              {(["none", "bearer", "basic", "api_key"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAuth({ ...currentAuth, auth_type: type })}
                  className={`segment ${currentAuth.auth_type === type ? "segment-active" : ""}`}
                >
                  {type === "api_key" ? "API Key" : type === "none" ? "None" : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {currentAuth.auth_type === "bearer" && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Token</label>
                <input
                  type="text"
                  value={currentAuth.bearer_token || ""}
                  onChange={(e) => setAuth({ ...currentAuth, bearer_token: e.target.value })}
                  placeholder="Enter bearer token..."
                  className="input-apple w-full font-mono text-[12px]"
                  spellCheck={false}
                />
              </div>
            )}

            {currentAuth.auth_type === "basic" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Username</label>
                  <input
                    type="text"
                    value={currentAuth.basic_username || ""}
                    onChange={(e) => setAuth({ ...currentAuth, basic_username: e.target.value })}
                    placeholder="Username"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Password</label>
                  <input
                    type="password"
                    value={currentAuth.basic_password || ""}
                    onChange={(e) => setAuth({ ...currentAuth, basic_password: e.target.value })}
                    placeholder="Password"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
              </div>
            )}

            {currentAuth.auth_type === "api_key" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Key</label>
                  <input
                    type="text"
                    value={currentAuth.api_key_key || ""}
                    onChange={(e) => setAuth({ ...currentAuth, api_key_key: e.target.value })}
                    placeholder="X-API-Key"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Value</label>
                  <input
                    type="text"
                    value={currentAuth.api_key_value || ""}
                    onChange={(e) => setAuth({ ...currentAuth, api_key_value: e.target.value })}
                    placeholder="your-api-key"
                    className="input-apple w-full font-mono text-[12px] mt-1"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Add to</label>
                  <div className="segmented-control mt-1">
                    <button
                      onClick={() => setAuth({ ...currentAuth, api_key_in: "header" })}
                      className={`segment ${(currentAuth.api_key_in || "header") === "header" ? "segment-active" : ""}`}
                    >
                      Header
                    </button>
                    <button
                      onClick={() => setAuth({ ...currentAuth, api_key_in: "query" })}
                      className={`segment ${currentAuth.api_key_in === "query" ? "segment-active" : ""}`}
                    >
                      Query Param
                    </button>
                  </div>
                </div>
              </div>
            )}

            {currentAuth.auth_type === "none" && (
              <p className="text-[12px] text-text-tertiary">
                This request does not use any authorization.
              </p>
            )}
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
