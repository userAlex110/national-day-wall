/**
 * 真照片管线。
 *
 * 用法：把照片丢进 photos/，跑 `npm run photos`，然后 `npm run deploy`。
 *
 * 文件名开头的数字就是它在墙上的位置：1x.jpg 放第 1 位、5x.jpg 放第 5 位。
 * 所以可以一张一张慢慢攒——放几张就换掉几位，剩下的位置保持原样
 * （通常是 make-demo-photos.mjs 铺的占位图）。墙上默认留 21 个位置，
 * 文件名里的数字超过 21 就以文件名为准。
 *
 * 为什么要有这个脚本：iPhone 拍出来是 HEIC，浏览器基本不认（Safari 认，微信不认）。
 * 直接把原图扔进 public/ 的话，一是体积，二是格式。所以这一步统一转成 WebP 三档，
 * 顺便取一个主色防止图片加载前白闪。
 *
 * 增量：按 mtime + size 记在 .cache.json 里。没动过的照片直接复用上次的结果，
 * 所以补一张照片重跑只要一两秒，不用重转全部。
 *
 * 文案（白条短句 + 背面故事）不在这里写，在根目录的 captions.json 里，见 main() 的注释。
 */

import { readdir, readFile, writeFile, stat, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "photos");
const OUT = path.join(ROOT, "public", "photos");
const CACHE_FILE = path.join(ROOT, ".cache.json");
const JSON_OUT = path.join(ROOT, "src", "data", "photos.json");

/** 三档宽度。480 首屏用，1080 点开用，1920 留着以后放大。 */
const WIDTHS = [
  { key: "thumb", w: 480 },
  { key: "card", w: 1080 },
  { key: "full", w: 1920 },
];
const QUALITY = 78;

/** EXIF 读不出来的时候，按文件名排。 */
const EXTS = [".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".avif"];

async function loadCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(c) {
  await writeFile(CACHE_FILE, JSON.stringify(c, null, 2));
}

/**
 * HEIC → JPEG。sips 是 macOS 自带的，不用装任何东西。
 * 只有 HEIC/HEIF 需要转 —— sips 转出来质量会掉，别的格式直接用 sharp 读就行。
 */
async function heicToJpeg(src, dst) {
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", src, "--out", dst]);
  return dst;
}

/** 从 EXIF 里挖 DateTimeOriginal（2026:10:01 19:23:41 → "2026:10:01 19:23:41"）。 */
function exifDate(buf) {
  if (!buf) return null;
  const s = buf.toString("latin1");
  // "DateTimeOriginal : 2026:10:01 19:23:41"
  const m = s.match(/DateTimeOriginal\s*[:\s]\s*(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  return null;
}

/**
 * 主色：缩到 8×8 取左上像素。
 * 不用 sharp.stats() 是因为它给的是均值，会把照片算成灰绿色一团，
 * 而我们要在图片加载前垫一块「大概这个颜色」，用左上角更接近真实观感。
 */
async function dominantColor(pathname) {
  const { data, info } = await sharp(pathname)
    .resize(8, 8, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // 按实际像素数走，别写死 64 —— fit:"inside" 出的是 8×6 或者 8×4，
  // 写死会把缓冲区后面的 undefined 一起加进去，颜色就成 #NANNANNAN 了。
  const n = info.width * info.height;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const px = i * info.channels;
    r += data[px]; g += data[px + 1]; b += data[px + 2];
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

async function processOne(file, stat_) {
  const src = path.join(SRC, file);
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext);
  const id = base.replace(/[^a-zA-Z0-9_-]/g, "-");

  // HEIC 先落地成 JPEG 临时文件
  let input = src;
  if (ext === ".heic" || ext === ".heif") {
    input = path.join(SRC, `.tmp-${base}.jpg`);
    await heicToJpeg(src, input);
  }

  const meta = await sharp(input).metadata();
  const exif = exifDate(meta.exif);
  const out = {};

  for (const { key, w } of WIDTHS) {
    const outPath = path.join(OUT, `${id}.${key}.webp`);
    await sharp(input)
      .rotate() // 读 EXIF orientation，竖拍的照片自动正过来
      .resize(w, null, { withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(outPath);
    out[key] = `/photos/${id}.${key}.webp`;
  }

  const color = await dominantColor(input);

  if (input !== src) await unlink(input);

  return {
    id,
    w: meta.width,
    h: meta.height,
    ...out,
    color,
    shot: exif ? exif.d : null, // 交给 main 按顺序补
    exifDate: exif ? `${exif.y}-${exif.mo}-${exif.d}` : null,
  };
}

/**
 * 墙上一共留几个位置。文件名开头的数字超过它就以文件名为准。
 *
 * 文件名开头的数字就是它在墙上的位置：1x.jpg 放第 1 位、5x.jpg 放第 5 位。
 * 所以你可以一张一张慢慢攒——放几张就换掉几位，剩下的位置保持原样（通常是占位图）。
 */
const SLOTS = 21;

async function main() {
  if (!existsSync(SRC)) {
    console.log("photos/ 还不存在，新建一个再跑。");
    return;
  }
  await mkdir(OUT, { recursive: true });

  const files = (await readdir(SRC)).filter((f) => {
    const e = path.extname(f).toLowerCase();
    return EXTS.includes(e) && !f.startsWith(".");
  });
  if (!files.length) {
    console.log("photos/ 里没有图片。");
    return;
  }
  // 按文件名排。numeric: true 是必须的——文件名约定是「序号 + 后缀」（1x、2x…21x），
  // 而默认的字典序会把 10x 排在 2x 前面，1x 掉到第 11 位，墙上顺序全乱。
  files.sort((a, b) => a.localeCompare(b, "zh", { numeric: true }));

  // ── 每个文件落在第几位 ──────────────────────────────────────────────
  const slotOf = new Map(); // 位置（1 起）-> 文件名
  const loose = []; // 文件名开头没有数字的
  for (const f of files) {
    const m = /^(\d+)/.exec(f);
    const n = m ? Number(m[1]) : 0;
    if (n < 1) {
      loose.push(f);
      continue;
    }
    if (slotOf.has(n)) {
      console.log(`  ! ${f} 和第 ${n} 位重号，这张跳过`);
      continue;
    }
    slotOf.set(n, f);
  }

  const highest = slotOf.size ? Math.max(...slotOf.keys()) : 0;
  const total = Math.max(SLOTS, highest + loose.length);
  // 没有数字前缀的，按名字顺序补到最前面空着的位置上
  for (const f of loose) {
    for (let i = 1; i <= total; i++) {
      if (!slotOf.has(i)) {
        slotOf.set(i, f);
        console.log(`  · ${f} 没有数字前缀，放到第 ${i} 位`);
        break;
      }
    }
  }

  // ── 空着的位置沿用上一次同一位置的条目 ──────────────────────────────
  // 通常那就是 make-demo-photos.mjs 铺的占位图，所以「放几张就换几位」是成立的。
  // 想把某一位彻底清掉：把 photos.json 里那一项删了再跑，或者 npm run demo 重铺。
  let prev = { photos: [] };
  if (existsSync(JSON_OUT)) {
    try {
      prev = JSON.parse(await readFile(JSON_OUT, "utf8"));
    } catch {
      console.log("  ! 现有的 photos.json 读不出来，这次没有占位图可沿用");
    }
  }
  const prevAt = new Map((prev.photos ?? []).map((p) => [p.page, p]));

  const cache = await loadCache();
  const at = new Array(total + 1); // 位置 -> { real: photo } | { carried: entry }
  let realCount = 0;
  let carriedCount = 0;

  for (let slot = 1; slot <= total; slot++) {
    const file = slotOf.get(slot);
    if (!file) {
      const carried = prevAt.get(slot);
      if (!carried) {
        console.log(`  ! 第 ${slot} 位既没有照片也没有可沿用的条目，这一位空着`);
        continue;
      }
      at[slot] = { carried };
      carriedCount++;
      continue;
    }

    const src = path.join(SRC, file);
    const st = await stat(src);
    const id = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_-]/g, "-");
    const key = `${st.mtimeMs}:${st.size}`;

    const cached = cache[id];
    if (cached && cached.key === key) {
      at[slot] = { real: cached.photo };
      console.log(`  · ${id} → 第 ${slot} 位（没动过，跳过）`);
      realCount++;
      continue;
    }

    process.stdout.write(`  … ${id} → 第 ${slot} 位\r`);
    const photo = await processOne(file, st);
    // 没有 EXIF 的，按它落在第几位折算一个大致拍摄日（10月1号往前）
    if (photo.shot == null) {
      photo.shot = Math.min(7, Math.floor(((slot - 1) * 7) / total) + 1);
      photo.exifDate = null;
    }
    cache[id] = { key, photo };
    at[slot] = { real: photo };
    realCount++;
  }

  // photos.json：page 就是它落在第几位
  const photos = [];
  for (let slot = 1; slot <= total; slot++) {
    const e = at[slot];
    if (!e) continue;
    if (e.carried) {
      photos.push({ ...e.carried, page: slot });
      continue;
    }
    const p = e.real;
    photos.push({
      id: p.id,
      page: slot,
      shot: p.shot,
      thumb: p.thumb,
      card: p.card,
      full: p.full,
      w: p.w,
      h: p.h,
      color: p.color,
      caption: "", // 正面白边上那句话，写在根目录的 captions.json 里
      story: "", // 翻到背面看到的那段故事，同样写在 captions.json 里
    });
  }

  // 文案放在根目录的 captions.json 这个侧车文件里，**不要直接改 photos.json**——
  // 这个脚本每次运行都会重新生成 photos.json，写在那里会被下一次 npm run photos 覆盖掉。
  //
  //   { "1x": "白边上那句话",
  //     "2x": { "caption": "短句", "story": "背面那段五六行的故事" } }
  //
  // 老的纯字符串写法仍然支持。
  const withCaptions = path.join(ROOT, "captions.json");
  let captioned = 0;
  if (existsSync(withCaptions)) {
    const map = JSON.parse(await readFile(withCaptions, "utf8"));
    for (const p of photos) {
      const v = map[p.id];
      if (!v) continue;
      if (typeof v === "string") {
        p.caption = v;
      } else {
        if (typeof v.caption === "string") p.caption = v.caption;
        if (typeof v.story === "string") p.story = v.story;
      }
      if (p.caption || p.story) captioned++;
    }
  } else {
    console.log("  · 没有 captions.json，白条和背面都会是空的（格式见本文件注释）");
  }

  await writeFile(JSON_OUT, JSON.stringify({
    generated: new Date().toISOString(),
    demo: false,
    photos,
  }, null, 2));
  await saveCache(cache);

  const gaps = total - realCount - carriedCount;
  console.log(`\n墙上 ${total} 个位置 → public/photos/ 和 src/data/photos.json`);
  console.log(`  真照片 ${realCount} 张${carriedCount ? `，沿用原有条目 ${carriedCount} 个` : ""}${gaps ? `，空位 ${gaps} 个` : ""}`);
  if (captioned) console.log(`  其中 ${captioned} 张在 captions.json 里写了文案`);
  console.log("接下来 npm run deploy。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
