// src/lib/proxy.ts
// Proxy parser + rotator + liveness tester.
// Supports: http://, https://, socks5://, socks4://, ip:port (defaults to http),
// ip:port:user:pass and user:pass@ip:port forms.

import { Agent, Dispatcher, request as undiciRequest } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";
import * as https from "https";
import * as http from "http";
import { URL } from "url";

export type ProxyProtocol = "http" | "https" | "socks5" | "socks4";

export interface ParsedProxy {
  raw: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  alive: boolean;
  latencyMs?: number;
  lastError?: string;
  externalIp?: string;
  country?: string;
}

const PROXY_REGEX = /^(?:(https?|socks[45]):\/\/)?([a-zA-Z0-9._-]+):(\d{2,5})(?:[\/\s].*)?$/;
const USERPASS_HOST_REGEX = /^(https?|socks[45]):\/\/([^:]+):([^@]+)@([a-zA-Z0-9._-]+):(\d{2,5})\/?$/;
const HOST_USERPASS_REGEX = /^([a-zA-Z0-9._-]+):(\d{2,5}):([^:]+):(.+)$/;

export function parseProxyList(raw: string): ParsedProxy[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: ParsedProxy[] = [];
  for (const line of lines) {
    const p = parseProxyLine(line);
    if (p) out.push(p);
  }
  return out;
}

export function parseProxyLine(line: string): ParsedProxy | null {
  let m = line.match(USERPASS_HOST_REGEX);
  if (m) {
    const [, protocol, user, pass, host, port] = m;
    return makeProxy(line, protocol as ProxyProtocol, host, parseInt(port, 10), user, pass);
  }

  m = line.match(HOST_USERPASS_REGEX);
  if (m) {
    const [, host, portStr, user, pass] = m;
    return makeProxy(line, "http", host, parseInt(portStr, 10), user, pass);
  }

  m = line.match(PROXY_REGEX);
  if (m) {
    const [, proto, host, portStr] = m;
    const protocol = (proto || "http") as ProxyProtocol;
    return makeProxy(line, protocol, host, parseInt(portStr, 10));
  }

  return null;
}

function makeProxy(
  raw: string,
  protocol: ProxyProtocol,
  host: string,
  port: number,
  username?: string,
  password?: string
): ParsedProxy {
  return {
    raw,
    protocol,
    host,
    port,
    username,
    password,
    alive: false,
  };
}

export function proxyToUrl(p: ParsedProxy): string {
  const auth = p.username ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@` : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

// Build a fetch-compatible dispatcher for undici (http/https proxies)
export function buildHttpDispatcher(p: ParsedProxy): Dispatcher {
  const proxyUrl = proxyToUrl(p);
  return new (undici as any).ProxyAgent({ uri: proxyUrl });
}

// Build an HTTPS agent for socks proxies (used with native https module)
export function buildSocksAgent(p: ParsedProxy): https.Agent {
  const proxyUrl = proxyToUrl(p);
  return new SocksProxyAgent(proxyUrl) as unknown as https.Agent;
}

export interface ProxyTestResult {
  alive: boolean;
  latencyMs?: number;
  externalIp?: string;
  country?: string;
  error?: string;
}

// Test proxy by hitting ip-api.com (returns IP + country, fast, no auth)
export async function testProxy(p: ParsedProxy, timeoutMs = 8000): Promise<ProxyTestResult> {
  const testUrl = "http://ip-api.com/json/?fields=status,country,query";
  const start = Date.now();

  try {
    if (p.protocol === "http" || p.protocol === "https") {
      const dispatcher = buildHttpDispatcher(p);
      const res = await undiciRequest(testUrl, {
        dispatcher,
        method: "GET",
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      const text = await res.body.text();
      const latency = Date.now() - start;
      if (res.statusCode === 200) {
        try {
          const json = JSON.parse(text);
          if (json.status === "success") {
            return {
              alive: true,
              latencyMs: latency,
              externalIp: json.query,
              country: json.country,
            };
          }
        } catch {
          // fallthrough
        }
      }
      return { alive: false, error: `status ${res.statusCode}` };
    } else {
      // socks
      return await new Promise<ProxyTestResult>((resolve) => {
        const agent = buildSocksAgent(p);
        const req = https.get(
          "https://ip-api.com/json/?fields=status,country,query",
          {
            agent: agent as unknown as https.Agent,
            timeout: timeoutMs,
          } as https.RequestOptions,
          (res: http.IncomingMessage) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              const latency = Date.now() - start;
              if (res.statusCode === 200) {
                try {
                  const json = JSON.parse(data);
                  if (json.status === "success") {
                    resolve({
                      alive: true,
                      latencyMs: latency,
                      externalIp: json.query,
                      country: json.country,
                    });
                    return;
                  }
                } catch {
                  // fallthrough
                }
              }
              resolve({ alive: false, error: `status ${res.statusCode}` });
            });
          }
        );
        req.on("error", (err: Error) => {
          resolve({ alive: false, error: err.message });
        });
        req.on("timeout", () => {
          req.destroy();
          resolve({ alive: false, error: "timeout" });
        });
      });
    }
  } catch (err: any) {
    return { alive: false, error: err?.message ?? String(err) };
  }
}

// Round-robin / random picker from alive proxies
export class ProxyRotator {
  private alive: ParsedProxy[];
  private cursor = 0;

  constructor(proxies: ParsedProxy[]) {
    this.alive = proxies.filter((p) => p.alive);
  }

  size() {
    return this.alive.length;
  }

  next(): ParsedProxy | null {
    if (this.alive.length === 0) return null;
    const p = this.alive[this.cursor % this.alive.length];
    this.cursor = (this.cursor + 1) % this.alive.length;
    return p;
  }

  random(): ParsedProxy | null {
    if (this.alive.length === 0) return null;
    return this.alive[Math.floor(Math.random() * this.alive.length)];
  }

  filterByCountry(country: string): ParsedProxy[] {
    return this.alive.filter((p) => p.country?.toLowerCase() === country.toLowerCase());
  }
}
