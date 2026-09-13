"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  Cookie,
  Network,
  Play,
  Loader2,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Zap,
  Globe,
  ShieldAlert,
  Trash2,
  Upload,
  Server,
} from "lucide-react";

interface LogEntry {
  ts: number;
  type: "progress" | "error" | "warn" | "info" | "success";
  message: string;
}

interface ProxyProgress {
  tested: number;
  total: number;
  alive: number;
}

interface RefreshResult {
  originalCookie: string;
  refreshedCookie?: string;
  refreshSource?: string;
  originalState: {
    isValid: boolean;
    userId?: number;
    username?: string;
    displayName?: string;
    error?: string;
  };
  refreshedState?: {
    isValid: boolean;
    username?: string;
    userId?: number;
  };
  proxiesTried: number;
  successProxy?: {
    host: string;
    port: number;
    country?: string;
    externalIp?: string;
  };
  endpoints: Array<{
    endpoint: string;
    method: string;
    status: number;
    durationMs: number;
    error?: string;
  }>;
  summary: string;
}

export default function Home() {
  const [cookie, setCookie] = useState("");
  const [proxyList, setProxyList] = useState("");
  const [skipProxyTest, setSkipProxyTest] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [proxyProgress, setProxyProgress] = useState<ProxyProgress | null>(null);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs((prev) => [...prev, { ts: Date.now(), type, message }]);
  }, []);

  const onFile = useCallback(async (file: File) => {
    const text = await file.text();
    setProxyList(text);
    toast({
      title: "Proxy list loaded",
      description: `${text.split(/\r?\n/).filter(Boolean).length} lines loaded from ${file.name}`,
    });
  }, [toast]);

  const handleRefresh = useCallback(async () => {
    if (!cookie.trim()) {
      toast({ title: "Cookie required", variant: "destructive" });
      return;
    }
    if (!proxyList.trim()) {
      toast({ title: "Proxy list required", variant: "destructive" });
      return;
    }

    setRunning(true);
    setLogs([]);
    setProxyProgress(null);
    setResult(null);
    addLog("info", "→ Initiating refresh sequence...");

    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookie: cookie.trim(),
          proxyList,
          skipProxyTest,
        }),
      });

      if (!res.body) {
        addLog("error", "No response body from server.");
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const dataLine = evt.trim();
          if (!dataLine.startsWith("data: ")) continue;
          const jsonStr = dataLine.slice(6);
          try {
            const obj = JSON.parse(jsonStr);
            if (obj.type === "progress") addLog("info", obj.message);
            else if (obj.type === "error") addLog("error", obj.message);
            else if (obj.type === "warn") addLog("warn", obj.message);
            else if (obj.type === "proxy-progress") setProxyProgress(obj);
            else if (obj.type === "done") {
              setResult(obj.result);
              if (obj.result.refreshedCookie) addLog("success", "Refresh successful.");
              else addLog("warn", "Refresh completed but no new cookie captured.");
            }
          } catch {
            // ignore malformed
          }
        }
      }
    } catch (err: any) {
      addLog("error", err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  }, [cookie, proxyList, skipProxyTest, addLog, toast]);

  const copyResult = useCallback(() => {
    if (result?.refreshedCookie) {
      navigator.clipboard.writeText(result.refreshedCookie);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const clearAll = useCallback(() => {
    setCookie("");
    setProxyList("");
    setLogs([]);
    setResult(null);
    setProxyProgress(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("rbx_proxy_list");
    if (stored) setProxyList(stored);
  }, []);

  useEffect(() => {
    if (proxyList) localStorage.setItem("rbx_proxy_list", proxyList);
  }, [proxyList]);

  const aliveCount = result
    ? result.proxiesTried > 0
      ? "tested"
      : 0
    : 0;

  return (
    <div className="min-h-screen bg-[#0a0b0f] text-zinc-100 font-sans antialiased">
      <style jsx global>{`
        body { background: #0a0b0f; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #0a0b0f; }
        ::-webkit-scrollbar-thumb { background: #2a2d3a; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a3d4a; }
        .glow {
          box-shadow: 0 0 24px -4px rgba(217, 70, 239, 0.35);
        }
        .grid-bg {
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(217, 70, 239, 0); }
          50% { box-shadow: 0 0 20px 2px rgba(217, 70, 239, 0.25); }
        }
        .pulse-glow { animation: pulse-glow 2.5s ease-in-out infinite; }
      `}</style>

      <div className="grid-bg min-h-screen flex flex-col">
        <header className="border-b border-zinc-800/60 backdrop-blur-md bg-[#0a0b0f]/80 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-fuchsia-600 via-rose-600 to-amber-500 flex items-center justify-center glow">
                <ShieldAlert className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">RBX Cookie Refresher</h1>
                <p className="text-xs text-zinc-500">IP-lock bypass · proxy rotation · live capture</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                <Server className="w-3 h-3 mr-1" /> Vercel-ready
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="text-zinc-400 hover:text-zinc-100"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: INPUTS */}
          <div className="space-y-6">
            <Card className="bg-[#12131a] border-zinc-800/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cookie className="w-4 h-4 text-fuchsia-400" /> Roblox Cookie
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  Paste the <code className="text-fuchsia-300">.ROBLOSECURITY</code> value. Should start with <code className="text-fuchsia-300">|Warning</code> or <code className="text-fuchsia-300">|_</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="|Warning:...
long cookie string here
..."
                  className="font-mono text-xs bg-[#0a0b0f] border-zinc-800 min-h-[120px] text-zinc-200"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>{cookie.length} chars</span>
                  <span className={cookie.startsWith("|") ? "text-emerald-400" : "text-amber-400"}>
                    {cookie.startsWith("|") ? "Looks valid" : cookie ? "Unusual format" : "Empty"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#12131a] border-zinc-800/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Network className="w-4 h-4 text-fuchsia-400" /> Proxy Pool
                </CardTitle>
                <CardDescription className="text-zinc-500">
                  One per line. Supports <code className="text-fuchsia-300">http://</code>, <code className="text-fuchsia-300">socks5://</code>, <code className="text-fuchsia-300">ip:port</code>, <code className="text-fuchsia-300">ip:port:user:pass</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv,.list"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    className="bg-[#0a0b0f] border-zinc-800 text-zinc-300 hover:text-zinc-100"
                  >
                    <Upload className="w-4 h-4 mr-2" /> Upload .txt
                  </Button>
                  <div className="text-xs text-zinc-500 self-center ml-auto">
                    {proxyList.split(/\r?\n/).filter(Boolean).length} proxies loaded
                  </div>
                </div>
                <Textarea
                  value={proxyList}
                  onChange={(e) => setProxyList(e.target.value)}
                  placeholder={"http://1.2.3.4:8080\nsocks5://5.6.7.8:1080\n9.10.11.12:3128:user:pass"}
                  className="font-mono text-xs bg-[#0a0b0f] border-zinc-800 min-h-[200px] text-zinc-200"
                  spellCheck={false}
                />
                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    checked={skipProxyTest}
                    onCheckedChange={setSkipProxyTest}
                    id="skip"
                  />
                  <Label htmlFor="skip" className="text-xs text-zinc-400 cursor-pointer">
                    Skip liveness test (faster, but untested proxies will be tried)
                  </Label>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button
                onClick={handleRefresh}
                disabled={running || !cookie || !proxyList}
                className="flex-1 bg-gradient-to-r from-fuchsia-600 to-rose-600 hover:from-fuchsia-500 hover:to-rose-500 text-white font-semibold py-6 text-base disabled:opacity-40 disabled:cursor-not-allowed glow"
              >
                {running ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Refreshing...</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" /> Run Refresh</>
                )}
              </Button>
            </div>

            {proxyProgress && (
              <Card className="bg-[#12131a] border-zinc-800/60">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-2 text-xs">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Zap className="w-3 h-3 text-amber-400" /> Testing proxies
                    </span>
                    <span className="text-zinc-500">
                      {proxyProgress.tested}/{proxyProgress.total} · {proxyProgress.alive} alive
                    </span>
                  </div>
                  <Progress
                    value={(proxyProgress.tested / Math.max(1, proxyProgress.total)) * 100}
                    className="h-2 bg-zinc-800"
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: OUTPUT */}
          <div className="space-y-6">
            <Tabs defaultValue="result" className="w-full">
              <TabsList className="bg-[#12131a] border border-zinc-800/60 w-full">
                <TabsTrigger value="result" className="data-[state=active]:bg-fuchsia-600/20 data-[state=active]:text-fuchsia-300">
                  Result
                </TabsTrigger>
                <TabsTrigger value="logs" className="data-[state=active]:bg-fuchsia-600/20 data-[state=active]:text-fuchsia-300">
                  Live Logs
                </TabsTrigger>
                <TabsTrigger value="endpoints" className="data-[state=active]:bg-fuchsia-600/20 data-[state=active]:text-fuchsia-300">
                  Endpoints
                </TabsTrigger>
              </TabsList>

              <TabsContent value="result" className="mt-4">
                {!result ? (
                  <Card className="bg-[#12131a] border-dashed border-zinc-800">
                    <CardContent className="py-16 flex flex-col items-center justify-center text-center">
                      <Activity className="w-10 h-10 text-zinc-700 mb-3" />
                      <p className="text-zinc-500 text-sm">No result yet. Run a refresh to see the output here.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className={`border ${result.refreshedCookie ? "border-emerald-700/60 bg-emerald-950/20" : "border-amber-700/60 bg-amber-950/10"}`}>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          {result.refreshedCookie ? (
                            <><CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            <span className="font-semibold text-emerald-300">Cookie Refreshed</span></>
                          ) : (
                            <><AlertTriangle className="w-5 h-5 text-amber-400" />
                            <span className="font-semibold text-amber-300">No Refresh Captured</span></>
                          )}
                        </div>
                        <p className="text-sm text-zinc-300 mb-3">{result.summary}</p>

                        {result.successProxy && (
                          <div className="text-xs text-zinc-400 mb-3 flex items-center gap-2">
                            <Globe className="w-3 h-3 text-fuchsia-400" />
                            Success proxy: <code className="text-fuchsia-300">{result.successProxy.host}:{result.successProxy.port}</code>
                            {result.successProxy.country && <span className="text-zinc-500">· {result.successProxy.country}</span>}
                            {result.successProxy.externalIp && <span className="text-zinc-500">· exit IP {result.successProxy.externalIp}</span>}
                          </div>
                        )}

                        <Separator className="bg-zinc-800 my-3" />

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <div className="text-zinc-500 mb-1">Original session</div>
                            <div className="text-zinc-300">
                              {result.originalState.isValid ? (
                                <>
                                  <Badge variant="outline" className="border-emerald-700 text-emerald-300 mb-1">VALID</Badge>
                                  <div className="text-zinc-300">{result.originalState.username}</div>
                                  <div className="text-zinc-500 text-[10px]">id: {result.originalState.userId}</div>
                                </>
                              ) : (
                                <Badge variant="outline" className="border-rose-700 text-rose-300">INVALID</Badge>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500 mb-1">After refresh</div>
                            <div className="text-zinc-300">
                              {result.refreshedState?.isValid ? (
                                <>
                                  <Badge variant="outline" className="border-emerald-700 text-emerald-300 mb-1">VALID</Badge>
                                  <div>{result.refreshedState.username}</div>
                                  <div className="text-zinc-500 text-[10px]">id: {result.refreshedState.userId}</div>
                                </>
                              ) : (
                                <Badge variant="outline" className="border-zinc-700 text-zinc-500">N/A</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {result.refreshedCookie && (
                      <Card className="bg-[#12131a] border-zinc-800/60 pulse-glow">
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2">
                              <Cookie className="w-4 h-4 text-emerald-400" /> Refreshed .ROBLOSECURITY
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={copyResult}
                              className="text-zinc-400 hover:text-emerald-300 h-7"
                            >
                              {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                              <span className="ml-1 text-xs">{copied ? "Copied" : "Copy"}</span>
                            </Button>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="max-h-40 rounded bg-[#0a0b0f] p-3 border border-zinc-800/50">
                            <pre className="text-[10px] text-emerald-300 font-mono whitespace-pre-wrap break-all">
                              {result.refreshedCookie}
                            </pre>
                          </ScrollArea>
                          {result.refreshSource && (
                            <p className="text-[10px] text-zinc-500 mt-2">Captured via: {result.refreshSource}</p>
                          )}
                        </CardContent>
                      </Card>
                    )}

                    <Card className="bg-[#12131a] border-zinc-800/60">
                      <CardContent className="pt-4 grid grid-cols-3 gap-3 text-center">
                        <div>
                          <div className="text-xl font-bold text-fuchsia-300">{result.proxiesTried}</div>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Proxies Tried</div>
                        </div>
                        <div>
                          <div className="text-xl font-bold text-zinc-300">{result.endpoints.length}</div>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Endpoints Hit</div>
                        </div>
                        <div>
                          <div className="text-xl font-bold text-emerald-300">{result.refreshedCookie ? 1 : 0}</div>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">New Cookies</div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="logs" className="mt-4">
                <Card className="bg-[#0a0b0f] border-zinc-800/60">
                  <CardContent className="pt-4">
                    <ScrollArea className="h-[500px]">
                      <div className="space-y-1 font-mono text-xs">
                        {logs.length === 0 ? (
                          <div className="text-zinc-600 italic">Logs will appear here...</div>
                        ) : (
                          logs.map((l, i) => {
                            const time = new Date(l.ts).toLocaleTimeString();
                            const color =
                              l.type === "error" ? "text-rose-400" :
                              l.type === "warn" ? "text-amber-400" :
                              l.type === "success" ? "text-emerald-400" :
                              l.type === "info" ? "text-zinc-300" :
                              "text-zinc-400";
                            const icon =
                              l.type === "error" ? "✗" :
                              l.type === "warn" ? "!" :
                              l.type === "success" ? "✓" :
                              "→";
                            return (
                              <div key={i} className={`${color} flex gap-2`}>
                                <span className="text-zinc-600 shrink-0">{time}</span>
                                <span className="text-zinc-600 shrink-0">{icon}</span>
                                <span className="break-all">{l.message}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="endpoints" className="mt-4">
                <Card className="bg-[#0a0b0f] border-zinc-800/60">
                  <CardContent className="pt-4">
                    <ScrollArea className="h-[500px]">
                      <div className="space-y-2">
                        {(result?.endpoints ?? []).length === 0 ? (
                          <div className="text-zinc-600 italic text-sm">No endpoints probed yet.</div>
                        ) : (
                          (result?.endpoints ?? []).map((e, i) => {
                            const ok = e.status >= 200 && e.status < 400;
                            const warn = e.status === 0 || !!e.error;
                            return (
                              <div
                                key={i}
                                className="rounded border border-zinc-800/50 bg-[#12131a] p-2 text-xs"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Badge
                                      variant="outline"
                                      className={
                                        warn
                                          ? "border-rose-700 text-rose-300 shrink-0"
                                          : ok
                                          ? "border-emerald-700 text-emerald-300 shrink-0"
                                          : "border-amber-700 text-amber-300 shrink-0"
                                      }
                                    >
                                      {e.method}
                                    </Badge>
                                    <span className="font-mono text-zinc-300 truncate">{e.endpoint}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {e.error ? (
                                      <span className="text-rose-400 text-[10px]">{e.error.slice(0, 40)}</span>
                                    ) : (
                                      <span className={ok ? "text-emerald-400" : "text-amber-400"}>{e.status}</span>
                                    )}
                                    <span className="text-zinc-500 text-[10px]">{e.durationMs}ms</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </main>

        <footer className="border-t border-zinc-800/60 bg-[#0a0b0f] mt-auto">
          <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5 text-fuchsia-500" />
              <span>For authorized use on accounts you own. Run on your own infrastructure if you need higher proxy concurrency.</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-zinc-800 text-zinc-600">Next.js 16</Badge>
              <Badge variant="outline" className="border-zinc-800 text-zinc-600">Node runtime</Badge>
              <Badge variant="outline" className="border-zinc-800 text-zinc-600">Vercel-ready</Badge>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
