/**
 * 拿起来看：点一下墙上的照片，它离开墙面走到镜头前。
 *
 * 这是整个页面里唯一一处「以照片本身为主角」的地方。墙上的贴纸只有一百来像素，
 * 那是为了让一屏看全；照片真正要被看见是这里。所以开合用 FLIP：
 * 从贴纸在屏幕上的真实位置（含 3D 倾斜的投影）飞到正中，
 * 观感上是「把它揭下来」，不是「加载了一个弹窗」。
 *
 * 背面那句话从墙上的贴纸搬到了这里——一百像素的贴纸翻过来根本读不了。
 */
import type { Photo } from "../data/config";

const TURN_OUT = 190;
const TURN_IN = 340;
const LIFT = 440;
const EASE_OUT = "cubic-bezier(0.16, 0.84, 0.28, 1)";

export interface Loupe {
  open(photo: Photo, from: HTMLElement, list: Photo[]): void;
  close(): void;
}

export interface LoupeOpts {
  /** 开合时各通知一次，好让别的东西让路（比如把墙按平） */
  onToggle?: (open: boolean) => void;
}

interface Parts {
  root: HTMLElement;
  scrim: HTMLButtonElement;
  close: HTMLButtonElement;
  flip: HTMLButtonElement;
  print: HTMLElement;
  /**
   * 翻面专用的一层。
   *
   * 开合和翻页的动画是 WAAPI 直接写 .loupe__print 的 transform 的，
   * 翻面如果也写同一个元素的 transform，两边会互相盖掉——刚打开就按翻面
   * （正是最常见的用法）会看到翻面被开合动画吃掉。所以翻面单独占一层。
   */
  flipper: HTMLElement;
  /** 正面：照片 + 和纸胶带 + 白边上那句话 */
  front: HTMLElement;
  /** 背面：翻过去才看得到的那一面，半透明深色，像举着一张负片 */
  back: HTMLElement;
  img: HTMLImageElement;
  /** 背面上那张镜像、压暗的同一张照片，负责「透光」的质感 */
  ghost: HTMLImageElement;
  band: HTMLElement;
  bandText: HTMLElement;
  /** 背面居中的容器。真正装字的是里层的 storyText，好量溢出 */
  story: HTMLElement;
  storyText: HTMLElement;
  count: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function mountLoupe(opts: LoupeOpts = {}): Loupe {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const p: Parts = {
    root: el("div", "loupe"),
    scrim: el("button", "loupe__scrim"),
    close: el("button", "loupe__close"),
    flip: el("button", "loupe__flip"),
    print: el("figure", "loupe__print"),
    flipper: el("div", "loupe__flipper"),
    front: el("div", "loupe__face loupe__face--front"),
    back: el("div", "loupe__face loupe__face--back"),
    img: el("img"),
    ghost: el("img", "loupe__ghost"),
    band: el("p", "loupe__band"),
    bandText: el("span", "loupe__band-text"),
    story: el("p", "loupe__story"),
    storyText: el("span", "loupe__story-text"),
    count: el("span", "loupe__count"),
    prev: el("button", "loupe__nav loupe__nav--prev"),
    next: el("button", "loupe__nav loupe__nav--next"),
  };

  p.scrim.type = "button";
  p.scrim.setAttribute("aria-label", "把照片放回墙上");
  p.close.type = "button";
  p.close.textContent = "×";
  p.close.setAttribute("aria-label", "把照片放回墙上");
  p.flip.type = "button";
  p.flip.textContent = "翻面";
  p.flip.setAttribute("aria-label", "翻到背面");
  p.flip.setAttribute("aria-pressed", "false");
  p.prev.type = "button";
  p.prev.innerHTML = "&#8592;";
  p.prev.setAttribute("aria-label", "上一张");
  p.next.type = "button";
  p.next.innerHTML = "&#8594;";
  p.next.setAttribute("aria-label", "下一张");
  p.print.setAttribute("role", "dialog");
  p.print.setAttribute("aria-modal", "true");
  p.print.setAttribute("aria-label", "看这张照片");
  p.img.decoding = "async";
  p.img.draggable = false;
  // 背面那张只是透光质感，不承载信息——别让读屏软件把同一张照片念两遍
  p.ghost.alt = "";
  p.ghost.setAttribute("aria-hidden", "true");
  p.ghost.decoding = "async";
  p.ghost.draggable = false;

  const tape = el("span", "tape tape--indigo");
  tape.style.setProperty("--tilt", "-2.4deg");

  p.band.append(p.bandText);
  p.front.append(p.img, tape, p.band);
  p.story.append(p.storyText);
  p.back.append(p.ghost, p.story);
  p.flipper.append(p.front, p.back);
  p.print.append(p.flipper);

  const meta = el("div", "loupe__meta");
  meta.append(p.count);

  const hint = el("p", "loupe__hint");
  hint.textContent = "点空白处放回去 · 空格翻面";

  const stage = el("div", "loupe__stage");
  stage.append(p.print, meta);

  p.root.append(p.scrim, stage, p.prev, p.next, p.flip, p.close, hint);
  document.body.append(p.root);

  let list: Photo[] = [];
  let index = 0;
  let busy = false;
  let anim: Animation | null = null;
  let restore: HTMLElement | null = null;
  let timer = 0;
  /** 上一次打开的时刻，用来忽略打开瞬间那个补发的 click。见下面 scrim 的监听器 */
  let openedAt = 0;
  /** 是不是翻到背面了。看背面时不能翻页，关闭时复位 */
  let flipped = false;

  /** 左右翻页按钮的可用状态 */
  function syncNav(): void {
    const many = list.length > 1;
    p.prev.hidden = !many;
    p.next.hidden = !many;
    // 看背面的时候禁掉翻页：先翻回正面才谈得上翻下一张
    p.prev.disabled = flipped;
    p.next.disabled = flipped;
  }

  /** 只改状态和类名，动画交给 CSS 的 transition。开合与关闭时也用它复位 */
  function setFlipped(on: boolean): void {
    flipped = on;
    p.root.classList.toggle("is-flipped", on);
    p.flip.textContent = on ? "翻回正面" : "翻面";
    p.flip.setAttribute("aria-label", on ? "翻回正面" : "翻到背面");
    p.flip.setAttribute("aria-pressed", String(on));
    syncNav();
  }

  function flip(): void {
    if (!list[index]) return;
    setFlipped(!flipped);
  }

  function paint(): void {
    const photo = list[index];
    if (!photo) return;
    const src = photo.full || photo.card;
    p.img.src = src;
    p.img.alt = photo.caption || "墙上的一张照片";
    // 先把长宽比钉死，图片到位之前布局不跳
    p.img.width = photo.w;
    p.img.height = photo.h;
    // 背面那张是同一张图，镜像 + 压暗，只为了让背面有「透光」的质感
    p.ghost.src = src;
    p.ghost.width = photo.w;
    p.ghost.height = photo.h;
    p.print.style.setProperty("--c", photo.color);
    p.print.classList.add("loupe__print--print");
    p.bandText.textContent = photo.caption ?? "";
    p.storyText.textContent = photo.story ?? "";
    p.count.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : "";
    syncNav();
    // 白条是固定字号 + 固定两行，背面是固定字号 + 固定容器高——两个都是写超了
    // 就静默截断。等布局落定再量一次，超了就在控制台点名是哪一张，
    // 不然只有肉眼能发现。
    requestAnimationFrame(() => {
      if (p.bandText.scrollHeight > p.bandText.clientHeight + 1) {
        console.warn(`[loupe] ${photo.id} 的白条放不下，超出被截断：「${photo.caption}」`);
      }
      if (p.storyText.offsetHeight > p.story.clientHeight + 1) {
        console.warn(`[loupe] ${photo.id} 的背面放不下，超出被截断：「${photo.story}」`);
      }
    });
  }

  /** 相邻两张先解码好，翻页时才是「拿起来」而不是「加载」 */
  function prefetch(): void {
    for (const d of [-1, 1]) {
      const q = list[(index + d + list.length) % list.length];
      if (q) new Image().src = q.full || q.card;
    }
  }

  function turn(dir: number): void {
    // 看背面的时候不能翻页：先翻回正面
    if (busy || flipped || list.length < 2) return;
    busy = true;
    p.print.style.setProperty("--dir", String(dir));
    play(
      [
        { transform: `translateX(${(dir * 30).toFixed(1)}px) scale(.982)`, opacity: 0 },
      ],
      TURN_OUT,
      "ease-in",
      "forwards",
    );
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      index = (index + dir + list.length) % list.length;
      paint();
      prefetch();
      play(
        [
          { transform: `translateX(${(-dir * 24).toFixed(1)}px) scale(1.014)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        TURN_IN,
        EASE_OUT,
        "backwards",
      );
      busy = false;
    }, TURN_OUT);
  }

  /**
   * 开合用 WAAPI 而不是 CSS transition。
   * transition 的收尾要看下一帧有没有真的跑完，标签页一切到后台就永远停在半路；
   * 动画对象由我们显式持有和取消，状态不会漂。
   */
  function play(
    frames: Keyframe[],
    duration: number,
    easing: string,
    fill: FillMode,
  ): void {
    anim?.cancel();
    anim = p.print.animate(frames, {
      // 减弱动态效果：压成一帧。这里必须自己判——样式表里那条
      // @media (prefers-reduced-motion) 只改 animation-*，管不到 WAAPI。
      duration: reduced ? 1 : duration,
      easing,
      fill,
    });
  }

  function close(): void {
    if (!p.root.classList.contains("is-open")) return;
    p.root.classList.remove("is-open");
    setFlipped(false);
    p.prev.disabled = true;
    p.next.disabled = true;
    window.clearTimeout(timer);
    anim?.cancel();
    anim = null;
    busy = false;
    opts.onToggle?.(false);
    restore?.focus();
    restore = null;
  }

  p.scrim.addEventListener("click", () => {
    // 点照片打开 loupe 的那次 pointerup 之后，浏览器还会补发一个兼容性的 click。
    // 那时 pointerup 目标上的指针捕获已经释放，浏览器改为在松手位置重新做命中测试——
    // 而那个位置最上层正好是刚显示出来的 scrim，于是 loupe 被自己刚打开的这一下
    // 立刻关掉，表现成「点照片完全没反应」。刚打开的这一个不算数。
    if (performance.now() - openedAt < 400) return;
    close();
  });
  p.close.addEventListener("click", close);
  p.flip.addEventListener("click", flip);
  p.prev.addEventListener("click", () => turn(-1));
  p.next.addEventListener("click", () => turn(1));

  window.addEventListener("keydown", (e) => {
    if (!p.root.classList.contains("is-open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      turn(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      turn(1);
    } else if (e.key === " " || e.key === "f" || e.key === "F") {
      e.preventDefault();
      flip();
    } else if (e.key === "Tab") {
      // 别让 Tab 走到背后的墙上，只在 loupe 自己「当前可用」的按钮之间循环——
      // 看背面时翻页按钮是禁用的，就不该进循环
      e.preventDefault();
      const ring = [p.prev, p.next, p.flip, p.close].filter((b) => !b.hidden && !b.disabled);
      const at = ring.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.shiftKey ? -1 : 1;
      ring[(at + step + ring.length) % ring.length].focus();
    }
  });

  function open(photo: Photo, from: HTMLElement, photos: Photo[]): void {
    list = photos.length ? photos : [photo];
    index = Math.max(0, list.findIndex((q) => q.id === photo.id));
    restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openedAt = performance.now();
    // 每次打开都从正面开始。翻页按钮的可用状态由 paint() 里的 syncNav() 算。
    setFlipped(false);

    p.root.classList.add("is-open");
    opts.onToggle?.(true);
    paint();
    prefetch();

    // FLIP：先把照片摆到贴纸在屏幕上的位置，再让它自己走回正中
    const fromR = from.getBoundingClientRect();
    const toR = p.print.getBoundingClientRect();
    if (fromR.width > 4 && toR.width > 4) {
      const sx = fromR.width / toR.width;
      const sy = fromR.height / toR.height;
      const dx = fromR.left + fromR.width / 2 - (toR.left + toR.width / 2);
      const dy = fromR.top + fromR.height / 2 - (toR.top + toR.height / 2);
      const rz = Number(from.dataset.rz ?? 0);
      play(
        [
          {
            transform:
              `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) ` +
              `rotate(${rz.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
          },
          { transform: "none" },
        ],
        LIFT,
        EASE_OUT,
        "backwards",
      );
    }

    p.close.focus({ preventScroll: true });
  }

  return { open, close };
}
