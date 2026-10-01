/**
 * 真照片管线。
 *
 * 用法：把照片丢进 photos/，跑 `npm run photos`，然后 `npm run deploy`。
 * 链接不变。
 *
 * 为什么要有这个脚本：iPhone 拍出来是 HEIC，浏览器基本不认（Safari 认，微信不认）。
 * 直接把原图扔进 public/ 的话，一是体积，二是格式。所以这一步统一转成 WebP 三档，
 * 顺便把 EXIF 的拍摄时间抠出来当「10月X日拍」，再取一个主色防止图片加载前白闪。
 *
 * 增量：按 mtime + size 记在 .cache.json 里。没动过的照片直接复用上次的结果，
 * 所以补一张照片重跑只要一两秒，不用重转全部。
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

  const cache = await loadCache();
  const results = [];

  for (const [i, file] of files.entries()) {
    const src = path.join(SRC, file);
    const st = await stat(src);
    const id = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_-]/g, "-");
    const key = `${st.mtimeMs}:${st.size}`;

    const cached = cache[id];
    if (cached && cached.key === key) {
      results.push(cached.photo);
      console.log(`  · ${id} （没动过，跳过）`);
      continue;
    }

    process.stdout.write(`  … ${id}\r`);
    const photo = await processOne(file, st);
    // 没有 EXIF 的，按它在列表里的位置折算一个大致拍摄日（10月1号往前）
    if (photo.shot == null) {
      photo.shot = Math.min(7, Math.floor(i * 7 / files.length) + 1);
      photo.exifDate = null;
    }
    cache[id] = { key, photo };
    results.push(photo);
  }

  // photos.json：page = 索引 + 1，页号就是第几张照片
  const photos = results.map((p, i) => ({
    id: p.id,
    page: i + 1,
    shot: p.shot,
    thumb: p.thumb,
    card: p.card,
    full: p.full,
    w: p.w,
    h: p.h,
    color: p.color,
    caption: "", // 正面白边上那句话，写在根目录的 captions.json 里
    story: "", // 翻到背面看到的那段故事，同样写在 captions.json 里
  }));

  // 文案放在根目录的 captions.json 这个侧车文件里，**不要直接改 photos.json**——
  // 这个脚本每次运行都会重新生成 photos.json，写在那里会被下一次 npm run photos 覆盖掉。
  //
  //   { "p01": "白边上那句话",
  //     "p02": { "caption": "短句", "story": "背面那段五六行的故事" } }
  //
  // 老的纯字符串写法仍然支持。
  const withCaptions = path.join(ROOT, "captions.json");
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
    }
  }

  await writeFile(JSON_OUT, JSON.stringify({
    generated: new Date().toISOString(),
    demo: false,
    photos,
  }, null, 2));
  await saveCache(cache);

  console.log(`\n${photos.length} 张照片 → public/photos/ 和 src/data/photos.json`);
  console.log("接下来 npm run deploy。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
