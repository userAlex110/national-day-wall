/**
 * 电脑端 / 手机端预览与体检。
 *
 * 一次跑完：每个设备尺寸都截图 + 量真实几何，最后生成一张对照页。
 *
 * 为什么不直接用 scripts/shoot.mjs：那个只能截图。而「照片有没有被白边裁掉」
 * 这种事在图上很难判断——差几个像素的边界肉眼量不准。这里的几何是走
 * Chrome DevTools Protocol 直接读 DOM 的，是确切数字。
 *
 *   npm run devices                       # 全部设备，本地构建
 *   npm run devices -- 手机                # 只要手机那组
 *   npm run devices -- --url=https://national-day-wall.pages.dev/
 *   npm run devices -- --light=night       # 夜景
 *
 * 产出：preview/ 下的截图 + preview/index.html（对照页，直接用浏览器打开）
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "preview");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5177;
const CDP_PORT = 9333;

/**
 * 设备清单。
 * 「矮窗口」和两个横屏是特意留的：它们的可用高度只剩 250px 上下，
 * 是 21 张照片最容易挤成一小撮、或者整面墙顶穿视口的地方。
 */
const DEVICES = [
  { group: "电脑", name: "1920×1080", w: 1920, h: 1080 },
  { group: "电脑", name: "1440×900", w: 1440, h: 900 },
  { group: "电脑", name: "1280×800", w: 1280, h: 800 },
  { group: "电脑", name: "1280×600", w: 1280, h: 600, note: "矮窗口" },
  { group: "平板", name: "834×1112", w: 834, h: 1112, touch: true },
  { group: "手机", name: "430×932", w: 430, h: 932, touch: true },
  { group: "手机", name: "390×844", w: 390, h: 844, touch: true },
  { group: "手机", name: "360×640", w: 360, h: 640, touch: true },
  { group: "手机", name: "844×390", w: 844, h: 390, touch: true, note: "横屏" },
  { group: "手机", name: "667×375", w: 667, h: 375, touch: true, note: "横屏小机" },
];

const argv = process.argv.slice(2);
let url = "";
let group = "";
let light = "day";
for (const a of argv) {
  if (a.startsWith("--url=")) url = a.slice(6);
  else if (a.startsWith("--light=")) light = a.slice(8);
  else if (a === "电脑" || a === "手机" || a === "平板") group = a;
  else if (a.startsWith("http")) url = a;
}

const devices = group ? DEVICES.filter((d) => d.group === group) : DEVICES;
if (!devices.length) {
  console.error(`没有叫「${group}」的设备组。可选：电脑 / 手机 / 平板`);
  process.exit(1);
}

for (const bin of [CHROME]) {
  if (!existsSync(bin)) {
    console.error(`找不到 Chrome：${bin}\n这个脚本用系统 Chrome 的无头模式，装一个再跑。`);
    process.exit(1);
  }
}

// 本地构建 / 线上地址
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
let preview = null;

if (!url) {
  console.log("构建…");
  await new Promise((res, rej) => {
    const b = spawn("npm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
    b.on("exit", (c) => (c === 0 ? res() : rej(new Error("构建失败"))));
  });
  preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  procs.push(preview);
  url = `http://localhost:${PORT}/`;
  // 等端口起来
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      break;
    } catch {
      await sleep(250);
    }
  }
}

const base = `${url}${url.includes("?") ? "&" : "?"}light=${light}`;

// ── 起 Chrome ────────────────────────────────────────────────────────
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    `--user-data-dir=/tmp/ndw-preview-${Date.now()}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);
procs.push(chrome);

async function debuggerUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* 端口还没起来 */
    }
    await sleep(250);
  }
  throw new Error("Chrome 调试端口没起来");
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const hit = pending.get(m.id);
  if (hit) {
    pending.delete(m.id);
    if (m.error) hit.reject(new Error(`${m.error.message}`));
    else hit.resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");

/**
 * 体检探针。
 *
 * 可见下边界取「底坞的上沿」而不是墙的盒子——舞台溢出的时候墙的盒子会
 * 跑到坞下面去，拿它当基准会把 bug 量成正常（这正是第一版误判的来源）。
 */
const PROBE = `JSON.stringify((() => {
  const box = (el) => { const r = el.getBoundingClientRect();
    return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left),
             r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
  const wall = document.getElementById('wall');
  const plane = document.getElementById('plane');
  const w = box(wall), p = box(plane);
  const scrollable = wall.classList.contains('is-scrollable');
  // 没有底坞了：能滚的墙下沿是平面底，一屏看全的墙下沿就是视口底
  const floor = scrollable ? p.b : innerHeight;

  let photoB = -1e9, photoR = -1e9, photoArea = 0, photos = 0, minW = 1e9, maxW = 0;
  const stickers = [...document.querySelectorAll('.sticker')];
  for (const s of stickers) {
    const r = s.getBoundingClientRect(); photos++;
    photoArea += r.width * r.height;
    photoB = Math.max(photoB, r.bottom);
    photoR = Math.max(photoR, r.right);
    minW = Math.min(minW, r.width);
    maxW = Math.max(maxW, r.width);
  }
  if (!photos) { minW = 0; maxW = 0; }

  // 每一张都必须带白边，且可见照片区要和原图同比例（framedH 的验收）
  //
  // 这里必须用 offsetWidth/offsetHeight，不能用 getBoundingClientRect()：
  // 后者返回的是「变换之后」的轴对齐包围盒，而贴纸带着 rotateZ(±5.5°) 和
  // rotateY 透视，一个 200×260 的盒子转 5.5° 包围盒就变成 224×278，
  // 比例凭空多出 5% —— 那会被误读成「照片被裁了」。
  let printless = 0, worstCrop = 0;
  for (const s of stickers) {
    if (!s.classList.contains('sticker--print')) printless++;
    const img = s.querySelector('img');
    if (!img || !img.naturalWidth || !img.offsetHeight) continue;
    const src = img.naturalWidth / img.naturalHeight;
    const got = img.offsetWidth / img.offsetHeight;
    worstCrop = Math.max(worstCrop, Math.abs(1 - got / src));
  }

  const wallArea = Math.max(1, (p.r - p.l) * p.h);
  return {
    vw: innerWidth, vh: innerHeight,
    wall: w, plane: p,
    scrollable, photos, printless,
    // 体检
    photoOverFloor: Math.round(photoB - floor),
    photoOverRight: Math.round(photoR - w.r),
    // 诊断
    minStickerW: Math.round(minW),
    maxStickerW: Math.round(maxW),
    photoAreaPct: Math.round((photoArea / wallArea) * 1000) / 10,
    worstCropPct: Math.round(worstCrop * 1000) / 10,
  };
})())`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const rows = [];
for (const dev of devices) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: dev.w,
    height: dev.h,
    deviceScaleFactor: 1,
    mobile: Boolean(dev.touch),
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: Boolean(dev.touch), maxTouchPoints: 5 });
  await send("Page.navigate", { url: base });
  await sleep(2800); // 等布局 + 弹簧落定

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = `${dev.group}-${dev.name}.png`;
  writeFileSync(path.join(OUT, file), Buffer.from(shot.data, "base64"));

  const ev = await send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
  const m = JSON.parse(ev.result.value);
  rows.push({ ...dev, file, m });
  process.stdout.write(`  ✓ ${dev.group} ${dev.name}\n`);
}

ws.close();
for (const p of procs) p.kill("SIGKILL");

// ── 判定 ─────────────────────────────────────────────────────────────
/**
 * 体检项。只判「该不该发生」，不判「好不好看」——
 * 排版审美是主观的，但这几条越界是客观的。
 */
function verdict(m) {
  const fails = [];
  if (m.photoOverRight > 0) fails.push(`照片越右沿 ${m.photoOverRight}px`);
  if (m.photoOverFloor > 0) fails.push(`照片越下沿 ${m.photoOverFloor}px`);
  if (m.printless > 0) fails.push(`${m.printless} 张没有拍立得白边`);
  // 白边是往里压的：可见照片区必须和原图同比例，否则 object-fit: cover 正在裁照片。
  // 这条是 sticker.ts 里 framedH() 的验收——容差 2%，留一点 getBoundingClientRect 的取整。
  if (m.worstCropPct > 2) fails.push(`照片被裁 ${m.worstCropPct}%（可见区比例和原图对不上）`);
  return fails;
}

const groups = [...new Set(rows.map((r) => r.group))];
const report = [];

for (const g of groups) {
  const list = rows.filter((r) => r.group === g);
  const bad = list.filter((r) => verdict(r.m).length);
  report.push(`${bad.length ? "✗" : "✓"} ${g}  ${list.length - bad.length}/${list.length}`);
  for (const r of list) {
    const f = verdict(r.m);
    console.log(
      `\n${f.length ? "❌" : "✅"} ${r.group} ${r.name}${r.note ? `（${r.note}）` : ""}` +
        `   可见墙 ${r.m.wall.w}×${r.m.wall.h}   视口 ${r.m.vw}×${r.m.vh}` +
        `${r.m.scrollable ? `   [墙内滚动 · 画布高 ${r.m.plane.h}]` : ""}`,
    );
    console.log(
      `   照片 ${r.m.photos} 张（占墙面 ${r.m.photoAreaPct}%）` +
        `   贴纸宽 ${r.m.minStickerW}–${r.m.maxStickerW}px` +
        `   最大裁切 ${r.m.worstCropPct}%`,
    );
    console.log(f.length ? `   ❌ ${f.join("；")}` : "   ✅ 体检全过");
  }
}

console.log();
for (const line of report) console.log(`  ${line}`);
if (rows.some((r) => verdict(r.m).length)) process.exitCode = 1;

// ── 对照页 ───────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>国庆挂历墙 · 设备对照</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px; background: #1b1a17; color: #e8e3d8;
         font: 13px/1.6 ui-monospace, "SF Mono", Menlo, monospace; }
  h1 { font-size: 15px; letter-spacing: .1em; margin: 0 0 6px; font-weight: 600; }
  .meta { color: #8d8779; margin-bottom: 26px; }
  h2 { font-size: 12px; letter-spacing: .18em; color: #8d8779; margin: 34px 0 14px;
       border-top: 1px solid #33302a; padding-top: 14px; }
  .grid { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
  figure { margin: 0; }
  figcaption { padding-bottom: 8px; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .nm { font-weight: 600; }
  .tag { color: #8d8779; }
  .ok { color: #7fb069; }
  .bad { color: #e2725b; }
  img { display: block; border: 1px solid #3a342c; background: #000; max-width: 100%; height: auto; }
  .box { overflow: auto; max-height: 78vh; }
  .box.wide img { width: 760px; }
  .box.tall img { height: 620px; width: auto; }
</style>
</head>
<body>
<h1>国庆挂历墙 · 设备对照</h1>
<p class="meta">${esc(base)} · 生成于 ${new Date().toLocaleString("zh-CN")}</p>
${groups
  .map(
    (g) => `<h2>${esc(g)}</h2>
<div class="grid">
${rows
  .filter((r) => r.group === g)
  .map((r) => {
    const f = verdict(r.m);
    return `  <figure>
    <figcaption><span class="nm">${esc(r.name)}</span>${
      r.note ? `<span class="tag">${esc(r.note)}</span>` : ""
    }<span class="${f.length ? "bad" : "ok"}">${f.length ? esc(f.join("；")) : "五项体检全过"}</span></figcaption>
    <div class="box${r.w > r.h ? " wide" : " tall"}"><img src="${esc(r.file)}" width="${r.w}" height="${r.h}" alt="${esc(r.name)}"></div>
  </figure>`;
  })
  .join("\n")}
</div>`,
  )
  .join("\n")}
</body>
</html>`;
writeFileSync(path.join(OUT, "index.html"), html);

console.log(`\n对照页：${path.relative(ROOT, path.join(OUT, "index.html"))}`);
console.log(`  open ${path.join(OUT, "index.html")}`);
