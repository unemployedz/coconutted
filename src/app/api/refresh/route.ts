// src/app/api/refresh/route.ts
// Streams refresh progress back to client using a streaming Response.
// Vercel: requires maxDuration=60 on Pro, falls back gracefully on Hobby (10s).

import { NextRequest } from "next/server";
import { parseProxyList, testProxy } from "@/lib/proxy";
import { refreshCookie } from "@/lib/roblox";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      try {
        const body = await req.json();
        const cookie: string = body?.cookie?.trim();
        const proxyList: string = body?.proxyList ?? "";
        const skipProxyTest: boolean = !!body?.skipProxyTest;

        if (!cookie || cookie.length < 20) {
          send({ type: "error", message: "Cookie too short or missing." });
          controller.close();
          return;
        }
        if (!cookie.startsWith("|") && !cookie.includes("|Warning")) {
          send({
            type: "warn",
            message:
              "Cookie doesn't look like a fresh .ROBLOSECURITY (should start with |). Proceeding anyway.",
          });
        }

        send({ type: "progress", message: "Parsing proxy list..." });
        const proxies = parseProxyList(proxyList);
        send({
          type: "progress",
          message: `Parsed ${proxies.length} proxies (${proxies.filter((p) => p.protocol === "socks5").length} socks5, ${proxies.filter((p) => p.protocol === "http").length} http).`,
        });

        if (proxies.length === 0) {
          send({ type: "error", message: "No proxies parsed. Paste at least one proxy." });
          controller.close();
          return;
        }

        if (!skipProxyTest) {
          send({ type: "progress", message: "Testing proxies in batches of 8..." });
          const batchSize = 8;
          let tested = 0;
          let aliveCount = 0;
          for (let i = 0; i < proxies.length; i += batchSize) {
            const batch = proxies.slice(i, i + batchSize);
            const results = await Promise.all(
              batch.map(async (p) => ({ p, r: await testProxy(p, 6000) }))
            );
            for (const { p, r } of results) {
              p.alive = r.alive;
              p.latencyMs = r.latencyMs;
              p.externalIp = r.externalIp;
              p.country = r.country;
              p.lastError = r.error;
              if (r.alive) aliveCount++;
              tested++;
            }
            send({
              type: "proxy-progress",
              tested,
              total: proxies.length,
              alive: aliveCount,
            });
          }
          send({
            type: "progress",
            message: `${aliveCount}/${proxies.length} proxies alive. Starting refresh...`,
          });
        } else {
          for (const p of proxies) p.alive = true;
          send({ type: "progress", message: "Skipping proxy test. Treating all as alive." });
        }

        const result = await refreshCookie(cookie, proxies, {
          onProgress: (msg) => send({ type: "progress", message: msg }),
        });

        send({ type: "done", result });
      } catch (err: any) {
        send({ type: "error", message: err?.message ?? String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
