#!/usr/bin/env node
// ============================================================
// LibiaoLink · LibreTranslate 模型预置（deploy/libretranslate/scripts/seed-models.mjs）
// ------------------------------------------------------------
// 作用：把 LibreTranslate 首启要外网取的模型文件先灌进 ./data/argos（compose 挂载目录）：
//   1) MiniSBD 分句模型（必需，~0.8MB）：en.onnx / zh-hans.onnx
//      来源 GitHub Releases —— 办公网 TLS 时通时断，容器内下载失败高发，本脚本兜底；
//   2) --with-packages：zh↔en 语言包（~165MB），来源 argos-net.com，
//      下载后用本机 libretranslate 镜像内的 argostranslate 解包安装进 data/argos/packages。
//
// 用法（在 deploy/libretranslate 下）：
//   node scripts/seed-models.mjs                  # 只预置分句模型
//   node scripts/seed-models.mjs --with-packages  # 连语言包一起预置（容器首启可全离线）
//   node scripts/seed-models.mjs --force          # 已存在也重下
//
// 备注：HTTPS 走 Node 原生 https，rejectUnauthorized=false —— 兼容办公网网关替换证书；
//       下载对象均为公开模型文件，且写盘前做字节数校验（分句模型为固定大小）。
// ============================================================
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(rootDir, "data", "argos");
const minisbdDir = path.join(dataDir, "minisbd");
const seedDir = path.join(dataDir, "seed");

const argv = new Set(process.argv.slice(2));
const force = argv.has("--force");
const withPackages = argv.has("--with-packages");

const MINISBD_FILES = [
  {
    name: "en.onnx",
    bytes: 188043,
    url: "https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/en.onnx",
  },
  {
    name: "zh-hans.onnx",
    bytes: 616442,
    url: "https://github.com/LibreTranslate/MiniSBD/releases/download/v0.0.1/zh-hans.onnx",
  },
];

const LANGUAGE_PACKAGES = [
  { name: "translate-zh_en-1_9.argosmodel", url: "https://argos-net.com/v1/translate-zh_en-1_9.argosmodel" },
  { name: "translate-en_zh-1_9.argosmodel", url: "https://argos-net.com/v1/translate-en_zh-1_9.argosmodel" },
];

function downloadFile(url, dest, redirectsLeft) {
  const left = redirectsLeft === undefined ? 5 : redirectsLeft;
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { rejectUnauthorized: false, headers: { "user-agent": "libiaolink-seed/1.0" } },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) {
            reject(new Error("重定向次数过多: " + url));
            return;
          }
          downloadFile(new URL(res.headers.location, url).toString(), dest, left - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error("HTTP " + status + " " + url));
          return;
        }
        const type = String(res.headers["content-type"] || "");
        if (type.includes("text/html")) {
          res.resume();
          reject(new Error("被网关或代理拦截（返回 HTML 而非文件）: " + url));
          return;
        }
        const total = Number(res.headers["content-length"] || 0);
        let got = 0;
        let lastPct = -10;
        const tmp = dest + ".part";
        const out = fs.createWriteStream(tmp);
        res.on("data", (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.floor((got / total) * 100);
            if (pct >= lastPct + 10) {
              lastPct = pct - (pct % 10);
              process.stdout.write("\r    " + path.basename(dest) + " " + lastPct + "%");
            }
          }
        });
        res.on("error", reject);
        out.on("error", reject);
        out.on("finish", () => {
          out.close(() => {
            if (total > 0 && got !== total) {
              try { fs.unlinkSync(tmp); } catch (err) { void err; }
              reject(new Error("下载不完整：" + got + " / " + total + " 字节"));
              return;
            }
            fs.renameSync(tmp, dest);
            process.stdout.write("\r    " + path.basename(dest) + " 完成（" + got + " 字节）\n");
            resolve(got);
          });
        });
        res.pipe(out);
      },
    );
    req.on("error", reject);
    req.setTimeout(180000, () => {
      req.destroy(new Error("超时（180 秒无响应）: " + url));
    });
  });
}

function toDockerPath(p) {
  return path.resolve(p).replace(/\\/g, "/");
}

async function main() {
  fs.mkdirSync(minisbdDir, { recursive: true });

  console.log("[1/2] MiniSBD 分句模型 → " + minisbdDir);
  for (const f of MINISBD_FILES) {
    const dest = path.join(minisbdDir, f.name);
    if (fs.existsSync(dest) && !force) {
      console.log("    跳过（已存在）: " + f.name);
      continue;
    }
    try {
      const got = await downloadFile(f.url, dest);
      if (f.bytes && got !== f.bytes) {
        throw new Error("字节数不符：期望 " + f.bytes + "，实得 " + got);
      }
    } catch (err) {
      console.error("    失败: " + f.name + " —— " + err.message);
      console.error("    处理：换台能上外网的机器重跑本脚本，或手工把文件放到 " + minisbdDir + " 后重跑。");
      process.exitCode = 1;
      return;
    }
  }

  if (!withPackages) {
    console.log("[2/2] 语言包：未指定 --with-packages，跳过。");
    console.log("    容器首启会自行下载 zh↔en 语言包（约 165MB，来源 argos-net.com）；");
    console.log("    要全离线首启请重跑：node scripts/seed-models.mjs --with-packages");
    return;
  }

  fs.mkdirSync(seedDir, { recursive: true });
  console.log("[2/2] 语言包 → " + seedDir);
  for (const p of LANGUAGE_PACKAGES) {
    const dest = path.join(seedDir, p.name);
    if (fs.existsSync(dest) && !force) {
      console.log("    跳过（已存在）: " + p.name);
      continue;
    }
    try {
      await downloadFile(p.url, dest);
    } catch (err) {
      console.error("    失败: " + p.name + " —— " + err.message);
      process.exitCode = 1;
      return;
    }
  }

  const image = process.env.LT_IMAGE || "libretranslate/libretranslate:latest";
  console.log("    用镜像内 argostranslate 解包安装到 data/argos/packages（image=" + image + "）...");
  const installCode =
    "import sys; from argostranslate import package; [package.install_from_path(p) for p in sys.argv[1:]]";
  const dockerArgs = [
    "run",
    "--rm",
    "--entrypoint",
    "/app/venv/bin/python",
    "-v",
    toDockerPath(dataDir) + ":/home/libretranslate/.local/share/argos-translate",
    "-v",
    toDockerPath(seedDir) + ":/seed:ro",
    image,
    "-c",
    installCode,
    "/seed/" + LANGUAGE_PACKAGES[0].name,
    "/seed/" + LANGUAGE_PACKAGES[1].name,
  ];
  const run = spawnSync("docker", dockerArgs, { stdio: "inherit" });
  if (run.error) {
    console.error("    调用 docker 失败：" + run.error.message);
    process.exitCode = 1;
    return;
  }
  if (run.status !== 0) {
    console.error("    安装失败（docker 退出码 " + run.status + "）。");
    process.exitCode = 1;
    return;
  }

  const installed = fs
    .readdirSync(path.join(dataDir, "packages"))
    .filter((n) => n.startsWith("translate-"));
  console.log("    已安装语言包：" + (installed.length ? installed.join("、") : "（空，异常）"));
  console.log("预置完成。下一步：docker compose up -d");
}

main().catch((err) => {
  console.error("未预期错误：" + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
