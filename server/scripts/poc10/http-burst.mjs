import http from "node:http";

const [,, url, nStr, roundsStr, timeoutStr] = process.argv;
const n = Number(nStr ?? 300), rounds = Number(roundsStr ?? 3), timeoutMs = Number(timeoutStr ?? 15000);
if (!url) { console.error("用法: node httpburst.mjs <url> [n] [rounds] [timeoutMs]"); process.exit(2); }

const ctrl = http.createServer((q, s) => { s.writeHead(200); s.end("x".repeat(2000)); });
await new Promise((r) => ctrl.listen(8123, "127.0.0.1", r));

async function burst(target, tag) {
  const t0 = Date.now();
  const results = await Promise.all(Array.from({ length: n }, (_, i) => (async () => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(target + (target.includes("?") ? "&" : "?") + "burst=" + tag + "-" + i, { signal: ctl.signal });
      await res.arrayBuffer();
      return res.ok ? "ok" : "http" + res.status;
    } catch (e) {
      return "err:" + (e?.name === "AbortError" ? "timeout" : (e?.cause?.code ?? e?.name ?? "unknown"));
    } finally { clearTimeout(t); }
  })()));
  const tally = {};
  for (const s of results) tally[s] = (tally[s] ?? 0) + 1;
  console.log(`${tag}: ${Date.now() - t0}ms (n=${n})  ${JSON.stringify(tally)}`);
}

for (let r = 0; r < rounds; r++) {
  await burst("http://127.0.0.1:8123/", `control-r${r}`);
  await burst(url, `target-r${r}`);
}
ctrl.close();
