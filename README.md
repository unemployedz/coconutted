# RBX Cookie Refresher

Roblox `.ROBLOSECURITY` cookie refresher + IP-lock bypass tool. Paste a cookie, upload a proxy list, the tool rotates the cookie through alive proxies against live Roblox endpoints and captures any refreshed cookie emitted via `Set-Cookie`.

## Stack

- Next.js 16 (App Router, Node runtime)
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui (dark theme)
- undici (HTTP/HTTPS proxy support)
- socks-proxy-agent (SOCKS5/SOCKS4 support)

## Quick start (local)

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploy

See [DEPLOY.md](./DEPLOY.md) for full Vercel guide.

TL;DR:
```bash
npx vercel --prod --yes
```

## How it works

1. **Cookie validation** — hits `https://users.roblox.com/v1/users/authenticated` to confirm the cookie is alive and grab the user ID
2. **CSRF warm-up** — POSTs `https://auth.roblox.com/v2/logout` with the cookie to capture the `X-CSRF-TOKEN` (sometimes triggers a `Set-Cookie` on `.ROBLOSECURITY`)
3. **Proxy fanout** — for each alive proxy, replays the cookie through `https://www.roblox.com/home`. If Roblox emits a new `.ROBLOSECURITY` in `Set-Cookie`, that's the refreshed cookie — captured and re-validated through the same proxy
4. **Result** — original cookie, refreshed cookie (if captured), success proxy metadata, full endpoint probe trail

## Proxy format support

```
http://1.2.3.4:8080
https://5.6.7.8:443
socks5://9.10.11.12:1080
socks4://13.14.15.16:1080
17.18.19.20:3128                              ← defaults to http
21.22.23.24:8080:user:pass                    ← host:port:user:pass
http://user:pass@25.26.27.28:3128             ← user:pass@host:port
```

## Files

| Path | Purpose |
|---|---|
| `src/app/page.tsx` | Dark theme UI — cookie input, proxy upload, streaming logs, result panel |
| `src/app/api/refresh/route.ts` | SSE streaming refresh endpoint |
| `src/app/api/proxy-check/route.ts` | Bulk proxy liveness tester |
| `src/lib/proxy.ts` | Proxy parser + rotator + tester |
| `src/lib/roblox.ts` | Roblox auth client + cookie refresh logic |
| `vercel.json` | Vercel function timeouts (60s on Pro) |
| `public/samples/` | Bundled proxy lists (~17k proxies) |

## Vercel plan note

- **Hobby (free):** max 10s function duration — works for ≤20 proxies with "Skip liveness test" enabled
- **Pro ($20/mo):** max 60s — full proxy pool testing

## Honest proxy quality note

The bundled sample lists are scraped free datacenter proxies. Roblox's risk engine rejects most DC ASNs (OVH, DigitalOcean, AWS, Linode) on auth endpoints. For real refresh success, use ISP or residential proxies:
- IPRoyal ISP / Static Residential
- Bright Data ISP
- NetNut ISP
- SOAX (rotating residential)

The tool's architecture is complete — the proxy pool is the only bottleneck for actual refresh success.

made by discord.gg/nullstate :)
