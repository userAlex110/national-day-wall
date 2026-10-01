/**
 * 墙上的照片贴纸：确定性瀑布流布局 + 弹簧物理拖拽 + 翻面。
 *
 * 物理模型：pos 是绝对平面坐标的弹簧，rest 是静止落点。
 * 拖拽时 pos 跟手（带滞后 → 有重量感）；松手时把当前值固化成新的 rest，
 * 再注入角速度 → 贴纸在墙上晃两下停住。停在哪儿就是哪儿。
 */
import { Spring, Spring3 } from "../core/spring";
import { ticker } from "../core/ticker";
import type { Photo } from "../data/config";

const TAP_SLOP = 6; // px，小于这个位移算点击而不是拖拽
const TAP_TIME = 400; // ms
const LIFT_Z = 70; // px，拖起时向镜头推近
const LIFT_LEAN = 7; // deg
const LIFT_SCALE = 1.045;
const CURVE = 5; // deg，静止时按横向位置轻微外撇，让平面有弧度

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placed {
  photo: Photo;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rz: number;
}

const GAP_X = 12;
const GAP_Y = 14;

/**
 * 拍立得白边。必须和 wall.css 里 `.sticker--print .sticker__face` 的 padding 一致
 * ——两处各写一份，改一处就必然错位。
 *
 * 用「占 --w 的百分比」而不是像素：main.ts 拿到布局结果后会把 w 和 h 一起
 * 乘一个 scale，像素 padding 不跟着缩，白边里的照片就又被裁了；
 * 百分比 padding 按 containing block 的宽度解析，而 .sticker 的宽就是 --w，
 * 所以任何尺寸下都准。
 */
const FRAME_X = 0.035; // 左右白边
const FRAME_TOP = 0.035; // 上白边
const FRAME_BOTTOM = 0.13; // 下白边，拍立得那条能写字的宽边

/**
 * 让人从白边里看到的照片区域，正好保持原图比例所需的外框高度。
 *
 * 白边是往里压的（padding 撑在固定尺寸的 .sticker 里），所以外框尺寸和
 * 可见照片区域不是一回事：可见区是 (w - 2·FRAME_X·w) 宽，乘 ratio 得到它的高，
 * 再加上下白边才是外框高。不这么算，object-fit: cover 就要把每张照片裁掉一块。
 */
function framedH(w: number, ratio: number): number {
  // 白边占掉的是宽度的一部分，所以可见区宽度要先从 w 里减掉左右两条边
  const innerW = w * (1 - FRAME_X * 2);
  // 可见区高度 = 可见区宽度 × 原图比例；外框高度 = 它 + 上下两条白边
  return Math.round(innerW * ratio + w * (FRAME_TOP + FRAME_BOTTOM));
}

interface Pad {
  x: number;
  top: number;
}

/**
 * 照片必须落在板子里，不能压到板外的墙面上。
 * 板子内缩 3.2% / 4%，这里的留白再大一点，两边的关系就稳住了；
 * 窄屏时板子几乎贴边，就退回固定值。
 */
function padFor(boxW: number, boxH: number): Pad {
  return { x: Math.max(18, Math.round(boxW * 0.055)), top: Math.max(14, Math.round(boxH * 0.065)) };
}

export interface LayoutResult {
  placed: Placed[];
  /** 内容比墙高时的整体缩放，避免为了塞下而把图缩糊 */
  scale: number;
  /** 缩放后每张照片的实际宽度，用来挑列数 */
  finalW: number;
  cols: number;
  colW: number;
  /** 内容实际高度。flow 模式下超出墙高，靠墙内滚动 */
  contentH: number;
}

interface Pack {
  placed: Placed[];
  colW: number;
  height: number;
}

function packInto(
  order: Photo[],
  cols: number,
  boxW: number,
  rand: () => number,
  pad: Pad,
  /** 窄屏用：单张上限。超过就砍回来。 */
  maxW = 0,
): Pack {
  const colW = (boxW - pad.x * 2 - GAP_X * (cols - 1)) / cols;
  const heights = new Array(cols).fill(pad.top);
  const placed: Placed[] = [];
  const colX = (c: number) => pad.x + c * (colW + GAP_X);

  for (const photo of order) {
    const ratio = photo.h / photo.w;
    // 少量照片做成更宽的横构图，破坏均匀节奏
    const wide = ratio < 0.86 && rand() < 0.5;
    let w = Math.round(wide ? Math.min(colW * 1.45, colW * 2 - GAP_X) : colW);
    // 窄屏下「宽一点」不能宽过可读尺寸——不然一张横构图就把整列撑成两张半
    if (maxW) w = Math.min(w, maxW);
    let h = framedH(w, ratio);

    let col = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[col] - 1) col = i;

    // 横构图在最后一列必然探出墙外：由 colW 的定义可知，最后一列
    // 最多只放得下 colW 宽，超出的部分没有任何一列能容纳。收到墙沿以内，
    // 比例跟着重算——宁可这一张小一点，也不要挂到墙外面被视口裁掉。
    const fit = Math.floor(boxW - pad.x - colX(col));
    if (w > fit) {
      w = Math.max(48, fit);
      h = framedH(w, ratio);
    }

    const x = Math.round(colX(col) + (rand() - 0.5) * 9);
    const y = Math.round(heights[col] + (rand() - 0.5) * 9);
    const rz = (rand() - 0.5) * 11; // ±5.5°，严守上限
    // 0 ~ -150，往后推出去造视差深度。
    //
    // 这里配着 wall.css 里的一条规则才能点得到照片：.wall__plane 是
    // transform-style: preserve-3d，而在 3D 渲染上下文里层叠顺序由三维位置决定，
    // DOM 顺序和 z-index 都不作数。平面自己占着 z=0 那层，于是浮在所有贴纸**前面**，
    // 把每一次点击都接走（它没有背景所以看不出来）。所以 wall.css 里把平面设成
    // pointer-events: none、把贴纸设回 auto。实测：不这么配，全屏 6592 个采样点
    // 命中贴纸的是 0 个；配上之后 2031 个。
    //
    // 不要改成正值来绕开——透视会把贴纸往外推，越靠边推得越多，窄屏上会溢出画布。
    const z = -Math.round(rand() * 150);

    placed.push({ photo, x, y, w, h, z, rz });
    heights[col] += h + GAP_Y;
  }

  return { placed, colW, height: Math.max(...heights) - GAP_Y };
}

/**
 * 瀑布流布局。
 *
 * 两件事决定了这面墙好不好看：
 * 1) 落点顺序打散 —— 不散的话所有照片按顺序堆在左上角，剩下大半面墙空着。
 *    打散用的 seed 固定，所以刷新后位置不变，这面墙每次都是这面墙。
 * 2) 列数不写死，遍历 2~10 列，挑「缩放后每张最大」的那一档。
 *    照片张数会变（还没拍完），列数必须跟着照片数走。
 */
export function layoutWall(
  photos: Photo[],
  boxW: number,
  boxH: number,
  seed = 7,
  flow = false,
): LayoutResult {
  const order = [...photos];
  // Fisher-Yates，用独立 seed，刷新后位置不变
  const shuffle = mulberry32(seed ^ 0x5bf03635);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const pad = padFor(boxW, boxH);
  const usableH = boxH - pad.top * 2;
  let best: (Pack & { cols: number; scale: number; finalW: number }) | null = null;

  if (flow) {
    // 窄屏：绝不缩图。列数锁到能看的大小，剩下交给墙内滚动。
    //
    // 上限放到 5 列是血泪教训：原来夹在 3 列，610px 的墙上每列就有 183px，
    // 26 张照片铺开要滚 900 多像素，一屏只看得到两行半。现在 5 列 → 约 105px，
    // 一屏能看到四五行，滚动量也砍了一半。
    const want = 118;
    const cols = Math.max(
      1,
      Math.min(5, Math.round((boxW - pad.x * 2 + GAP_X) / (want + GAP_X))),
    );
    best = {
      ...packInto(order, cols, boxW, mulberry32(seed), pad, want),
      cols,
      scale: 1,
      finalW: 0,
    };
    best.finalW = best.colW;
  } else {
    for (let cols = 2; cols <= 10; cols++) {
      // 每次用同一个 seed 重新生成抖动，只有列数在变
      const pack = packInto(order, cols, boxW, mulberry32(seed), pad, 0);
      const scale = Math.min(1, usableH / Math.max(1, pack.height));
      const finalW = pack.colW * scale;
      if (!best || finalW > best.finalW) best = { ...pack, cols, scale, finalW };
    }
  }

  const win = best!;
  return {
    placed: win.placed,
    scale: win.scale,
    finalW: win.finalW,
    cols: win.cols,
    colW: win.colW,
    contentH: win.height + pad.top,
  };
}

interface Live {
  el: HTMLElement;
  pos: Spring3;
  rot: Spring;
  lift: Spring;
  baseRz: number;
  baseZ: number;
  w: number;
  h: number;
  photo: Photo;
  /** 当前落点，重排时用来把贴纸挪回去 */
  spot: Placed;
  dragging: boolean;
  hovered: boolean;
  sub: symbol | null;
  reduced: boolean;
}

export interface WallOpts {
  /** 点一下贴纸（不是拖）。不给就只是弹一下，不做别的 */
  onInspect?: (photo: Photo, el: HTMLElement) => void;
}

export interface StickerHost {
  add(p: Placed): void;
  /** 尺寸变化（转屏、换断点）后把已贴上的照片挪到新落点 */
  reposition(spots: Map<string, Placed>): void;
  /** 墙上所有照片，按上墙的先后（也就是 photos.json 的顺序） */
  list(): Photo[];
}

export function mountWall(plane: HTMLElement, opts: WallOpts = {}): StickerHost {
  const live = new Set<Live>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function transform(s: Live): string {
    const { pos, rot, lift } = s;
    const l = lift.value;
    const leanY = s.dragging ? 0 : (pos.x.value / 900) * CURVE;
    return (
      `translate3d(${pos.x.value.toFixed(2)}px, ${pos.y.value.toFixed(2)}px, ` +
      `${(s.baseZ + l * LIFT_Z).toFixed(2)}px) ` +
      `rotateX(${(-l * LIFT_LEAN).toFixed(2)}deg) rotateY(${leanY.toFixed(2)}deg) ` +
      `rotateZ(${(s.baseRz + rot.value).toFixed(2)}deg) ` +
      `scale(${(1 + l * (LIFT_SCALE - 1)).toFixed(4)})`
    );
  }

  function paint(s: Live): void {
    s.el.style.transform = transform(s);
    s.el.style.setProperty("--lift", s.lift.value.toFixed(3));
  }

  function run(s: Live): void {
    if (s.sub) return;
    s.sub = ticker.add((dt) => {
      const a = s.pos.step(dt);
      const b = s.rot.step(dt);
      const c = s.lift.step(dt);
      paint(s);
      if (a && b && c) {
        s.sub = null;
        return false;
      }
      return true;
    });
  }

  function build(p: Placed): Live {
    const el = document.createElement("figure");
    el.className = "sticker";
    el.dataset.id = p.photo.id;
    el.dataset.rz = p.rz.toFixed(2);
    el.tabIndex = 0;
    el.style.setProperty("--w", `${p.w}px`);
    el.style.setProperty("--h", `${p.h}px`);
    el.style.setProperty("--c", p.photo.color);
    // 全部都是冲印出来的拍立得，没有裸照片
    el.classList.add("sticker--print");

    const front = document.createElement("div");
    front.className = "sticker__face";
    const img = document.createElement("img");
    // 21 张照片现在是同时在场，不再是一张张撕出来的，所以让浏览器按贴纸的实际尺寸挑档：
    // 墙上的小贴纸取 480 的 thumb 就够，视网膜屏或视口大的时候自动升到 1080。
    img.srcset = `${p.photo.thumb} 480w, ${p.photo.card} 1080w`;
    img.sizes = `${p.w}px`;
    img.src = p.photo.card;
    img.alt = `10月${p.photo.shot}日`;
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
    front.append(img);

    if (rand01(p.photo.id) < 0.55) {
      const tape = document.createElement("span");
      tape.className = `tape tape--${rand01(p.photo.id + "k") < 0.6 ? "indigo" : "mustard"}`;
      tape.style.setProperty("--tilt", `${(rand01(p.photo.id + "r") * 16 - 8).toFixed(1)}deg`);
      tape.style.setProperty("--tx", `${(rand01(p.photo.id + "x") * 46 - 23).toFixed(0)}%`);
      front.append(tape);
    }

    el.append(front);

    const s: Live = {
      el,
      pos: new Spring3(0, 210, 21),
      rot: new Spring(0, 190, 17),
      lift: new Spring(0, 240, 24),
      photo: p.photo,
      baseRz: p.rz,
      baseZ: p.z,
      w: p.w,
      h: p.h,
      spot: p,
      dragging: false,
      hovered: false,
      sub: null,
      reduced,
    };

    wire(s);
    return s;
  }

  function wire(s: Live): void {
    const el = s.el;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let moved = 0;
    let t0 = 0;
    let pid = -1;

    el.addEventListener("pointerenter", () => {
      if (s.reduced || s.dragging) return;
      s.hovered = true;
      s.lift.target = 0.3;
      run(s);
    });

    el.addEventListener("pointerleave", () => {
      s.hovered = false;
      if (!s.dragging) {
        s.lift.target = 0;
        run(s);
      }
    });

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      pid = e.pointerId;
      el.setPointerCapture(pid);
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      baseX = s.pos.x.value;
      baseY = s.pos.y.value;
      lastT = performance.now();
      t0 = lastT;
      moved = 0;
      s.dragging = true;
      el.classList.add("is-dragging");
      s.lift.target = 1;
      run(s);
    });

    el.addEventListener("pointermove", (e) => {
      if (!s.dragging || e.pointerId !== pid) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      moved = Math.max(moved, Math.hypot(dx, dy));

      const now = performance.now();
      const dt = Math.max(1, now - lastT) / 1000;
      // 瞬时速度喂进弹簧，纸片自然就跟出滞后和重量感
      s.pos.setVelocity((e.clientX - lastX) / dt, (e.clientY - lastY) / dt, 0);
      s.pos.setTarget(baseX + dx, baseY + dy, 0);

      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
      run(s);
    });

    const end = (e: PointerEvent) => {
      if (!s.dragging || (pid !== -1 && e.pointerId !== pid)) return;
      s.dragging = false;
      el.classList.remove("is-dragging");
      try {
        el.releasePointerCapture(pid);
      } catch {
        /* 指针已消失 */
      }
      pid = -1;

      const dur = performance.now() - t0;
      if (moved < TAP_SLOP && dur < TAP_TIME) {
        s.pos.x.target = baseX;
        s.pos.y.target = baseY;
        s.lift.target = s.hovered ? 0.3 : 0;
        run(s);
        opts.onInspect?.(s.photo, el);
        return;
      }

      // 贴上去：固化为新落点 + 角速度让它晃两下
      s.pos.x.target = s.pos.x.value;
      s.pos.y.target = s.pos.y.value;
      s.pos.x.velocity *= 0.42;
      s.pos.y.velocity *= 0.42;
      s.rot.velocity += (Math.random() - 0.5) * 26;
      s.lift.target = 0;
      run(s);
    };

    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        opts.onInspect?.(s.photo, el);
      }
    });
  }

  function mount(p: Placed): void {
    const s = build(p);
    plane.append(s.el);
    live.add(s);
    s.pos.reset(p.x);
    s.pos.y.reset(p.y);
    paint(s);
  }

  return {
    add: (p) => mount(p),
    reposition(spots) {
      for (const s of live) {
        const next = spots.get(s.photo.id);
        if (!next || s.dragging) continue;
        s.spot = next;
        s.w = next.w;
        s.h = next.h;
        s.baseRz = next.rz;
        s.baseZ = next.z;
        s.el.style.setProperty("--w", `${next.w}px`);
        s.el.style.setProperty("--h", `${next.h}px`);
        // loupe 开合时会读 dataset.rz 当作 FLIP 的起始旋转角，得跟着一起更新
        s.el.dataset.rz = next.rz.toFixed(2);
        // 贴纸被挪过就回不到原位了，重排时一律归位
        s.pos.x.target = next.x;
        s.pos.y.target = next.y;
        s.pos.z.target = 0;
        run(s);
      }
    },
    list: () => [...live].map((s) => s.photo),
  };
}

/** 由 id 派生的确定性小数，用来决定胶带、白边等外观 */
export function rand01(seedText: string): number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}