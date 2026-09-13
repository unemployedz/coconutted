// src/app/api/proxy-check/route.ts
// Bulk proxy liveness tester. Returns parsed proxies + alive stats.

import { NextRequest, NextResponse } from "next/server";
import { parseProxyList, testProxy } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const proxyList: string = body?.proxyList ?? "";
  const limit = Math.min(parseInt(body?.limit ?? "50", 10) || 50, 500);

  const proxies = parseProxyList(proxyList).slice(0, limit);

  if (proxies.length === 0) {
    return NextResponse.json({ ok: false, error: "No proxies parsed." }, { status: 400 });
  }

  const batchSize = 8;
  for (let i = 0; i < proxies.length; i += batchSize) {
    const batch = proxies.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (p) => {
        const r = await testProxy(p, 6000);
        p.alive = r.alive;
        p.latencyMs = r.latencyMs;
        p.externalIp = r.externalIp;
        p.country = r.country;
        p.lastError = r.error;
      })
    );
  }

  const alive = proxies.filter((p) => p.alive);
  const byCountry: Record<string, number> = {};
  for (const p of alive) {
    const c = p.country ?? "Unknown";
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    total: proxies.length,
    alive: alive.length,
    byCountry,
    proxies: proxies.map((p) => ({
      raw: p.raw,
      protocol: p.protocol,
      host: p.host,
      port: p.port,
      country: p.country,
      externalIp: p.externalIp,
      latencyMs: p.latencyMs,
      alive: p.alive,
      error: p.lastError,
    })),
  });
}
