/**
 * 合成 1200×630 的分享卡片（og.jpg）。
 *
 * 微信和小红书都不执行 JS，页面里那些活的东西它们一条都看不到。
 * 想让人从聊天框里点进来，唯一可靠的做法就是这张静态图——
 * 必须在构建时生成并真的放在站点根目录，被 OG 爬虫直接抓到。
 *
 * 用 SVG 画好再交给 sharp 栅格化：排版能精确控制，不必开浏览器截图。
 * 字体用系统的宋/楷，macOS 上一定存在；生成是本地一次性动作，
 * 产物进 public/og.jpg 之后就不依赖字体了。
 *
 *   npm run og
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "src/data/photos.json");

const W = 1200;
const H = 630;

const json = JSON.parse(await readFile(dataFile, "utf8"));
/** @type {{id:string,thumb:string,color:string,w:number,h:number}[]} */
const photos = json.photos;

// 小红书的缩略图很小，主信息必须在左边一竖条内读得出来
const SANS = "PingFang SC, Hiragino Sans GB, Source Han Sans SC, sans-serif";
const SERIF = "Songti SC, Noto Serif CJK SC, serif";
const KAI = "Kaiti SC, STKaiti, KaiTi, cursive";

/**
 * 一张拍立得：白边 + 一层投影，照片按 slice 裁进白边里。
 *
 * 白边的比例（左右/上 5%，下 13%）比墙上那张（3.5% / 13%）厚一点：
 * 这张卡片上只有三张照片，露出白边的面积大，太薄就读不出「相纸」了。
 * 宽高比交给调用方定死，所以某张是竖构图也不会把整叠顶出画布。
 */
function frame(p, x, y, w, h, deg) {
  const padX = Math.round(w * 0.05);
  const padB = Math.round(w * 0.13);
  return `
  <g transform="translate(${x} ${y}) rotate(${deg.toFixed(2)} ${w / 2} ${h / 2})">
    <rect x="4" y="7" width="${w}" height="${h}" fill="rgb(43 38 32 / 0.18)"/>
    <rect width="${w}" height="${h}" fill="#F2EDE1"/>
    <image href="${p}" x="${padX}" y="${padX}" width="${w - padX * 2}" height="${h - padX - padB}"
           preserveAspectRatio="xMidYMid slice"/>
  </g>`;
}

/**
 * librsvg 不会去读 `/photos/xxx.svg` 这种站点路径，它只认 data URI 和真实文件。
 * 所以每张要用的图都先读成 base64 内联进去——一次性动作，几十 KB 无所谓。
 */
const cache = new Map();
async function href(p) {
  if (cache.has(p.id)) return cache.get(p.id);
  const file = path.join(root, "public", p.thumb.replace(/^\//, ""));
  const buf = await readFile(file);
  const mime = file.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
  const uri = `data:${mime};base64,${buf.toString("base64")}`;
  cache.set(p.id, uri);
  return uri;
}

/** 一叠拍立得斜靠在右下角，像刚贴到墙上 */
async function stack() {
  // 只挑横图和方图。竖图铺在这里会掉出画布下沿，
  // 而且那三张本来就是背景层次，不该抢最前面那张的注意力。
  const picks = [photos[1], photos[3], photos[6]].filter(Boolean);
  let out = "";
  for (const [i, p] of picks.entries()) {
    out += frame(await href(p), 700 + i * 104, 210 + i * 66, 196, 252, 2 + i * 1.7);
  }
  // 最前面那张：正立、最大。相纸下面那条宽白边是拍立得的签名，
  // 也是整张卡片上唯一的「产品本体」。
  out += frame(await href(photos[0]), 858, 176, 252, 322, -2.4);
  return out;
}

const title = "国庆七天 · 照片墙";
const sub = `${photos.length} 张照片，贴满一面墙`;
const sub2 = "拖一拖、甩一甩、点一下拿起来看";

const stackArt = await stack();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="wall" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#DAD4C6"/>
    <stop offset="1" stop-color="#C4BCAA"/>
  </linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
  </filter>
  <radialGradient id="lamp" cx="0.72" cy="0.02" r="0.7">
    <stop offset="0" stop-color="rgb(255 244 214 / 0.55)"/>
    <stop offset="1" stop-color="rgb(255 244 214 / 0)"/>
  </radialGradient>
</defs>

<rect width="${W}" height="${H}" fill="url(#wall)"/>
<rect width="${W}" height="${H}" fill="url(#lamp)"/>
<rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.09" style="mix-blend-mode:overlay"/>

${stackArt}

<!-- 左边一条竖排的标题区，全部左对齐 -->
<g>
  <rect x="74" y="152" width="46" height="3" fill="#C4352A"/>
  <text x="74" y="140" font-family="${SANS}" font-size="21" fill="#6C6353" letter-spacing="3">10.01 — 10.07</text>
  <text x="70" y="238" font-family="${SERIF}" font-size="86" font-weight="700" fill="#2B2620" letter-spacing="-2">国庆七天</text>
  <text x="74" y="304" font-family="${KAI}" font-size="34" fill="#2B2620">照片墙</text>
  <text x="74" y="368" font-family="${SANS}" font-size="22" fill="#5C5445">${sub}</text>
  <text x="74" y="404" font-family="${SANS}" font-size="22" fill="#5C5445">${sub2}</text>
</g>

<text x="74" y="${H - 44}" font-family="${SANS}" font-size="18" fill="#8A8171" letter-spacing="1">${title}</text>
</svg>`;

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("还没装 sharp：npm i -D sharp");
  process.exit(1);
}

const out = path.join(root, "public/og.jpg");
// librsvg 要一个真实文件，所以先落地再栅格化
const tmp = path.join(root, ".og.tmp.svg");
await writeFile(tmp, svg, "utf8");
const info = await sharp(tmp, { density: 144 })
  .resize(W, H, { fit: "fill" })
  .jpeg({ quality: 84, progressive: true })
  .toFile(out);
await rm(tmp, { force: true });
console.log(`og.jpg → ${info.width}×${info.height} ${(info.size / 1024).toFixed(0)}KB`);
