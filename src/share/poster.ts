/**
 * 导出那张分享图：一叠拍立得。
 *
 * 整张图是 Canvas 2D 手画的，没有引入 html2canvas 一类的库——这个项目的底线是
 * 零运行时依赖（整个站点 42KB）。手画反而更可控：几何全是现成的，
 * 相纸比例直接从 sticker.ts import，胶带的位置用同一个 rand01()，
 * 所以导出的那一张和屏幕上那一张是同一张。
 *
 * 和 scripts/make-og.mjs 是同一个路子（那边画成 SVG 再交给 sharp 栅格化），
 * 区别只是这边跑在浏览器里、现场生成，访客点一下就能存下来发出去。
 * 两边共享的相纸比例源头是 ../wall/sticker 的 FRAME_* / framedH()。
 */
import type { Photo } from "../data/config";
import { FRAME_BOTTOM, FRAME_TOP, FRAME_X, framedH, rand01 } from "../wall/sticker";

/**
 * 画布尺寸：1242×1656，3:4，小红书竖版封面的原生尺寸，微信也吃。
 *
 * 不要乘 devicePixelRatio。iPhone 上 ×3 就是 3726×4968 ≈ 18.5Mpx，
 * 越过 iOS 画布约 16.7Mpx 的上限——Safari 不报错，直接给你一张空白画布，
 * toBlob 出来是个空文件。而 1242px 已经是正面那张相纸 CSS 宽度的三倍，
 * 再大只是把编码时间翻三倍。
 */
export const POSTER_W = 1242;
export const POSTER_H = 1656;

/** 一摞里放几张。photos.json 的前几张，不够就有几张画几张。 */
const STACK_SIZE = 4;

/**
 * 一摞里某一层的摆法。
 *
 * 写的全是相对量（占画布宽/高的比例），换画布尺寸不用重算。
 * 每层给的是一个**格子**而不是相纸的实际尺寸：相纸会按它自己的长宽比
 * 缩放着塞进格子，所以竖图（h/w≈1.41）和横图（h/w≈0.86）共用同一套数字
 * 都不会出框——这一点是必须的，实拍里两种都有，高度差了 1.63 倍。
 */
interface Slot {
  /** 用第几张照片。0 是 photos.json 的第一张（最前面那张）。 */
  pick: number;
  /** 格子中心：占画布宽 / 高的比例 */
  x: number;
  y: number;
  /** 格子宽 / 高：占画布宽 / 高的比例 */
  w: number;
  h: number;
  /** 倾斜角，度 */
  deg: number;
}

/**
 * 这一摞怎么摆。
 *
 * 数组顺序就是绘制顺序，**最后一个画在最上面**，所以最前面那张排在最后。
 * 想调效果就动这张表：x/y 挪位置，w/h 改大小，deg 改倾角。
 *
 * 每层给的是一个**格子**，相纸会按自己的长宽比缩放着塞进去，转多少度都不会出框——
 * 所以竖图横图共用一套数字就行，不用自己算比例。
 *
 * 当前这组是「从左上往右下扇开、正面那张最大最靠前」，重心大致落在画布正中：
 * 左边留白比右边略多一点，上面比下面略多一点——完全对称反而板。
 * 左下角那行落款（y ≈ 0.955）没被压到。
 *
 * 调的时候别越过这三条：内容别出画布（x ± w/2、y ± h/2 大致在 0.05~0.95 之间）；
 * 别压到左下角 y ≈ 0.955 的落款；pick 写 0~3（STACK_SIZE 是 4）。
 * 改完看 http://localhost:5173/poster.html —— 导出图直接铺满视口，不用反复刷新。
 */
const SLOTS: Slot[] = [
  { pick: 3, x: 0.34, y: 0.30, w: 0.44, h: 0.48, deg: 6.0 },
  { pick: 2, x: 0.435, y: 0.368, w: 0.44, h: 0.48, deg: 4.0 },
  { pick: 1, x: 0.53, y: 0.436, w: 0.44, h: 0.48, deg: 2.0 },
  { pick: 0, x: 0.615, y: 0.565, w: 0.54, h: 0.6, deg: -2.6 },
];

// ── 颜色 / 字体 / 纹理：全部从页面上正在用的 token 里读 ──────────────
//
// 必须读 document.body 而不是 documentElement：body.night 那几个覆盖
// （tokens.css:139-144）挂在 body 上，读 :root 拿到的永远是白天那份。
// 这样 +?light=night 导出的就是夜里的墙。

const probe = document.createElement("span");

function cssRaw(name: string, fallback = ""): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

/**
 * 取一个能直接喂给 ctx.fillStyle 的颜色。
 *
 * 绕一圈 span.style.color 是必要的：ctx.fillStyle 遇到不认识的字符串是
 * **静默忽略**（保持上一个值），不会抛错也不会变黑，画出来就是「颜色怎么不对」
 * 而查不出所以然。让 CSSOM 先替我们验一遍，不合法就退回兜底色。
 */
function cssColor(name: string, fallback: string): string {
  const raw = cssRaw(name);
  if (!raw) return fallback;
  probe.style.color = "";
  probe.style.color = raw;
  return probe.style.color || fallback;
}

/** --grain / --mottle 是 url("data:...") 形式的整段值，把里面的地址抠出来 */
function cssUrl(name: string): string | null {
  const m = /^url\((["']?)(.*)\1\)$/.exec(cssRaw(name));
  return m ? m[2] : null;
}

/** 把单位圆拉成椭圆的径向渐变。canvas 只有正圆，而页面上那些光斑都是椭圆的。 */
function radialEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  stops: [number, string][],
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  // 变换之后画这个矩形，正好覆盖 translate/scale 前的 2rx × 2ry 那块
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => reject(new Error(`图片超时：${src}`)), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`图片加载失败：${src}`));
    };
    img.src = src;
  });
}

/** 复刻 object-fit: cover（默认 object-position: 50% 50%）。 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih) return;
  // 按「铺满目标框」求源图上的取样窗口，多出来的部分两边各裁一半
  const scale = Math.max(dw / iw, dh / ih);
  const sw = dw / scale;
  const sh = dh / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, dx, dy, dw, dh);
}

/**
 * 按码点二分找最长能放下的前缀，再补一个省略号。
 *
 * 画布上没有 -webkit-line-clamp，只能自己量。二分是为了少调几次 measureText
 * （它是这里唯一会触发布局的调用）。用 Array.from 切而不是 slice，
 * 否则会把 emoji 的代理对劈成两半，画出来是个方块。
 */
export function fitOneLine(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text || ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(chars.slice(0, mid).join("") + "…").width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join("") + "…";
}

/**
 * 把相纸等比缩放着塞进格子，转多少度都不会出框。
 *
 * 做法是先按格子宽度铺满求出相纸尺寸，再拿它**旋转之后的包围盒**去和格子比，
 * 取小的那个比例收回。因为旋转是绕相纸中心的，包围盒也以中心对称，
 * 所以只要把中心摆在格子中心，四个角必然落在格子里。
 *
 * slot.w / slot.h 是比例，这里先换成像素——framedH() 收的是像素，
 * 而且它内部 round() 过：喂进去 0.4 会得到 0。
 */
function fitInBox(photo: Photo, slot: Slot): { w: number; h: number } {
  const rad = (slot.deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = slot.w * POSTER_W;
  const boxH = slot.h * POSTER_H;
  const w0 = boxW;
  const h0 = framedH(w0, photo.h / photo.w);
  const k = Math.min(boxW / (w0 * cos + h0 * sin), boxH / (w0 * sin + h0 * cos));
  return { w: w0 * k, h: h0 * k };
}

/**
 * 画上那卷和纸胶带。
 *
 * 三个随机量用的 seed 和 sticker.ts 的 build() 里**一模一样**
 * （id / id+"k" / id+"r" / id+"x"），所以同一张照片在墙上和在导出图里
 * 要么都有胶带、要么都没有，位置和倾角也对得上。
 *
 * 坐标要从 CSS 那套换算过来：wall.css 的 .tape 是
 * `top: -10px; left: var(--tx, 50%); translate: -50% 0`——**从贴纸左上角量的**，
 * 而这里已经被 translate 到相纸中心了。所以：
 *   横向  left = (50% + tx%) · w  →  中心原点下就是 tx% · w
 *   纵向  top  = -10px            →  中心原点下是 -h/2 - 0.0625w
 * 少减 h/2、或者多写 w/2，胶带就会飘到相纸外面去。
 */
function drawTape(ctx: CanvasRenderingContext2D, photo: Photo, w: number, h: number): void {
  if (rand01(photo.id) >= 0.55) return;

  const indigo = rand01(photo.id + "k") < 0.6;
  const tilt = rand01(photo.id + "r") * 16 - 8;
  const off = (rand01(photo.id + "x") * 46 - 23) / 100;

  // 墙上的胶带是 56×21px 贴在一张 --w 的相纸上，这里按同一个比例放大
  const tw = w * 0.35;
  const th = w * 0.13;

  ctx.save();
  ctx.translate(off * w, -h / 2 - w * 0.0625);
  ctx.rotate((tilt * Math.PI) / 180);

  // 边缘不齐。这串点是 wall.css 里 .tape 的 clip-path 原样抄过来的
  const edge: [number, number][] = [
    [2, 6], [18, 0], [34, 5], [52, 0], [70, 6], [86, 1], [100, 7],
    [98, 93], [84, 100], [66, 94], [48, 100], [30, 94], [14, 100], [0, 92],
  ];
  ctx.beginPath();
  edge.forEach(([px, py], i) => {
    const x = (px / 100) * tw - tw / 2;
    const y = (py / 100) * th - th / 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();

  // 胶带本体。multiply 对应 wall.css 的 mix-blend-mode: multiply
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = indigo ? 0.34 : 0.38;
  ctx.fillStyle = indigo ? "rgb(46, 66, 96)" : "rgb(201, 162, 39)";
  ctx.shadowColor = "rgba(50, 40, 24, 0.18)";
  ctx.shadowBlur = w * 0.008;
  ctx.shadowOffsetY = w * 0.004;
  ctx.fill();

  // 那道 3px 一亮 4px 一暗的横纹。8 条是 56/7，按相纸宽等比放大。
  //
  // 必须换回 source-over 再画：multiply 底下白色是单位元，画了等于没画。
  // CSS 那边横纹是画在胶带**内部**、再连同胶带一起 multiply 的，
  // 所以这里也该是「在已经压好的胶带上，再提亮 10%」，而不是参与 multiply。
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.save();
  ctx.clip();
  const pitch = tw / 8;
  for (let x = -tw / 2; x < tw / 2; x += pitch) ctx.fillRect(x, -th / 2, pitch * 0.45, th);
  ctx.restore();

  ctx.restore();
}

interface Layer {
  photo: Photo;
  img: HTMLImageElement | null;
  cx: number;
  cy: number;
  w: number;
  h: number;
  deg: number;
}

/**
 * 画出整张分享图。返回一个可以直接存下来 / 丢给 navigator.share 的 Blob。
 *
 * 图是并排加载的，某一张挂了就跳过它、用占位色顶上，不让整张图失败——
 * 和这个项目别处一样：控制台点名，页面照常。
 */
export async function renderPoster(photos: Photo[]): Promise<Blob> {
  const picks = photos.slice(0, STACK_SIZE);
  if (!picks.length) throw new Error("一张照片都没有，导不出东西");

  // 手写体是系统字体，量字宽之前必须等它定下来，否则省略号会截在错的地方。
  // main.ts 里重排也等的同一个钩子。
  await document.fonts?.ready;

  const canvas = document.createElement("canvas");
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d");
  // 画布被污染（图片跨域）或者尺寸为 0 的时候会是 null
  if (!ctx) throw new Error("拿不到 2D 上下文");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const wall = cssColor("--wall", "#d6d0c2");
  const wallDeep = cssColor("--wall-deep", "#bdb5a3");
  const paper = cssColor("--paper", "#f2ede1");
  const ink = cssColor("--ink", "#2b2620");
  const night = document.body.classList.contains("night");

  // ── 墙 ────────────────────────────────────────────────────────────
  // 顺序和 tokens.css 的 body::before 一致：底色 → 下方压深 → 上方来光
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  radialEllipse(ctx, POSTER_W * 0.5, POSTER_H * 1.12, POSTER_W * 0.75, POSTER_H * 0.55, [
    [0, wallDeep],
    [0.56, "rgba(0,0,0,0)"],
  ]);
  radialEllipse(ctx, POSTER_W * 0.5, -POSTER_H * 0.12, POSTER_W * 0.575, POSTER_H * 0.375, [
    [0, "rgba(255, 252, 244, 0.8)"],
    [0.6, "rgba(0, 0, 0, 0)"],
  ]);

  // 夜里那盏灯（tokens.css 的 .light）：右上打下来的暖光 + 整体压一点暗
  if (night) {
    radialEllipse(ctx, POSTER_W * 0.72, POSTER_H * 0.04, POSTER_W * 0.36, POSTER_H * 0.32, [
      [0, "rgba(255, 210, 146, 0.26)"],
      [0.7, "rgba(0, 0, 0, 0)"],
    ]);
    const dusk = ctx.createLinearGradient(0, 0, POSTER_W * 0.4, POSTER_H);
    dusk.addColorStop(0, "rgba(26 22 34 / 0.14)");
    dusk.addColorStop(1, "rgba(18 16 26 / 0.32)");
    ctx.fillStyle = dusk;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  }

  // ── 颗粒 ──────────────────────────────────────────────────────────
  // 直接用页面上那份 --grain / --mottle（tokens.css 里的 data URI），
  // 所以导出的图和屏幕上同一层纹理、同样的叠法。纹理挂了不影响正确性，跳过就是。
  try {
    const tiles = await Promise.all([cssUrl("--grain"), cssUrl("--mottle")].map(async (u) => {
      if (!u) return null;
      try {
        return await loadImage(u, 3000);
      } catch {
        return null;
      }
    }));
    ctx.globalCompositeOperation = "multiply";
    for (const [i, tile] of tiles.entries()) {
      if (!tile) continue;
      ctx.globalAlpha = i === 0 ? 0.3 : 0.16;
      ctx.fillStyle = ctx.createPattern(tile, "repeat") ?? "rgba(0,0,0,0)";
      ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  } catch {
    /* 纹理画不上就算了，图还是对的，只是平一点 */
  }

  // ── 一叠拍立得 ────────────────────────────────────────────────────
  // 照片不够时把指向不存在那几张的层去掉；剩几张画几张，一张也有它的摆法。
  const plan = SLOTS.filter((s) => s.pick < picks.length);
  if (!plan.length) throw new Error("一层的照片都凑不齐");
  // 最后画的那层在最上面，也就是「正面那张」，用高清档
  const hero = plan[plan.length - 1];

  // 并排加载。正面那张用 card（1080w，在图上约 620px 宽，够用且余一倍），
  // 后面那几张被压掉大半，thumb（480w）就够——不必为此多花三倍流量。
  // full（1920w）是 loupe 专用的，这里取它纯属浪费。
  //
  // 某一张挂了只警告、置 null，等下用占位色顶上；不让一张图毁掉整次导出。
  const cache = new Map<string, Promise<HTMLImageElement | null>>();
  const load = (src: string): Promise<HTMLImageElement | null> => {
    let p = cache.get(src);
    if (!p) {
      p = loadImage(src).catch((err: unknown) => {
        console.warn(`[share] ${src} 没加载出来，这一层用占位色顶上`, err);
        return null;
      });
      cache.set(src, p);
    }
    return p;
  };
  const loaded = await Promise.all(
    plan.map((s) => load(s === hero ? picks[s.pick].card : picks[s.pick].thumb)),
  );

  const layers: Layer[] = plan.map((slot, i) => {
    const photo = picks[slot.pick];
    const { w, h } = fitInBox(photo, slot);
    return {
      photo,
      img: loaded[i],
      cx: slot.x * POSTER_W,
      cy: slot.y * POSTER_H,
      w,
      h,
      deg: slot.deg,
    };
  });

  // 有哪一层摆到画布外面了就在控制台点名。画面上只是「少了一块相纸」，
  // 看不出是越界——和 loupe.ts 的白条截断告警、prepare-photos.mjs 的坏图告警
  // 是同一个路子：不拦着，但让你知道是哪一张。
  // 留 2% 的余量，别为了一两个像素就报。
  const slack = POSTER_W * 0.02;
  for (const l of layers) {
    const rad = (l.deg * Math.PI) / 180;
    const halfW = (l.w * Math.abs(Math.cos(rad)) + l.h * Math.abs(Math.sin(rad))) / 2;
    const halfH = (l.w * Math.abs(Math.sin(rad)) + l.h * Math.abs(Math.cos(rad))) / 2;
    if (
      l.cx - halfW < -slack ||
      l.cx + halfW > POSTER_W + slack ||
      l.cy - halfH < -slack ||
      l.cy + halfH > POSTER_H + slack
    ) {
      console.warn(`[share] ${l.photo.id} 这一层出画布了，看看 SLOTS 里的格子是不是太大或太靠边`);
    }
  }

  for (const [i, layer] of layers.entries()) {
    // 胶带只画最前面那张。墙上的胶带是 multiply 压在相纸上沿、半张落在墙上的；
    // 而叠图里后面每一层的「墙」其实是**另一张照片**，同一卷胶带 multiply 到
    // 深色照片上就成了一块发暗的脏斑。只有最前面那张背后真的是墙。
    drawLayer(ctx, layer, paper, ink, i === layers.length - 1);
  }

  // ── 落款 ──────────────────────────────────────────────────────────
  // 一行很淡的小字。压得很低，不影响画面，但图被转出去之后还认得出是谁家的墙。
  ctx.save();
  ctx.font = `400 ${Math.round(POSTER_W * 0.022)}px ${cssRaw("--font-text", "serif")}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = ink;
  ctx.fillText("国庆七天 · 照片墙", POSTER_W * 0.06, POSTER_H * 0.955);
  ctx.restore();

  const blob = await new Promise<Blob | null>((resolve) => {
    // JPEG 而不是 PNG：两百万像素的照片用 PNG 要三五兆，还看不出区别
    canvas.toBlob(resolve, "image/jpeg", 0.92);
  });
  // toBlob 失败时是**返回 null**，不抛错（画布被污染、尺寸为 0 都会）
  if (!blob) throw new Error("toBlob 返回了 null（画布可能被跨域图片污染了）");
  return blob;
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  paper: string,
  ink: string,
  withTape: boolean,
): void {
  const { photo, img, cx, cy, w, h, deg } = layer;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);

  // 相纸本体 + 投影。shadowOffset 是按屏幕坐标算的、不受当前变换影响，
  // 所以每一层的影子都朝同一个方向落——只有一盏灯，本来就该这样。
  ctx.save();
  ctx.shadowColor = "rgba(43, 38, 32, 0.34)";
  ctx.shadowBlur = w * 0.1;
  ctx.shadowOffsetY = w * 0.035;
  ctx.fillStyle = paper;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();

  // 可见照片区。framedH() 保证它的比例和原图一致，所以 cover 裁切实际上裁不到东西，
  // 但那条数学还是留着——万一日后白边比例变了，这里不会突然开始裁图。
  const innerW = w * (1 - FRAME_X * 2);
  const innerH = h - w * (FRAME_TOP + FRAME_BOTTOM);
  const padX = -w / 2 + w * FRAME_X;
  const padY = -h / 2 + w * FRAME_TOP;

  if (img) {
    drawCover(ctx, img, padX, padY, innerW, innerH);
  } else {
    // 占位色：和墙上 img 的 background: var(--c) 是同一个用途
    ctx.fillStyle = photo.color || paper;
    ctx.fillRect(padX, padY, innerW, innerH);
  }
  ctx.strokeStyle = "rgba(43, 38, 32, 0.07)";
  ctx.lineWidth = Math.max(1, w * 0.003);
  ctx.strokeRect(padX, padY, innerW, innerH);

  // 白条上那句话。墙上是 min(13px, 0.086·w) 封顶 13px，这里按同一支笔放大：
  // 墙上 283px 的贴纸用 13px，导出图里 ~600px 用 33px，观感一致。
  const fontSize = w * 0.055;
  if ((photo.caption ?? "").trim()) {
    ctx.save();
    ctx.font = `400 ${fontSize.toFixed(1)}px ${cssRaw("--font-hand", "cursive")}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ink;
    ctx.globalAlpha = 0.8;
    const line = fitOneLine(ctx, photo.caption, innerW);
    if (line !== photo.caption) console.warn(`[share] ${photo.id} 的白条放不下，已截断：「${photo.caption}」`);
    // 竖直居中在那条 13% 的白条里，和 CSS 那边 flex 居中的位置一致
    ctx.fillText(line, padX, padY + innerH + (w * FRAME_BOTTOM) / 2);
    ctx.restore();
  }

  if (withTape) drawTape(ctx, photo, w, h);
  ctx.restore();
}
