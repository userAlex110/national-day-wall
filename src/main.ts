/**
 * 装配：把 photos.json 里的照片一次性铺满整面墙，全部是拍立得。
 *
 * 没有挂历、没有撕页、没有便利贴——打开就是成品。
 * 墙上每一张照片都由开发者在 src/data/ 里写死，访客只能看和拖动。
 *
 * 落点由 layoutWall() 算，同一个 seed 保证刷新后位置不变；
 * 访客拖动过的贴纸会在下次重排（转屏、改窗口大小）时归位，不写回任何地方。
 */
import type { Photo } from "./data/config";
import photoData from "./data/photos.json";
import { mountTilt } from "./core/stage";
import { layoutWall, mountWall, type Placed } from "./wall/sticker";
import { mountLoupe } from "./wall/loupe";
import { mountShareButton } from "./share/button";
import { sfxPickup, unlockAudio } from "./core/sound";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少 #${id}`);
  return el as T;
};

const wallEl = $("wall");
const planeEl = $("plane");

const photos = photoData.photos as Photo[];

// ── 布局 ─────────────────────────────────────────────────────────────
let byId = new Map<string, Placed>();
const NARROW = "(max-width: 820px)";

function relayout(): void {
  const r = wallEl.getBoundingClientRect();
  if (r.width < 80) return;
  // 窄屏照片不缩，墙内滚动；宽屏一屏看全，宁可缩小
  const flow = matchMedia(NARROW).matches;
  const result = layoutWall(photos, r.width, r.height, 7, flow);
  // 位置和尺寸一起缩，旋转角度不动
  const placed = result.placed.map((p) => ({
    ...p,
    x: Math.round(p.x * result.scale),
    y: Math.round(p.y * result.scale),
    w: Math.round(p.w * result.scale),
    h: Math.round(p.h * result.scale),
  }));
  byId = new Map(placed.map((p) => [p.photo.id, p]));

  wallEl.classList.toggle("is-scrollable", flow);
  const h = flow ? Math.max(Math.round(r.height), result.contentH) : r.height;
  planeEl.style.height = `${h}px`;

  // 重排后把已经在墙上的贴纸挪到新落点。拖动中的会被 reposition 跳过。
  wall.reposition(byId);
}

// ── 装配 ─────────────────────────────────────────────────────────────
const tilt = mountTilt(planeEl, wallEl);

// 得在 mountLoupe 之前建好：下面那个 onToggle 里要用它
const share = mountShareButton({ photos });

const loupe = mountLoupe({
  // 放大时把墙按平：倾斜的透视和「凑近了看」是两件事，叠在一起读不清照片。
  // 顺手把右下角那枚导出按钮收起来——浮层盖是盖住了它，但 Tab 还是聚焦得上去。
  onToggle: (open) => {
    tilt.hold(open);
    share.setObscured(open);
  },
});

const wall = mountWall(planeEl, {
  onInspect(photo, el) {
    sfxPickup();
    // 传 photos.json 的顺序而不是墙上的落点顺序，
    // 这样 loupe 里的 ←/→ 是「第 1 张 → 第 21 张」，不是被打散的落点顺序
    loupe.open(photo, el, photos);
  },
});

relayout();
// 按拍摄顺序上墙。落点从 byId 取，所以上墙顺序不影响布局，只影响 loupe 的翻页顺序。
for (const p of photos) {
  const spot = byId.get(p.id);
  if (spot) wall.add(spot);
}

// ── 声音、尺寸、昼夜 ─────────────────────────────────────────────────
// 第一次点按里同时做两件事：解锁 WebAudio，以及（只在需要授权的设备上）申请陀螺仪权限。
// 两者都必须由用户手势触发（iOS 13+ 强制），以前靠顶栏那个「开启体感」按钮提供手势，
// 顶栏删掉之后就挂在这里。
window.addEventListener(
  "pointerdown",
  () => {
    unlockAudio();
    // 桌面端不该走这条路：DeviceOrientationEvent 在桌面浏览器上也存在，
    // 但真正的姿态数据可能来自带运动传感器的笔记本。stage.ts 里 gyroLive
    // 一旦置真就再也没有地方置回 false，而指针视差有 `if (gyroLive) return`——
    // 视差会被永久关掉。只有 iOS 那种必须用户手势授权的平台才需要它。
    if (tilt.needsPermission && navigator.maxTouchPoints > 0) void tilt.enableGyro();
  },
  { once: true },
);

let rt = 0;
addEventListener("resize", () => {
  clearTimeout(rt);
  rt = window.setTimeout(relayout, 220);
});

// 字体晚于首帧才定下来，墙面尺寸会再变一次，得重排
if (document.fonts?.ready) void document.fonts.ready.then(relayout);

function checkLight(): void {
  // ?light=day / ?light=night 用来预览两种灯光，不带参数就按本地时间
  const forced = new URLSearchParams(location.search).get("light");
  if (forced === "day" || forced === "night") {
    document.body.classList.toggle("night", forced === "night");
    return;
  }
  const h = new Date().getHours();
  document.body.classList.toggle("night", h >= 19 || h < 6);
}
checkLight();
setInterval(checkLight, 600000);
