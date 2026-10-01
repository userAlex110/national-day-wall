/**
 * 多尺寸截图。用系统 Chrome 的 headless 模式，比浏览器工具更可控：
 * 视口可以任意指定、可以并行、不会受窗口可见性影响。
 *
 *   node scripts/shoot.mjs                       # 默认五档
 *   node scripts/shoot.mjs 1440x900 390x844      # 只拍这两档
 *   node scripts/shoot.mjs --night               # 夜景
 *   node scripts/shoot.mjs --url=/?light=night   # 换地址
 *   node scripts/shoot.mjs --out=/tmp/shots      # 换输出目录
 */
import { spawn, execSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.NDW_URL ?? "http://localhost:5177";

const argv = process.argv.slice(2);
let out = "/tmp/shots";
let url = "";
let night = false;
let vt = 0;
const sizes = [];
for (const a of argv) {
  if (a.startsWith("--out=")) out = a.slice(6);
  else if (a.startsWith("--url=")) url = a.slice(6);
  else if (a === "--night") night = true;
  else if (a.startsWith("--vt=")) vt = Number(a.slice(5));
  else if (/^\d+x\d+$/.test(a)) sizes.push(a);
}
if (!sizes.length) sizes.push("1440x900", "1280x800", "834x1112", "390x844", "360x640");

if (!url) url = `${BASE}/${night ? "?light=night" : "?light=day"}`;

mkdirSync(out, { recursive: true });
const jobs = [];
for (const s of sizes) {
  const [w, h] = s.split("x").map(Number);
  const file = path.join(out, `${s}${night ? "-night" : ""}.png`);
  rmSync(file, { force: true });
  const profile = path.join(os.tmpdir(), `ndw-shot-${s}-${Date.now()}`);
  jobs.push({ s, w, h, file, profile });
}

const running = jobs.map((j) => {
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    "--force-color-profile=srgb",
    `--user-data-dir=${j.profile}`,
    `--screenshot=${j.file}`,
    `--window-size=${j.w},${j.h}`,
    "--timeout=8000",
  ];
  // 页面里有 setTimeout 时，截图会早于内容生成；虚拟时间让它先跑完
  if (vt > 0) args.push(`--virtual-time-budget=${vt}`);
  args.push(url);
  return { j, child: spawn(CHROME, args, { stdio: "ignore", detached: false }) };
});

// Chrome 写完 png 后不会自己退出，轮询文件大小稳定即算完成
const deadline = Date.now() + Number(process.env.NDW_DEADLINE ?? 60000);
const done = new Set();
while (done.size < jobs.length && Date.now() < deadline) {
  for (const { j } of running) {
    if (done.has(j.s)) continue;
    if (!existsSync(j.file)) continue;
    const a = statSync(j.file).size;
    if (a < 3000) continue;
    execSync(`sleep 0.4`);
    if (statSync(j.file).size === a) done.add(j.s);
  }
  if (done.size < jobs.length) execSync("sleep 0.5");
}

for (const { child } of running) child.kill("SIGKILL");
for (const j of jobs) rmSync(j.profile, { recursive: true, force: true });

// 1.5MB 的 png 太大，转成 jpeg 方便自己看
for (const f of readdirSync(out)) {
  if (!f.endsWith(".png")) continue;
  const src = path.join(out, f);
  execSync(`sips -s format jpeg -s formatOptions 74 "${src}" --out "${src.replace(/\.png$/, ".jpg")}" >/dev/null`);
}

for (const j of jobs) {
  const jpg = j.file.replace(/\.png$/, ".jpg");
  console.log(
    existsSync(jpg)
      ? `✓ ${path.basename(jpg)}  ${(statSync(jpg).size / 1024).toFixed(0)}KB`
      : `✗ ${j.s} 超时`,
  );
}
if (done.size < jobs.length) process.exitCode = 1;
