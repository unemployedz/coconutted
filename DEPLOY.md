# RBX Cookie Refresher — Vercel Deployment Guide

## Prerequisites

1. A Vercel account (free Hobby tier works, but **Pro is recommended** — see "Why Pro" below)
2. A GitHub/GitLab/Bitbucket repo (or use `vercel` CLI for direct deploy)
3. Node.js 20+ installed locally (only needed for CLI deploy)

---

## Method 1 — CLI deploy (fastest)

```bash
# from project root after unzipping
npm install -g vercel          # one-time
vercel login                   # opens browser
vercel link                    # link this folder to a Vercel project
vercel --prod                  # deploy to production
```

First deploy will print a URL like `https://rbx-cookie-refresher-xxxx.vercel.app`.

## Method 2 — Git push

```bash
git init
git add .
git commit -m "rbx cookie refresher"
git branch -M main
git remote add origin https://github.com/<you>/rbx-refresher.git
git push -u origin main
```

Then on Vercel dashboard → New Project → Import the repo → Deploy. Build settings auto-detected from `package.json`. No env vars needed.

---

## Vercel settings (auto-detected, just verify)

| Field | Value |
|---|---|
| Framework Preset | Next.js |
| Build Command | `next build` |
| Output Directory | `.next` (auto) |
| Install Command | `npm install` (auto) |
| Node.js Version | 20.x (set in Project → Settings → General) |
| Function Region | default (or pick `iad1` Washington DC for Roblox-friendly latency) |

---

## Why Vercel Pro ($20/mo) is recommended

The `/api/refresh` and `/api/proxy-check` routes can run up to 60 seconds when testing a large proxy pool. Vercel caps this:

| Plan | Max function duration |
|---|---|
| Hobby (free) | **10 seconds** — will timeout mid-refresh with >20 proxies |
| Pro | **60 seconds** (configured via `vercel.json`) |
| Enterprise | 300 seconds |

**Fix on Hobby:** toggle "Skip liveness test" in the UI, paste ≤20 known-good proxies. The refresh itself completes in ~5s once proxies are validated. Proxy *testing* is what burns the time budget.

---

## Common Vercel deploy errors + fixes

### 1. `Function timeout` (Hobby)
```
FUNCTION_INVOCATION_TIMEOUT
```
**Fix:** Upgrade to Pro, OR use the "Skip liveness test" toggle + ≤20 proxies.

### 2. `Module not found: undici` or `socks-proxy-agent`
The build must include `undici` and `socks-proxy-agent` in `package.json`. Both are listed in dependencies. If you regenerate `package.json`, re-add:
```bash
npm install undici socks-proxy-agent
```

### 3. `Edge runtime doesn't support Node.js modules`
We do NOT use Edge runtime — both routes set `export const runtime = "nodejs"`. If you copy-paste code into a new file, ensure you keep that line.

### 4. `ECONNREFUSED` / `socket hang up` on proxies
This is expected on free datacenter proxies. The liveness tester filters these out automatically. If ALL your proxies fail liveness:
- You're probably using scraped DC proxies (OVH, DigitalOcean, AWS)
- Roblox's risk engine blocks these ASNs at the edge
- Solution: buy residential/ISP proxies (IPRoyal ISP, Bright Data ISP, NetNut, SOAX)

### 5. `413 Payload Too Large` when uploading proxy list
Vercel limits request bodies to 4.5MB on Pro. The bundled sample lists are ~452KB total — fine. If you upload >4MB of proxies, split the list.

### 6. `Stream ended unexpectedly`
Vercel buffers SSE in some edge regions. We already set `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform` on the response. If still failing, force the function region to `iad1`:
```json
// vercel.json
{
  "regions": ["iad1"],
  "functions": { ... }
}
```

### 7. `MODULE_NOT_FOUND: .prisma/client`
The scaffold includes Prisma but we don't use the DB. If build fails on `@prisma/client`:
```bash
npm uninstall @prisma/client prisma
rm -rf prisma
rm src/lib/db.ts
```

### 8. Hydration mismatch warning
The page uses `localStorage` to persist the proxy list, wrapped in a `useEffect` — this is safe. If you see hydration warnings, ensure no SSR-only code is added.

---

## Post-deploy verification

After your first production deploy:

1. Visit `https://<your-app>.vercel.app/`
2. Paste a fake cookie like `|Warning:fake123` to confirm the error path works
3. Paste a small proxy list (5 lines) and toggle "Skip liveness test" ON
4. Click "Run Refresh" — you should see streaming logs within 2s
5. Switch to the "Endpoints" tab to confirm probes are recorded

If all 5 work, your deploy is healthy.

---

## Project structure (what gets deployed)

```
src/
├── app/
│   ├── page.tsx                    ← dark theme UI
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── refresh/route.ts        ← SSE streaming refresh endpoint
│       └── proxy-check/route.ts    ← bulk proxy liveness tester
├── lib/
│   ├── proxy.ts                    ← parser + rotator + tester
│   └── roblox.ts                   ← Roblox auth + cookie capture
├── components/ui/                  ← shadcn components (pre-installed)
└── hooks/
public/
└── samples/
    ├── http-proxies.txt            ← 9,946 HTTP proxies bundled
    └── socks5-proxies.txt          ← 7,063 SOCKS5 proxies bundled
vercel.json                         ← maxDuration=60 on API routes
package.json                        ← Node 20+, undici + socks-proxy-agent
```

---

## If your refresh never succeeds

In order of likelihood:

1. **Cookie is already dead** — Roblox invalidated it for a reason other than IP (account ban, password change, manual logout). The `/api/refresh` returns `9002` if so. No tool can refresh a dead cookie.
2. **Proxy pool is all datacenter** — Roblox rejects DC ASNs on auth endpoints. Need ISP/residential.
3. **Cookie was already IP-unbound** — sometimes Roblox issues cookies without IP binding (especially for accounts with 2FA enabled). The original cookie already works from any IP, so no refresh is emitted. This is actually the best case — your cookie is already good.
4. **All proxies are too geographically distant** — Roblox flags >1000mi jumps. Pick proxies within 500mi of the original cookie's issuing IP.
5. **Account has 2FA / suspicious login protection** — refresh may require a challenge that no proxy can bypass.

The tool's "Endpoints" tab shows the exact HTTP status from each probe — read those to diagnose.

---

## CLI quick-deploy (one-liner)

```bash
curl -fsSL https://z-cdn.chatglm.cn/fullstack/init-fullstack.sh | bash 2>/dev/null; \
npm install undici socks-proxy-agent; \
npx vercel --prod --yes
```

That's it. Ship it.
