import { useState, useRef, useEffect, useMemo } from "react";
import { Send, XCircle, Copy, FileDown, Check, Code2, Timer, Cable, Radio, ShieldCheck, ShieldAlert, Globe, Lock, ArrowRightCircle, Tag, Braces, X } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { CodegenModal } from "./CodegenModal";
import { ResolvedVariablesModal } from "./ResolvedVariablesModal";
import { AuthEditor } from "./AuthEditor";
import { VariablePreview } from "./VariablePreview";
import { CodeEditor } from "./CodeEditor";
import type { CodeLanguage } from "./CodeEditor";
import { exportCurl, parseCurl } from "../utils/curl";
import { describeInherited } from "../utils/auth";
import { tagColor } from "../utils/tagColor";
import { buildScopedVars } from "../utils/variableScope";
import { formatBody } from "../utils/formatBody";
import type { HttpMethod, KeyValue, BodyType, ResponseData } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const BODY_TYPES: BodyType[] = [
  "none",
  "json",
  "text",
  "xml",
  "form-data",
  "x-www-form-urlencoded",
  "binary",
  "graphql",
];

const BODY_TYPE_LABEL_KEYS: Record<BodyType, string> = {
  none: "request.body_none",
  json: "request.body_json",
  text: "request.body_text",
  xml: "request.body_xml",
  "form-data": "request.body_form",
  "x-www-form-urlencoded": "request.body_url_encoded",
  binary: "request.body_binary",
  graphql: "request.body_graphql",
};

/** Minimal introspection query — type names plus their field / input-field
 *  names. Enough for flat schema-aware completion without the `graphql` lib. */
const GQL_INTROSPECTION_QUERY =
  "query IntrospectionQuery { __schema { types { name fields { name } inputFields { name } } } }";

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
  PUT: "text-primary",
  PATCH: "text-purple",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

type RequestTab = "params" | "headers" | "body" | "auth" | "pre" | "tests" | "settings" | "docs";

function createParam(key = "", value = ""): KeyValue {
  return { id: Math.random().toString(36).substring(2, 15), key, value, enabled: true };
}

function parseUrlQueryParams(rawUrl: string): { url: string; params: KeyValue[] } | null {
  const hashIndex = rawUrl.indexOf("#");
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex === -1 || (hashIndex !== -1 && queryIndex > hashIndex)) return null;

  const queryEnd = hashIndex === -1 ? rawUrl.length : hashIndex;
  const query = rawUrl.slice(queryIndex + 1, queryEnd);
  if (!query) return null;

  const params = Array.from(new URLSearchParams(query).entries()).map(([key, value]) =>
    createParam(key, value),
  );
  if (params.length === 0) return null;

  return {
    url: `${rawUrl.slice(0, queryIndex)}${hashIndex === -1 ? "" : rawUrl.slice(hashIndex)}`,
    params: [...params, createParam()],
  };
}

export function RequestPanel() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<RequestTab>("params");
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const loading = useRequestStore((s) => s.loading);
  const setMethod = useRequestStore((s) => s.setMethod);
  const setUrl = useRequestStore((s) => s.setUrl);
  const setHeaders = useRequestStore((s) => s.setHeaders);
  const setParams = useRequestStore((s) => s.setParams);
  const setBody = useRequestStore((s) => s.setBody);
  const setBodyType = useRequestStore((s) => s.setBodyType);
  const setFormData = useRequestStore((s) => s.setFormData);
  const setAuth = useRequestStore((s) => s.setAuth);
  const setName = useRequestStore((s) => s.setName);
  const setTimeoutMs = useRequestStore((s) => s.setTimeoutMs);
  const setVerifyTls = useRequestStore((s) => s.setVerifyTls);
  const setRedirectPolicy = useRequestStore((s) => s.setRedirectPolicy);
  const setMaxRedirects = useRequestStore((s) => s.setMaxRedirects);
  const setProxyUrl = useRequestStore((s) => s.setProxyUrl);
  const setClientCert = useRequestStore((s) => s.setClientCert);
  const setProtocol = useRequestStore((s) => s.setProtocol);
  const setGraphqlQuery = useRequestStore((s) => s.setGraphqlQuery);
  const setGraphqlVariables = useRequestStore((s) => s.setGraphqlVariables);
  const setPreScript = useRequestStore((s) => s.setPreScript);
  const setTestScript = useRequestStore((s) => s.setTestScript);
  const setTags = useRequestStore((s) => s.setTags);
  const updateActiveRequest = useRequestStore((s) => s.updateActiveRequest);
  const sendRequest = useRequestStore((s) => s.sendRequest);
  const cancelRequest = useRequestStore((s) => s.cancelRequest);
  const defaultTimeoutMs = useRequestStore((s) => s.defaultTimeoutMs);
  const verifyTlsDefault = useRequestStore((s) => s.verifyTlsDefault);

  const urlRef = useRef<HTMLInputElement>(null);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [curlCopied, setCurlCopied] = useState(false);
  const [showCodegen, setShowCodegen] = useState(false);
  const [showResolvedVars, setShowResolvedVars] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [beautifyError, setBeautifyError] = useState<string | null>(null);
  const [gqlFields, setGqlFields] = useState<string[]>([]);
  const [gqlSchemaState, setGqlSchemaState] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
  // User-resizable height for the JSON / text body editor. Survives tab
  // switches (this panel stays mounted); resets to the default on reload.
  const [bodyEditorHeight, setBodyEditorHeight] = useState(220);

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
  /** Stable list of variable names offered for `{{ }}` autocompletion in the
   *  body / GraphQL editors. */
  const completionKeys = useMemo(() => Object.keys(scopedVars), [scopedVars]);

  if (!activeRequest) return null;
  const isWs = activeRequest.protocol === "websocket";

  const handleBeautify = () => {
    try {
      setBody(formatBody(activeRequest.body, activeRequest.bodyType));
      setBeautifyError(null);
    } catch (e) {
      setBeautifyError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Fetch the GraphQL schema via an introspection POST to the (variable-
   *  substituted) request URL, reusing the request's own headers so an
   *  authenticated endpoint still answers. Computed auth (OAuth2 flows, etc.)
   *  isn't applied here — manual auth headers are. Extracted type/field names
   *  feed the editor's schema-aware completion. */
  const refreshGraphqlSchema = async () => {
    setGqlSchemaState("loading");
    try {
      const sub = (s: string) =>
        s.replace(/\{\{([^}]+)\}\}/g, (_m, k) =>
          scopedVars[String(k).trim()] ?? `{{${k}}}`,
        );
      const headers = activeRequest.headers
        .filter((h) => h.enabled && h.key)
        .map((h) => ({
          key: sub(h.key),
          value: sub(h.value),
          enabled: true,
          is_file: false,
        }));
      if (!headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.push({
          key: "Content-Type",
          value: "application/json",
          enabled: true,
          is_file: false,
        });
      }
      const payload = {
        method: "POST",
        url: sub(activeRequest.url),
        headers,
        body: JSON.stringify({ query: GQL_INTROSPECTION_QUERY }),
        body_type: "json",
        form_data: null,
        timeout_ms: null,
        request_id: `gql-introspect-${activeRequest.id}`,
        verify_tls: activeRequest.verifyTls ?? null,
        redirect_policy: null,
        max_redirects: null,
        proxy_url: null,
        client_cert: null,
      };
      const resp = await invoke<ResponseData>("send_request", { payload });
      const parsed = JSON.parse(resp.body) as {
        data?: {
          __schema?: {
            types?: Array<{
              name?: string;
              fields?: Array<{ name?: string }> | null;
              inputFields?: Array<{ name?: string }> | null;
            }>;
          };
        };
      };
      const names = new Set<string>();
      for (const ty of parsed?.data?.__schema?.types ?? []) {
        if (ty?.name && !ty.name.startsWith("__")) names.add(ty.name);
        for (const f of ty?.fields ?? []) if (f?.name) names.add(f.name);
        for (const f of ty?.inputFields ?? []) if (f?.name) names.add(f.name);
      }
      setGqlFields([...names].sort());
      setGqlSchemaState(names.size > 0 ? "ok" : "error");
    } catch {
      setGqlSchemaState("error");
    }
  };
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
    { id: "docs", label: t("request.docs") },
  ];

  const paramCount = activeRequest.params.filter((p) => p.key).length;
  const headerCount = activeRequest.headers.filter((h) => h.key).length;
  const currentAuth = activeRequest.auth || { auth_type: "none" as const };
  const inheritedDescription = describeInherited(activeRequest, collections);

  const applyUrlQueryParams = (rawUrl: string): boolean => {
    const parsed = parseUrlQueryParams(rawUrl);
    if (parsed) {
      updateActiveRequest({ url: parsed.url, params: parsed.params });
      setActiveTab("params");
      return true;
    }
    return false;
  };

  const handleUrlChange = (rawUrl: string) => setUrl(rawUrl);

  return (
    <div className="flex flex-col h-full">
      {/* Request Name + action buttons */}
      <div className="px-4 pt-3 pb-0 flex items-center gap-2">
        <input
          type="text"
          value={activeRequest.name}
          onChange={(e) => setName(e.target.value)}
          className="text-[13px] text-muted-foreground bg-transparent border-0 outline-none flex-1 px-0 py-0.5 placeholder:text-muted-foreground focus:text-foreground transition-colors"
          placeholder={t("request.name_placeholder")}
        />
        <Tabs
          value={isWs ? "websocket" : isSse ? "sse" : "http"}
          onValueChange={(v) => setProtocol(v as "http" | "websocket" | "sse")}
        >
          <TabsList className="h-7">
            <TabsTrigger value="http" className="!text-[11px]" title={t("request.protocol_http")}>
              HTTP
            </TabsTrigger>
            <TabsTrigger
              value="websocket"
              className="!text-[11px]"
              title={t("request.protocol_websocket")}
            >
              <Cable size={11} className="-mt-0.5 mr-0.5 inline" />
              WS
            </TabsTrigger>
            <TabsTrigger
              value="sse"
              className="!text-[11px]"
              title={t("request.protocol_sse")}
            >
              <Radio size={11} className="-mt-0.5 mr-0.5 inline" />
              SSE
            </TabsTrigger>
          </TabsList>
        </Tabs>
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
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
          title={t("sidebar.copy_as_curl")}
        >
          {curlCopied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          cURL
        </button>
        <button
          onClick={() => setShowCurlImport(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
          title={t("sidebar.import_from_curl")}
        >
          <FileDown size={12} />
          Import
        </button>
        <button
          onClick={() => setShowCodegen(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
          title={t("sidebar.generate_code")}
        >
          <Code2 size={12} />
          Code
        </button>
        <button
          onClick={() => setShowResolvedVars(true)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors shrink-0"
          title={t("resolved_vars.title")}
        >
          <Braces size={12} />
          {t("resolved_vars.button")}
        </button>
      </div>

      {/* cURL Import Modal */}
      {showCurlImport && (
        <div className="px-4 pt-2 pb-1">
          <div className="bg-muted rounded-lg p-3 space-y-2">
            <textarea
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={t("request.curl_import_placeholder")}
              className="input-apple w-full h-20 font-mono text-[11px] resize-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setShowCurlImport(false); setCurlInput(""); }}
                className="text-[11px] text-muted-foreground hover:text-muted-foreground px-2 py-1"
              >
                {t("common.cancel")}
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
                className="text-[11px] text-primary font-medium px-3 py-1 bg-primary/10 rounded-md hover:bg-primary/20 transition-colors"
              >
                {t("sidebar.import")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        {!isStreaming && (
          <Select
            value={activeRequest.method}
            onValueChange={(v) => setMethod(v as HttpMethod)}
          >
            <SelectTrigger
              className={`h-9 w-[110px] font-semibold ${METHOD_COLORS[activeRequest.method]}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem
                  key={m}
                  value={m}
                  className={`font-semibold ${METHOD_COLORS[m]}`}
                >
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {isWs && (
          <div className="input-apple font-semibold w-[100px] text-primary text-center">WS</div>
        )}
        {isSse && (
          <div className="input-apple font-semibold w-[100px] text-primary text-center">SSE</div>
        )}

        <Input
          ref={urlRef}
          type="text"
          value={activeRequest.url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onBlur={(e) => applyUrlQueryParams(e.currentTarget.value)}
          onPaste={() => {
            window.setTimeout(() => {
              const value = urlRef.current?.value;
              if (value) applyUrlQueryParams(value);
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isStreaming) {
              applyUrlQueryParams(e.currentTarget.value);
              sendRequest();
            }
          }}
          placeholder={
            isWs
              ? t("request.ws_url_placeholder")
              : isSse
                ? t("request.sse_url_placeholder")
                : t("request.url_placeholder")
          }
          className="h-9 flex-1"
        />

        <VariablePreview value={activeRequest.url} vars={scopedVars} />

        {!isStreaming &&
          (loading ? (
            <Button
              variant="destructive"
              onClick={cancelRequest}
              className="h-9 gap-1.5"
            >
              <XCircle size={14} />
              {t("request.cancel")}
            </Button>
          ) : (
            <Button
              onClick={sendRequest}
              disabled={!activeRequest.url}
              className="h-9 gap-1.5"
            >
              <Send size={14} />
              {t("request.send")}
            </Button>
          ))}
      </div>

      {/* Tabs */}
      <div className="px-4 pb-3">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as RequestTab)}
        >
          <TabsList className="h-auto flex-wrap justify-start">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-[12px]">
                {tab.label}
                {tab.id === "params" && paramCount > 0 && (
                  <span className="ml-1 text-[10px] text-primary">
                    {paramCount}
                  </span>
                )}
                {tab.id === "headers" && headerCount > 0 && (
                  <span className="ml-1 text-[10px] text-primary">
                    {headerCount}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "params" && (
          <KeyValueEditor
            items={activeRequest.params}
            onChange={setParams}
            keyPlaceholder={t("request.param_key_placeholder")}
            valuePlaceholder="Value"
            previewVars={scopedVars}
          />
        )}

        {activeTab === "headers" && (
          <KeyValueEditor
            items={activeRequest.headers}
            onChange={setHeaders}
            keyPlaceholder={t("request.header_key_placeholder")}
            valuePlaceholder="Value"
            previewVars={scopedVars}
          />
        )}

        {activeTab === "body" && !isStreaming && (
          <div className="space-y-3">
            <Tabs
              value={activeRequest.bodyType}
              onValueChange={(v) => setBodyType(v as BodyType)}
            >
              <TabsList className="h-auto flex-wrap justify-start">
                {BODY_TYPES.map((type) => (
                  <TabsTrigger key={type} value={type}>
                    {t(BODY_TYPE_LABEL_KEYS[type])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {(activeRequest.bodyType === "form-data" ||
              activeRequest.bodyType === "x-www-form-urlencoded") && (
              <KeyValueEditor
                items={activeRequest.formData}
                onChange={setFormData}
                keyPlaceholder={t("request.field_key_placeholder")}
                valuePlaceholder="Value"
                allowFiles={activeRequest.bodyType === "form-data"}
                previewVars={scopedVars}
              />
            )}
            {activeRequest.bodyType === "binary" && (
              <div className="flex items-center gap-2">
                <Input
                  value={activeRequest.binaryFilePath ?? ""}
                  onChange={(e) =>
                    updateActiveRequest({
                      binaryFilePath: e.target.value || undefined,
                    })
                  }
                  placeholder={t("request.binary_path_placeholder")}
                  className="flex-1 text-[12px] font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 text-[11px]"
                  onClick={async () => {
                    const picked = await openFileDialog({ multiple: false });
                    if (typeof picked === "string")
                      updateActiveRequest({ binaryFilePath: picked });
                  }}
                >
                  {t("common.browse")}
                </Button>
                {activeRequest.binaryFilePath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 text-[11px] text-destructive hover:text-destructive"
                    onClick={() =>
                      updateActiveRequest({ binaryFilePath: undefined })
                    }
                  >
                    {t("common.clear")}
                  </Button>
                )}
              </div>
            )}
            {activeRequest.bodyType === "graphql" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("request.gql_query")}</label>
                  <div className="flex items-center gap-2">
                    {gqlSchemaState === "ok" && (
                      <span className="text-[10px] text-success">
                        {t("request.gql_schema_count", { n: gqlFields.length })}
                      </span>
                    )}
                    {gqlSchemaState === "error" && (
                      <span className="text-[10px] text-destructive">
                        {t("request.gql_schema_failed")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={refreshGraphqlSchema}
                      disabled={gqlSchemaState === "loading"}
                    >
                      {gqlSchemaState === "loading" ? t("common.loading") : t("request.gql_schema_refresh")}
                    </Button>
                  </div>
                </div>
                <CodeEditor
                  value={activeRequest.graphqlQuery || ""}
                  onChange={setGraphqlQuery}
                  language="graphql"
                  height={160}
                  completions={completionKeys}
                  graphqlFields={gqlFields}
                  placeholder={"query Example {\n  field\n}"}
                />
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("request.gql_variables")}</label>
                <CodeEditor
                  value={activeRequest.graphqlVariables || ""}
                  onChange={setGraphqlVariables}
                  language="json"
                  height={120}
                  completions={completionKeys}
                  placeholder={'{\n  "id": 1\n}'}
                />
              </div>
            )}
            {activeRequest.bodyType !== "none" &&
              activeRequest.bodyType !== "form-data" &&
              activeRequest.bodyType !== "x-www-form-urlencoded" &&
              activeRequest.bodyType !== "binary" &&
              activeRequest.bodyType !== "graphql" && (
                <div className="space-y-1.5">
                  {(activeRequest.bodyType === "json" ||
                    activeRequest.bodyType === "xml") && (
                    <div className="flex items-center justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={handleBeautify}
                      >
                        {t("request.beautify")}
                      </Button>
                    </div>
                  )}
                  <CodeEditor
                    value={activeRequest.body}
                    onChange={(v) => {
                      setBody(v);
                      if (beautifyError) setBeautifyError(null);
                    }}
                    language={bodyTypeToLanguage(activeRequest.bodyType)}
                    height={bodyEditorHeight}
                    resizable
                    minHeight={80}
                    maxHeight={800}
                    onHeightChange={setBodyEditorHeight}
                    completions={completionKeys}
                    placeholder={
                      activeRequest.bodyType === "json"
                        ? '{\n  "key": "value"\n}'
                        : t("request.body_placeholder")
                    }
                  />
                  {beautifyError && (
                    <p className="text-[11px] text-destructive">{beautifyError}</p>
                  )}
                </div>
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
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("request.pre_request_hint")}
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
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t("request.tests_hint")}
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

        {activeTab === "docs" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              {t("request.docs_hint")}
            </p>
            <CodeEditor
              value={activeRequest.description ?? ""}
              onChange={(v) =>
                updateActiveRequest({ description: v || undefined })
              }
              language="plain"
              height={300}
              showGutter={false}
              placeholder={t("request.docs_placeholder")}
            />
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-3">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <Timer size={11} />
                {t("request.settings_timeout")}
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
                placeholder={t("request.settings_timeout_placeholder", { n: defaultTimeoutMs })}
                className="input-apple w-48 text-[12px]"
                min={1}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("request.settings_timeout_hint")}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <Tag size={11} />
                {t("request.settings_tags")}
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(activeRequest.tags ?? []).map((tag) => {
                  const c = tagColor(tag);
                  return (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:opacity-70"
                        title={t("request.settings_remove_tag", { name: tag })}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
                {(activeRequest.tags ?? []).length === 0 && (
                  <span className="text-[11px] text-muted-foreground">{t("request.settings_no_tags")}</span>
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
                placeholder={t("request.settings_tag_placeholder")}
                className="input-apple w-full text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("request.settings_tags_hint")}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <ShieldCheck size={11} />
                {t("request.settings_tls")}
              </label>
              <Select
                value={
                  activeRequest.verifyTls === undefined
                    ? "default"
                    : activeRequest.verifyTls
                      ? "on"
                      : "off"
                }
                onValueChange={(v) => {
                  if (v === "default") setVerifyTls(undefined);
                  else setVerifyTls(v === "on");
                }}
              >
                <SelectTrigger className="h-9 w-48 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default" className="text-[12px]">
                    {t("request.settings_tls_default", { mode: verifyTlsDefault ? t("request.settings_tls_default_verify") : t("request.settings_tls_default_skip") })}
                  </SelectItem>
                  <SelectItem value="on" className="text-[12px]">
                    {t("request.settings_tls_on")}
                  </SelectItem>
                  <SelectItem value="off" className="text-[12px]">
                    {t("request.settings_tls_off")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {activeRequest.verifyTls === false && (
                <p className="text-[11px] text-warning mt-1 flex items-center gap-1">
                  <ShieldAlert size={11} />
                  {t("request.settings_tls_skip_warn")}
                </p>
              )}
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <ArrowRightCircle size={11} />
                {t("request.settings_redirects")}
              </label>
              <div className="flex items-center gap-2">
                <Select
                  value={activeRequest.redirectPolicy ?? "follow"}
                  onValueChange={(v) =>
                    setRedirectPolicy(v as "follow" | "none" | "manual")
                  }
                >
                  <SelectTrigger className="h-9 w-40 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="follow" className="text-[12px]">
                      {t("request.settings_redirect_follow")}
                    </SelectItem>
                    <SelectItem value="none" className="text-[12px]">
                      {t("request.settings_redirect_none")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {(activeRequest.redirectPolicy ?? "follow") === "follow" && (
                  <>
                    <span className="text-[11px] text-muted-foreground">{t("request.settings_max")}</span>
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
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <Globe size={11} />
                {t("request.settings_proxy")}
              </label>
              <input
                type="text"
                value={activeRequest.proxyUrl ?? ""}
                onChange={(e) => setProxyUrl(e.target.value || undefined)}
                placeholder={t("request.settings_proxy_placeholder")}
                className="input-apple w-full text-[12px] font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("request.settings_proxy_hint")}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                <Lock size={11} />
                {t("request.settings_client_cert")}
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
                  placeholder={t("request.settings_cert_placeholder")}
                  className="input-apple flex-1 text-[12px] font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-9 text-[11px]"
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
                >
                  {t("common.browse")}
                </Button>
                {activeRequest.clientCert?.path && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 text-[11px] text-destructive hover:text-destructive"
                    onClick={() => setClientCert(undefined)}
                  >
                    {t("common.clear")}
                  </Button>
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
                  placeholder={t("request.settings_cert_pass_placeholder")}
                  className="input-apple w-full mt-2 text-[12px] font-mono"
                />
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                {t("request.settings_cert_hint")}
              </p>
            </div>
          </div>
        )}
      </div>

      {showCodegen && activeRequest && (
        <CodegenModal request={activeRequest} onClose={() => setShowCodegen(false)} />
      )}
      {showResolvedVars && activeRequest && (
        <ResolvedVariablesModal
          request={activeRequest}
          workspace={workspace}
          collections={collections}
          environments={environments}
          onClose={() => setShowResolvedVars(false)}
        />
      )}
    </div>
  );
}
