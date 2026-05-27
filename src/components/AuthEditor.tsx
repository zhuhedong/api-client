import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Check, Loader2, AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AuthConfig } from "../types";

/** Shape of `DeviceCodeStartResult` returned by `oauth2_start_device_code`. */
interface DeviceCodeStartResult {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string | null;
  expires_in: number;
  interval: number;
}

interface Props {
  value: AuthConfig | undefined;
  onChange: (next: AuthConfig) => void;
  /**
   * Available auth strategies. The default omits `"inherit"` because most
   * scopes (collection root, top-level requests) have nothing to inherit
   * from. Pass `allowInherit` when this editor is bound to a request that
   * lives inside a collection/folder.
   */
  allowInherit?: boolean;
  /**
   * Human-readable description of what `"inherit"` resolves to right now,
   * shown under the inherit option. Optional.
   */
  inheritedFrom?: string | null;
}

const ALL: AuthConfig["auth_type"][] = [
  "inherit",
  "none",
  "bearer",
  "basic",
  "api_key",
  "oauth2",
  "sigv4",
  "digest",
  "oauth1",
  "jwt",
];

export function AuthEditor({ value, onChange, allowInherit, inheritedFrom }: Props) {
  const { t } = useTranslation();
  const current: AuthConfig = value || { auth_type: allowInherit ? "inherit" : "none" };
  const types = allowInherit ? ALL : ALL.filter((tp) => tp !== "inherit");

  const typeLabel = (type: AuthConfig["auth_type"]): string => {
    switch (type) {
      case "inherit": return t("auth.type_inherit");
      case "none": return t("auth.type_none");
      case "bearer": return t("auth.type_bearer");
      case "basic": return t("auth.type_basic");
      case "api_key": return t("auth.type_api_key");
      case "oauth2": return t("auth.type_oauth2");
      case "sigv4": return t("auth.type_sigv4");
      case "digest": return t("auth.type_digest");
      case "oauth1": return t("auth.type_oauth1");
      case "jwt": return t("auth.type_jwt");
      default: return type;
    }
  };

  return (
    <div className="space-y-3">
      <div className="segmented-control">
        {types.map((type) => (
          <button
            key={type}
            onClick={() => onChange({ ...current, auth_type: type })}
            className={`segment ${current.auth_type === type ? "segment-active" : ""}`}
          >
            {typeLabel(type)}
          </button>
        ))}
      </div>

      {current.auth_type === "inherit" && (
        <p className="text-[12px] text-text-tertiary">
          {inheritedFrom
            ? t("auth.inherits_from", { source: inheritedFrom })
            : t("auth.inherits_default")}
        </p>
      )}

      {current.auth_type === "bearer" && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.token")}</label>
          <input
            type="text"
            value={current.bearer_token || ""}
            onChange={(e) => onChange({ ...current, bearer_token: e.target.value })}
            placeholder={t("auth.token_placeholder")}
            className="input-apple w-full font-mono text-[12px]"
            spellCheck={false}
          />
        </div>
      )}

      {current.auth_type === "basic" && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.username")}</label>
            <input
              type="text"
              value={current.basic_username || ""}
              onChange={(e) => onChange({ ...current, basic_username: e.target.value })}
              placeholder={t("auth.username")}
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.password")}</label>
            <input
              type="password"
              value={current.basic_password || ""}
              onChange={(e) => onChange({ ...current, basic_password: e.target.value })}
              placeholder={t("auth.password")}
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
        </div>
      )}

      {current.auth_type === "api_key" && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.key")}</label>
            <input
              type="text"
              value={current.api_key_key || ""}
              onChange={(e) => onChange({ ...current, api_key_key: e.target.value })}
              placeholder="X-API-Key"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.value")}</label>
            <input
              type="text"
              value={current.api_key_value || ""}
              onChange={(e) => onChange({ ...current, api_key_value: e.target.value })}
              placeholder="your-api-key"
              className="input-apple w-full font-mono text-[12px] mt-1"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.add_to")}</label>
            <div className="segmented-control mt-1">
              <button
                onClick={() => onChange({ ...current, api_key_in: "header" })}
                className={`segment ${(current.api_key_in || "header") === "header" ? "segment-active" : ""}`}
              >
                {t("auth.in_header")}
              </button>
              <button
                onClick={() => onChange({ ...current, api_key_in: "query" })}
                className={`segment ${current.api_key_in === "query" ? "segment-active" : ""}`}
              >
                {t("auth.in_query")}
              </button>
            </div>
          </div>
        </div>
      )}

      {current.auth_type === "oauth2" && (
        <OAuth2Editor value={current} onChange={onChange} />
      )}

      {current.auth_type === "sigv4" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.aws_access_key_id")}</label>
              <input
                type="text"
                value={current.aws_access_key_id || ""}
                onChange={(e) => onChange({ ...current, aws_access_key_id: e.target.value })}
                placeholder="AKIA..."
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.aws_secret")}</label>
              <input
                type="password"
                value={current.aws_secret_access_key || ""}
                onChange={(e) => onChange({ ...current, aws_secret_access_key: e.target.value })}
                placeholder="secret"
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.aws_region")}</label>
              <input
                type="text"
                value={current.aws_region || ""}
                onChange={(e) => onChange({ ...current, aws_region: e.target.value })}
                placeholder="us-east-1"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.aws_service")}</label>
              <input
                type="text"
                value={current.aws_service || ""}
                onChange={(e) => onChange({ ...current, aws_service: e.target.value })}
                placeholder="execute-api / s3 / dynamodb"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.aws_session_token")}</label>
            <input
              type="password"
              value={current.aws_session_token || ""}
              onChange={(e) => onChange({ ...current, aws_session_token: e.target.value })}
              placeholder={t("auth.aws_session_placeholder")}
              className="input-apple w-full font-mono text-[12px] mt-1"
            />
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            {t("auth.sigv4_notice")}
          </p>
        </div>
      )}

      {current.auth_type === "digest" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.username")}</label>
              <input
                type="text"
                value={current.digest_username || ""}
                onChange={(e) => onChange({ ...current, digest_username: e.target.value })}
                placeholder="username"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.password")}</label>
              <input
                type="password"
                value={current.digest_password || ""}
                onChange={(e) => onChange({ ...current, digest_password: e.target.value })}
                placeholder="••••••••"
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            {t("auth.digest_notice")}
          </p>
        </div>
      )}

      {current.auth_type === "oauth1" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_consumer_key")}</label>
              <input
                type="text"
                value={current.oauth1_consumer_key || ""}
                onChange={(e) => onChange({ ...current, oauth1_consumer_key: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_consumer_secret")}</label>
              <input
                type="password"
                value={current.oauth1_consumer_secret || ""}
                onChange={(e) => onChange({ ...current, oauth1_consumer_secret: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_token")}</label>
              <input
                type="text"
                value={current.oauth1_token || ""}
                onChange={(e) => onChange({ ...current, oauth1_token: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_token_secret")}</label>
              <input
                type="password"
                value={current.oauth1_token_secret || ""}
                onChange={(e) => onChange({ ...current, oauth1_token_secret: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_signature_method")}</label>
              <select
                value={current.oauth1_signature_method || "HMAC-SHA1"}
                onChange={(e) => onChange({ ...current, oauth1_signature_method: e.target.value as AuthConfig["oauth1_signature_method"] })}
                className="input-apple w-full text-[12px] mt-1"
              >
                <option value="HMAC-SHA1">HMAC-SHA1</option>
                <option value="HMAC-SHA256">HMAC-SHA256</option>
                <option value="PLAINTEXT">PLAINTEXT</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_realm")}</label>
              <input
                type="text"
                value={current.oauth1_realm || ""}
                onChange={(e) => onChange({ ...current, oauth1_realm: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth1_add_to")}</label>
              <select
                value={current.oauth1_add_to || "header"}
                onChange={(e) => onChange({ ...current, oauth1_add_to: e.target.value as "header" | "query" })}
                className="input-apple w-full text-[12px] mt-1"
              >
                <option value="header">{t("auth.add_to_header")}</option>
                <option value="query">{t("auth.add_to_query")}</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {current.auth_type === "jwt" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.jwt_algorithm")}</label>
              <select
                value={current.jwt_algorithm || "HS256"}
                onChange={(e) => onChange({ ...current, jwt_algorithm: e.target.value as AuthConfig["jwt_algorithm"] })}
                className="input-apple w-full text-[12px] mt-1"
              >
                <option value="HS256">HS256</option>
                <option value="HS384">HS384</option>
                <option value="HS512">HS512</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.jwt_secret")}</label>
              <input
                type="password"
                value={current.jwt_secret || ""}
                onChange={(e) => onChange({ ...current, jwt_secret: e.target.value })}
                placeholder="••••••••"
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              checked={!!current.jwt_secret_is_base64}
              onChange={(e) => onChange({ ...current, jwt_secret_is_base64: e.target.checked })}
              className="rounded"
            />
            {t("auth.jwt_secret_is_base64")}
          </label>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.jwt_payload")}</label>
            <textarea
              value={current.jwt_payload || ""}
              onChange={(e) => onChange({ ...current, jwt_payload: e.target.value })}
              placeholder='{"sub":"user-1","iss":"my-app"}'
              className="input-apple w-full font-mono text-[12px] mt-1 min-h-[90px]"
              spellCheck={false}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.jwt_request_header")}</label>
              <input
                type="text"
                value={current.jwt_request_header || ""}
                onChange={(e) => onChange({ ...current, jwt_request_header: e.target.value })}
                placeholder="Authorization"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.jwt_header_prefix")}</label>
              <input
                type="text"
                value={current.jwt_header_prefix ?? "Bearer "}
                onChange={(e) => onChange({ ...current, jwt_header_prefix: e.target.value })}
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
          </div>
        </div>
      )}

      {current.auth_type === "none" && (
        <p className="text-[12px] text-text-tertiary">
          {allowInherit
            ? t("auth.none_explicit")
            : t("auth.none_default")}
        </p>
      )}
    </div>
  );
}

function OAuth2Editor({
  value,
  onChange,
}: {
  value: AuthConfig;
  onChange: (next: AuthConfig) => void;
}) {
  const { t } = useTranslation();
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchOk, setFetchOk] = useState(false);
  // device_code flow: holds the user_code + verification_uri block while
  // we wait for the user to approve on the verification page. `null` for
  // all other grants (and for device_code before / after polling).
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeStartResult | null>(
    null,
  );
  // Set to true when the user clicks Cancel on the device_code block.
  // The backend poll loop keeps running until its deadline, but we ignore
  // its eventual result so the UI doesn't bounce back into a token state
  // the user explicitly abandoned.
  const cancelledRef = useRef(false);
  // Drive "expired" state off a tick that updates once a minute, instead of
  // calling Date.now() in render (which violates react-hooks purity and
  // produces non-deterministic renders).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const grant = value.oauth2_grant_type || "client_credentials";
  const clientAuth = value.oauth2_client_auth || "basic";

  const hasToken = !!value.oauth2_access_token;
  const expiresAt = value.oauth2_token_expires_at;
  const isExpired = expiresAt != null && expiresAt < now;
  const tokenStatus = !hasToken
    ? null
    : isExpired
    ? t("auth.oauth2_status_expired")
    : expiresAt != null
    ? t("auth.oauth2_status_valid_until", { when: new Date(expiresAt).toLocaleString() })
    : t("auth.oauth2_status_no_expiry");

  const usePkce = value.oauth2_use_pkce !== false; // default true

  const fetchToken = async () => {
    setFetching(true);
    setFetchError(null);
    setFetchOk(false);
    cancelledRef.current = false;
    try {
      // device_code (RFC 8628) is a two-step flow with a polling tail:
      //   1. POST to device-authorization endpoint → user_code + uri
      //   2. show user_code/uri to the user (auto-open browser on the
      //      complete URI if the provider supplied one)
      //   3. poll the token endpoint until the user approves
      if (grant === "device_code") {
        const start = await invoke<DeviceCodeStartResult>(
          "oauth2_start_device_code",
          {
            request: {
              device_authorization_url:
                value.oauth2_device_authorization_url || "",
              client_id: value.oauth2_client_id || "",
              client_secret: value.oauth2_client_secret || "",
              scope: value.oauth2_scope || null,
              client_auth: clientAuth,
              insecure: false,
            },
          },
        );
        setDeviceInfo(start);
        // Best-effort: try to launch the user's browser at the
        // verification URL. If the shell plugin can't (Linux without
        // xdg-open, missing capability, etc.) the user can still copy
        // the URL from the panel and open it manually.
        const browserUrl = start.verification_uri_complete || start.verification_uri;
        try {
          await openExternal(browserUrl);
        } catch {
          /* user can still copy/click manually */
        }

        const resp = await invoke<{
          access_token: string;
          expires_at: number | null;
          refresh_token: string | null;
        }>("oauth2_poll_device_token", {
          request: {
            token_url: value.oauth2_token_url || "",
            client_id: value.oauth2_client_id || "",
            client_secret: value.oauth2_client_secret || "",
            client_auth: clientAuth,
            device_code: start.device_code,
            interval: start.interval,
            expires_in: start.expires_in,
            insecure: false,
          },
        });
        if (cancelledRef.current) return;
        onChange({
          ...value,
          oauth2_access_token: resp.access_token,
          oauth2_token_expires_at: resp.expires_at ?? undefined,
          oauth2_refresh_token: resp.refresh_token ?? value.oauth2_refresh_token,
        });
        setFetchOk(true);
        return;
      }

      // authorization_code is a two-step flow:
      //   1. open browser, await loopback redirect with the code
      //   2. exchange code + verifier for tokens
      let extra: Record<string, unknown> = {};
      if (grant === "authorization_code") {
        const start = await invoke<{
          code: string;
          redirect_uri: string;
          code_verifier: string;
          state: string;
        }>("oauth2_start_authorization_code", {
          request: {
            grant_type: grant,
            token_url: value.oauth2_token_url || "",
            client_id: value.oauth2_client_id || "",
            client_secret: value.oauth2_client_secret || "",
            scope: value.oauth2_scope || null,
            authorization_url: value.oauth2_authorization_url || "",
            use_pkce: usePkce,
            insecure: false,
          },
        });
        extra = {
          authorization_url: value.oauth2_authorization_url || "",
          code: start.code,
          redirect_uri: start.redirect_uri,
          code_verifier: start.code_verifier,
          use_pkce: usePkce,
        };
      }
      const resp = await invoke<{
        access_token: string;
        expires_at: number | null;
        refresh_token: string | null;
      }>("oauth2_fetch_token", {
        request: {
          grant_type: grant,
          token_url: value.oauth2_token_url || "",
          client_id: value.oauth2_client_id || "",
          client_secret: value.oauth2_client_secret || "",
          scope: value.oauth2_scope || null,
          client_auth: clientAuth,
          username: grant === "password" ? value.oauth2_username || "" : null,
          password: grant === "password" ? value.oauth2_password || "" : null,
          insecure: false,
          ...extra,
        },
      });
      onChange({
        ...value,
        oauth2_access_token: resp.access_token,
        oauth2_token_expires_at: resp.expires_at ?? undefined,
        // Only overwrite the cached refresh_token if the provider returned
        // a new one. Some providers (Google, Auth0) only emit it on the
        // first exchange and expect the client to keep using the same one.
        oauth2_refresh_token: resp.refresh_token ?? value.oauth2_refresh_token,
      });
      setFetchOk(true);
    } catch (err) {
      if (!cancelledRef.current) {
        setFetchError(String(err));
      }
    } finally {
      setFetching(false);
      setDeviceInfo(null);
    }
  };

  const cancelDeviceFlow = () => {
    // The backend poll loop continues until its own deadline; we just
    // hide the panel and ignore the eventual result via cancelledRef.
    cancelledRef.current = true;
    setDeviceInfo(null);
    setFetching(false);
  };

  const refreshToken = async () => {
    if (!value.oauth2_refresh_token) return;
    setFetching(true);
    setFetchError(null);
    setFetchOk(false);
    try {
      const resp = await invoke<{
        access_token: string;
        expires_at: number | null;
        refresh_token: string | null;
      }>("oauth2_fetch_token", {
        request: {
          grant_type: "refresh_token",
          token_url: value.oauth2_token_url || "",
          client_id: value.oauth2_client_id || "",
          client_secret: value.oauth2_client_secret || "",
          scope: value.oauth2_scope || null,
          client_auth: clientAuth,
          refresh_token: value.oauth2_refresh_token,
          insecure: false,
        },
      });
      onChange({
        ...value,
        oauth2_access_token: resp.access_token,
        oauth2_token_expires_at: resp.expires_at ?? undefined,
        oauth2_refresh_token: resp.refresh_token ?? value.oauth2_refresh_token,
      });
      setFetchOk(true);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_grant")}</label>
        <div className="segmented-control mt-1">
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "authorization_code" })}
            className={`segment ${grant === "authorization_code" ? "segment-active" : ""}`}
          >
            {t("auth.oauth2_grant_authorization_code")}
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "client_credentials" })}
            className={`segment ${grant === "client_credentials" ? "segment-active" : ""}`}
          >
            {t("auth.oauth2_grant_client_credentials")}
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "password" })}
            className={`segment ${grant === "password" ? "segment-active" : ""}`}
          >
            {t("auth.oauth2_grant_password")}
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "device_code" })}
            className={`segment ${grant === "device_code" ? "segment-active" : ""}`}
          >
            {t("auth.oauth2_grant_device_code")}
          </button>
        </div>
      </div>

      {grant === "device_code" && (
        <div>
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_device_authorization_url")}</label>
          <input
            type="text"
            value={value.oauth2_device_authorization_url || ""}
            onChange={(e) => onChange({ ...value, oauth2_device_authorization_url: e.target.value })}
            placeholder={t("auth.oauth2_device_authorization_url_placeholder")}
            className="input-apple w-full font-mono text-[12px] mt-1"
            spellCheck={false}
          />
        </div>
      )}

      {grant === "authorization_code" && (
        <>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_authorization_url")}</label>
            <input
              type="text"
              value={value.oauth2_authorization_url || ""}
              onChange={(e) => onChange({ ...value, oauth2_authorization_url: e.target.value })}
              placeholder={t("auth.oauth2_authorization_url_placeholder")}
              className="input-apple w-full font-mono text-[12px] mt-1"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="oauth2-use-pkce"
              type="checkbox"
              checked={usePkce}
              onChange={(e) => onChange({ ...value, oauth2_use_pkce: e.target.checked })}
            />
            <label htmlFor="oauth2-use-pkce" className="text-[12px] text-text-secondary">
              {t("auth.oauth2_use_pkce")}
            </label>
          </div>
        </>
      )}

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_token_url")}</label>
        <input
          type="text"
          value={value.oauth2_token_url || ""}
          onChange={(e) => onChange({ ...value, oauth2_token_url: e.target.value })}
          placeholder={t("auth.oauth2_token_url_placeholder")}
          className="input-apple w-full font-mono text-[12px] mt-1"
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_client_id")}</label>
          <input
            type="text"
            value={value.oauth2_client_id || ""}
            onChange={(e) => onChange({ ...value, oauth2_client_id: e.target.value })}
            placeholder={t("auth.oauth2_client_id_placeholder")}
            className="input-apple w-full text-[12px] mt-1 font-mono"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_client_secret")}</label>
          <input
            type="password"
            value={value.oauth2_client_secret || ""}
            onChange={(e) => onChange({ ...value, oauth2_client_secret: e.target.value })}
            placeholder={t("auth.oauth2_client_secret_placeholder")}
            className="input-apple w-full text-[12px] mt-1 font-mono"
          />
        </div>
      </div>

      {grant === "password" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.username")}</label>
            <input
              type="text"
              value={value.oauth2_username || ""}
              onChange={(e) => onChange({ ...value, oauth2_username: e.target.value })}
              placeholder={t("auth.oauth2_username_placeholder")}
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.password")}</label>
            <input
              type="password"
              value={value.oauth2_password || ""}
              onChange={(e) => onChange({ ...value, oauth2_password: e.target.value })}
              placeholder={t("auth.oauth2_password_placeholder")}
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_scope")}</label>
        <input
          type="text"
          value={value.oauth2_scope || ""}
          onChange={(e) => onChange({ ...value, oauth2_scope: e.target.value })}
          placeholder={t("auth.oauth2_scope_placeholder")}
          className="input-apple w-full font-mono text-[12px] mt-1"
          spellCheck={false}
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t("auth.oauth2_client_auth")}</label>
        <div className="segmented-control mt-1">
          <button
            onClick={() => onChange({ ...value, oauth2_client_auth: "basic" })}
            className={`segment ${clientAuth === "basic" ? "segment-active" : ""}`}
            title={t("auth.oauth2_client_auth_basic_tooltip")}
          >
            {t("auth.oauth2_client_auth_basic")}
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_client_auth: "body" })}
            className={`segment ${clientAuth === "body" ? "segment-active" : ""}`}
            title={t("auth.oauth2_client_auth_body_tooltip")}
          >
            {t("auth.oauth2_client_auth_body")}
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-border-light">
        <button
          type="button"
          onClick={fetchToken}
          disabled={fetching}
          className="px-3 py-1.5 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {fetching ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t("auth.oauth2_fetching")}
            </>
          ) : (
            <>{t("auth.oauth2_fetch_token")}</>
          )}
        </button>

        {deviceInfo && (
          <div className="mt-3 p-3 rounded-md border border-border bg-surface-secondary space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                {t("auth.oauth2_device_user_code_label")}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(deviceInfo.user_code)}
                className="text-[11px] text-accent hover:underline flex items-center gap-1"
              >
                <Copy size={11} />
                {t("auth.oauth2_device_copy_code")}
              </button>
            </div>
            <div className="font-mono text-[18px] tracking-[0.25em] text-text-primary select-all">
              {deviceInfo.user_code}
            </div>

            <div className="flex items-baseline justify-between gap-2 pt-2">
              <span className="text-[10px] uppercase tracking-wider text-text-secondary">
                {t("auth.oauth2_device_verification_uri_label")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(deviceInfo.verification_uri_complete || deviceInfo.verification_uri)}
                  className="text-[11px] text-accent hover:underline flex items-center gap-1"
                >
                  <Copy size={11} />
                  {t("auth.oauth2_device_copy_url")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openExternal(deviceInfo.verification_uri_complete || deviceInfo.verification_uri);
                  }}
                  className="text-[11px] text-accent hover:underline flex items-center gap-1"
                >
                  <ExternalLink size={11} />
                  {t("auth.oauth2_device_open_browser")}
                </button>
              </div>
            </div>
            <div className="font-mono text-[12px] text-text-primary break-all select-all">
              {deviceInfo.verification_uri}
            </div>

            <p className="text-[11px] text-text-secondary pt-1">{t("auth.oauth2_device_instructions")}</p>
            <p className="text-[11px] text-text-tertiary">
              {t("auth.oauth2_device_expires_in", { minutes: Math.max(1, Math.round(deviceInfo.expires_in / 60)) })}
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-border-light">
              <span className="text-[11px] text-text-secondary flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" />
                {t("auth.oauth2_device_polling")}
              </span>
              <button
                type="button"
                onClick={cancelDeviceFlow}
                className="text-[11px] text-text-secondary hover:text-text-primary hover:underline"
              >
                {t("auth.oauth2_device_cancel")}
              </button>
            </div>
          </div>
        )}

        {fetchError && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-error">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="break-words">{fetchError}</span>
          </div>
        )}

        {fetchOk && !fetchError && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
            <Check size={11} />
            <span>{t("auth.oauth2_fetched")}</span>
          </div>
        )}

        {hasToken && (
          <div className="mt-2 text-[11px] text-text-tertiary">
            {t("auth.oauth2_cached_token")} <span className={isExpired ? "text-error" : "text-text-secondary"}>{tokenStatus}</span>
            {value.oauth2_refresh_token && (
              <>
                {" — "}
                <button
                  type="button"
                  onClick={refreshToken}
                  className="text-accent hover:underline"
                >
                  {t("auth.oauth2_refresh")}
                </button>
              </>
            )}
            {" — "}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  oauth2_access_token: "",
                  oauth2_token_expires_at: undefined,
                  oauth2_refresh_token: undefined,
                })
              }
              className="text-accent hover:underline"
            >
              {t("auth.oauth2_clear")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
