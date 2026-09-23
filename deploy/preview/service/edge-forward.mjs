#!/usr/bin/env node
/**
 * LibiaoLink 预览沙箱 · 边缘转发（哑 TCP 中继，仅沙箱 dev 形态需要）
 * ============================================================================
 * 为什么需要它：技术设计 v0.3 §3.5 / ADR-007 要求转换器「无外网」。Docker 的
 * internal 网络能真断外网，但**同时断掉了端口发布**（本机实证：internal 网络下
 * 127.0.0.1 映射与容器 IP 直连都不通）。于是把两件事拆开：
 *   - converter：只挂 internal 网络（真无外网），不发布端口；
 *   - edge（本进程）：同一镜像、不同命令，挂 internal + 普通网络，把
 *     127.0.0.1:${PREVIEW_CONVERTER_PORT} 的 TCP 字节原样转给 converter。
 * 本进程只做字节搬运，不解析文件内容、不落盘、无状态。
 * 生产形态（M8）不需要它：worker 与 converter 同处 internal 网络，直接用服务名互连。
 */
import { createServer, connect } from "node:net";

const LISTEN_HOST = process.env.EDGE_LISTEN_HOST ?? "0.0.0.0";
const LISTEN_PORT = intEnv("EDGE_LISTEN_PORT", 9900);
const UPSTREAM_HOST = process.env.EDGE_UPSTREAM_HOST ?? "converter";
const UPSTREAM_PORT = intEnv("EDGE_UPSTREAM_PORT", 9900);

let accepted = 0;
let active = 0;

const server = createServer((client) => {
  accepted += 1;
  active += 1;
  const upstream = connect(UPSTREAM_PORT, UPSTREAM_HOST);
  const teardown = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", teardown);
  upstream.on("error", (err) => {
    log({ level: "warn", event: "upstream_error", message: err.message, upstream: UPSTREAM_HOST + ":" + UPSTREAM_PORT });
    teardown();
  });
  client.pipe(upstream);
  upstream.pipe(client);
  const done = () => {
    active -= 1;
  };
  client.on("close", () => {
    upstream.destroy();
    done();
  });
  upstream.on("close", () => client.destroy());
  client.setNoDelay(true);
  upstream.setNoDelay(true);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  log({ level: "info", event: "forwarding", listen: LISTEN_HOST + ":" + LISTEN_PORT, upstream: UPSTREAM_HOST + ":" + UPSTREAM_PORT });
});

setInterval(() => {
  if (active > 0) log({ level: "debug", event: "stats", accepted, active });
}, 60000).unref();

function intEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function log(fields) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: "preview-edge", ...fields }) + "\n");
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log({ level: "info", event: "shutdown", signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
