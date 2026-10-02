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
import { Spring } from "../core/spring";
import { ticker } from "../core/ticker";

const TURN_OUT = 190;
const TURN_IN = 340;
const LIFT = 440;
const EASE_OUT = "cubic-bezier(0.16, 0.84, 0.28, 1)";

/** 拖拽翻页的三个门槛 */
const TAP_SLOP = 6;
/** 甩动的速度线，px/ms。快速划一下就算翻，不用划够远 */
const FLICK = 0.45;
/** 提交位移取照片宽的四分之一，封顶 140px——照片越宽越难推动 */
const COMMIT_RATIO = 0.25;
const COMMIT_MAX = 140;

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
   * 拖拽专用的一层，和 flipper 同一个道理。
   *
   * 开合与翻页的 WAAPI 写 .loupe__print 的 transform，翻面的 transition 写
   * .loupe__flipper 的。拖拽要是也去挤这两个元素，第三个系统就会把前两个盖掉。
   * 所以三层各管各的：drag 只被内联 style 驱动，谁也不碰。
   */
  drag: HTMLElement;
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
  /** 白条截断时右下角的「展开」提示。不接收点击，点它等于点白条 */
  bandMore: HTMLElement;
  /** 背面居中的容器。真正装字的是里层的 storyText，好量溢出 */
  story: HTMLElement;
  storyText: HTMLElement;
  storyMore: HTMLElement;
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
    drag: el("div", "loupe__drag"),
    flipper: el("div", "loupe__flipper"),
    front: el("div", "loupe__face loupe__face--front"),
    back: el("div", "loupe__face loupe__face--back"),
    img: el("img"),
    ghost: el("img", "loupe__ghost"),
    band: el("p", "loupe__band"),
    bandText: el("span", "loupe__band-text"),
    bandMore: el("span", "loupe__more loupe__more--band"),
    story: el("p", "loupe__story"),
    storyText: el("span", "loupe__story-text"),
    storyMore: el("span", "loupe__more loupe__more--story"),
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
  p.front.append(p.img, tape, p.band, p.bandMore);
  p.story.append(p.storyText);
  p.back.append(p.ghost, p.story, p.storyMore);
  p.flipper.append(p.front, p.back);
  p.print.append(p.flipper);

  const meta = el("div", "loupe__meta");
  meta.append(p.count);

  const hint = el("p", "loupe__hint");
  hint.textContent = "拖一拖或按 ← → 翻页 · 点照片翻面 · 点空白处放回去 · 点文字看全文";

  // 照片和下面那行计数一起装进 drag：翻页时它们该作为一个整体被推开。
  // stage 只剩定位和 perspective——翻面的透视要包住 flipper，中间插一层不影响。
  p.drag.append(p.print, meta);

  const stage = el("div", "loupe__stage");
  stage.append(p.drag);

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
  /** 白条 / 背面的长文是不是展开着。换一张照片、关闭时都复位 */
  let bandOpen = false;
  let storyOpen = false;

  /**
   * 拖拽这一摊的状态。
   *
   * 指针事件挂在遮罩上，不挂在照片上：.loupe__stage 是 pointer-events: none
   * （为了让点击穿到遮罩上），照片区域的 pointerdown 压根收不到，只会穿到遮罩。
   * 遮罩本来就是那个「接住一切非交互点击」的面。
   */
  let pid = -1;
  let startX = 0;
  let lastX = 0;
  let lastT = 0;
  /** 这次按下累计的最大横向位移。超过 TAP_SLOP 才算「在拖」而不是「在点」 */
  let dragged = 0;
  /** 抬手瞬间的瞬时速度，px/ms，用来判「快速划一下」 */
  let vel = 0;
  /** 往回弹的弹簧。ticker 空闲时完全停机，只有弹回去那几百毫秒在跑 */
  const dragX = new Spring(0, 260, 26);
  let dragSub: symbol | null = null;

  /**
   * 量一下白条和背面有没有被截断，顺便把「可展开」的状态和提示挂上去。
   *
   * 两个都是用 -webkit-line-clamp 截断的。被 clamp 之后 offsetHeight 只剩
   * 显示出来的那几行，只有 scrollHeight 才是全文高度——所以判断截断必须看
   * scrollHeight > clientHeight。
   */
  function syncClamp(): void {
    const bandClamped = p.bandText.scrollHeight > p.bandText.clientHeight + 1;
    const storyClamped = p.storyText.scrollHeight > p.storyText.clientHeight + 1;

    p.band.classList.toggle("is-clamped", bandClamped && !bandOpen);
    p.story.classList.toggle("is-clamped", storyClamped && !storyOpen);

    p.bandMore.textContent = bandOpen ? "收起" : "展开";
    p.storyMore.textContent = storyOpen ? "收起" : "展开全部";
    p.bandMore.hidden = !bandClamped && !bandOpen;
    p.storyMore.hidden = !storyClamped && !storyOpen;
    p.bandMore.setAttribute("aria-expanded", String(bandOpen));
    p.storyMore.setAttribute("aria-expanded", String(storyOpen));
    p.band.setAttribute("role", bandClamped || bandOpen ? "button" : "presentation");
    p.story.setAttribute("role", storyClamped || storyOpen ? "button" : "presentation");
  }

  /** 白条：就地长高，照片本身不动 */
  function setBandOpen(on: boolean): void {
    bandOpen = on;
    p.band.classList.toggle("is-expanded", on);
    // 顺序要紧：先摘掉 is-clamped（它会占掉右侧那条给「展开」提示的位置），
    // 再量高度。反过来的话量到的是按更窄的宽度排出来的行数，白边会偏厚。
    p.band.classList.remove("is-clamped");
    if (on) {
      const h = Math.max(40, p.bandText.scrollHeight + 14);
      p.front.style.setProperty("--band-h", `${h}px`);
    } else {
      p.front.style.removeProperty("--band-h");
    }
    syncClamp();
  }

  /** 背面：卡片不动，文字解开截断，超出就在背面里滚 */
  function setStoryOpen(on: boolean): void {
    storyOpen = on;
    p.story.classList.toggle("is-expanded", on);
    syncClamp();
    if (on) p.story.scrollTop = 0;
  }

  function resetOpen(): void {
    setBandOpen(false);
    setStoryOpen(false);
  }

  /**
   * 点文字任意处切换。拖选文字的那一下不算——不然想选几个字就会把整段收起来。
   * 没被截断时点了也没反应，不留「点了没用」的错觉；除非调用方给了 onIdle
   * （背面用它来翻回正面，见下面 wireToggle 的第四个参数）。
   */
  function wireToggle(
    el: HTMLElement,
    isActive: () => boolean,
    toggle: () => void,
    onIdle?: () => void,
  ): void {
    el.addEventListener("click", () => {
      if (window.getSelection()?.toString()) return;
      if (!isActive()) {
        onIdle?.();
        return;
      }
      toggle();
    });
  }

  /** 左右翻页按钮的可用状态 */
  function syncNav(): void {
    const many = list.length > 1;
    p.prev.hidden = !many;
    p.next.hidden = !many;
    // 看背面的时候禁掉翻页：先翻回正面才谈得上翻下一张
    p.prev.disabled = flipped;
    p.next.disabled = flipped;
    // 只有一张照片就没有「拖」这回事，光标也不该摆出 grab 的样子
    p.root.classList.toggle("can-drag", many);
  }

  /**
   * 提示语。只有一张照片时别提翻页——根本没有下一张。
   *
   * 这行只在有键盘的那一档露脸（CSS 里窄屏和 coarse pointer 都藏了），
   * 所以两种文案都按「有键盘」来写。
   */
  function syncHint(): void {
    hint.textContent =
      list.length > 1
        ? "拖一拖或按 ← → 翻页 · 点照片翻面 · 点空白处放回去 · 点文字看全文"
        : "点照片翻面 · 点空白处放回去 · 点文字看全文";
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
    // 翻页的外飞段照片在飞，这时候翻面会让刚换上的照片停在背面
    if (busy || !list[index]) return;
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
    syncHint();
    // 换一张照片就把展开状态收回去，别带过来
    resetOpen();
    // 量截断要等布局落定。量到截断就在控制台点名是哪一张——
    // 页面上只是多了个省略号，看不出「超了」，但写的人需要知道。
    requestAnimationFrame(() => {
      syncClamp();
      if (p.band.classList.contains("is-clamped")) {
        console.warn(`[loupe] ${photo.id} 的白条放不下，已截断（点它可展开）：「${photo.caption}」`);
      }
      if (p.story.classList.contains("is-clamped")) {
        console.warn(`[loupe] ${photo.id} 的背面放不下，已截断（点它可展开）：「${photo.story}」`);
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

  /**
   * 翻下一张 / 上一张。
   *
   * fromX 是「外飞」动画的起始横向位移，只有拖拽松手时会传——那时照片已经被
   * 推到 dx 了，外飞得从那儿接着走才接得上。按钮和方向键不传，fromX 就是 0，
   * 头一帧是恒等变换，动画和以前逐帧一样。
   */
  function turn(dir: number, fromX = 0): void {
    // 看背面的时候不能翻页：先翻回正面
    if (busy || flipped || list.length < 2) return;
    busy = true;
    play(
      [
        { transform: `translateX(${fromX.toFixed(1)}px) scale(1)`, opacity: 1 },
        {
          transform: `translateX(${(fromX + dir * 30).toFixed(1)}px) scale(.982)`,
          opacity: 0,
        },
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
    resetOpen();
    p.prev.disabled = true;
    p.next.disabled = true;
    window.clearTimeout(timer);
    anim?.cancel();
    anim = null;
    busy = false;
    // 拖到一半关掉（比如按了 Esc），别把位移留在 drag 层上
    pid = -1;
    dragged = 0;
    p.root.classList.remove("is-dragging");
    dragX.reset(0);
    paintDrag();
    opts.onToggle?.(false);
    restore?.focus();
    restore = null;
  }

  /**
   * 拖拽位移唯一的出口。手指跟手和松手回弹都走这里，
   * 保证「跟手」和「弹回」之间不会因为写了两套而手感不一致。
   */
  function paintDrag(): void {
    const x = dragX.value;
    p.drag.style.transform = x ? `translate3d(${x.toFixed(2)}px, 0, 0)` : "";
    // 推过提交线就压暗一点，给「再推就翻了」一点提示
    p.root.classList.toggle("is-armed", Math.abs(x) > commitDist());
  }

  /** 提交线取照片宽的四分之一，但封顶——不然大照片怎么推都不够 */
  function commitDist(): number {
    return Math.min(COMMIT_MAX, p.print.offsetWidth * COMMIT_RATIO);
  }

  /**
   * 松手的位置是不是落在相纸上。
   *
   * 相纸整条链（stage / drag / print / flipper / face）都继承了 pointer-events: none，
   * 点它等于点遮罩——所以「点的是照片还是空白」只能自己量。量 print 的 rect 就够。
   * 用 rect 而不是给相纸开 pointer-events: auto，是因为开了它就收不到 pointerdown，
   * 拖拽翻页会当场失灵（监听器在遮罩上，遮罩不是相纸的祖先）。
   */
  function overPrint(clientX: number, clientY: number): boolean {
    const r = p.print.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /** 松手没推够，弹回原位。减弱动态效果时这一步直接省略 */
  function springBack(): void {
    if (reduced) {
      dragX.reset(0);
      paintDrag();
      return;
    }
    if (dragSub) return;
    dragX.target = 0;
    // tick 返回 false 表示静止，ticker 会自己把这个订阅摘掉，空闲时 rAF 停机
    dragSub = ticker.add((dt) => {
      const done = dragX.step(dt);
      paintDrag();
      if (done) dragSub = null;
      return !done;
    });
  }

  p.scrim.addEventListener("click", (e) => {
    // 点照片打开 loupe 的那次 pointerup 之后，浏览器还会补发一个兼容性的 click。
    // 那时 pointerup 目标上的指针捕获已经释放，浏览器改为在松手位置重新做命中测试——
    // 而那个位置最上层正好是刚显示出来的 scrim，于是 loupe 被自己刚打开的这一下
    // 立刻关掉，表现成「点照片完全没反应」。刚打开的这一个不算数。
    if (performance.now() - openedAt < 400) return;
    // 拖完松手浏览器同样会补一个 click。不挡掉的话，每翻一页都会顺手把 loupe 关了。
    if (dragged > TAP_SLOP) return;
    // 上面这两道守卫挡的 click 恰好都落在相纸上，所以必须在命中测试之前返回，
    // 否则「点开大图」和「拖拽翻页」都会顺带翻一次面。
    // 点在相纸上 = 翻面，点在空白 = 放回墙上。
    // 翻到背面之后点击走不到这儿——.loupe__story 是 pointer-events:auto，铺满整个背面。
    if (overPrint(e.clientX, e.clientY)) flip();
    else close();
  });

  /**
   * 拖拽翻页。手指划和鼠标拖是同一套 pointer 事件，不按设备分叉。
   *
   * 监听器挂在遮罩上而不是照片上：.loupe__stage 是 pointer-events: none，
   * 照片区域的 pointerdown 压根收不到，永远只会穿到遮罩这一层。
   */
  p.scrim.addEventListener("pointerdown", (e) => {
    if (pid !== -1) return;
    // 正在翻页 / 看背面 / 只有一张：都不该起手
    if (busy || flipped || list.length < 2) return;
    if (e.button !== 0) return;
    // 正在选文字就别抢人家的事
    if (window.getSelection()?.toString()) return;
    // 白条和背面各自 pointer-events: auto：选字、滚动、点开展开都在那儿，不该被拖走
    if (e.target instanceof Element && e.target.closest(".loupe__band, .loupe__story")) {
      return;
    }

    pid = e.pointerId;
    p.scrim.setPointerCapture(pid);
    startX = lastX = e.clientX;
    lastT = performance.now();
    dragged = 0;
    vel = 0;
  });

  p.scrim.addEventListener("pointermove", (e) => {
    if (pid === -1 || e.pointerId !== pid) return;
    const dx = e.clientX - startX;
    // 横向没超过一点点之前一律不动照片，免得一次普通点按把它抖一下
    if (dragged <= TAP_SLOP && Math.abs(dx) <= TAP_SLOP) return;

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    dragged = Math.max(dragged, Math.abs(dx));
    vel = (e.clientX - lastX) / dt;
    lastX = e.clientX;
    lastT = now;

    p.root.classList.add("is-dragging");
    dragX.reset(dx);
    paintDrag();
  });

  const endDrag = (e: PointerEvent, cancelled: boolean): void => {
    if (pid === -1 || e.pointerId !== pid) return;
    try {
      p.scrim.releasePointerCapture(pid);
    } catch {
      /* 指针已消失 */
    }
    const wasDragging = dragged > TAP_SLOP;
    pid = -1;
    p.root.classList.remove("is-dragging");

    // 只是一次点按：transform 从没动过，让遮罩的 click 照常把 loupe 关掉
    if (!wasDragging) return;

    const x = dragX.value;
    // 停了一会儿再松手就不算「甩」了——那一瞬人其实是停着的，
    // 拿最后一次 pointermove 算出来的速度会把人误判成想翻页
    const speed = performance.now() - lastT > 90 ? 0 : vel;
    // 甩动的方向说了算：拖到一半往回划一下，就该翻回上一张
    const dir = speed !== 0 ? Math.sign(speed) : Math.sign(x);

    if (!cancelled && (Math.abs(speed) >= FLICK || Math.abs(x) >= commitDist())) {
      // 父层归零、子层从 x 接着外飞，两层一加，视觉上就是从手指放开的地方继续走
      dragX.reset(0);
      paintDrag();
      turn(dir, x);
    } else {
      springBack();
    }
  };

  p.scrim.addEventListener("pointerup", (e) => endDrag(e, false));
  // 系统手势抢走、或者指针捕获意外丢失：一律弹回，绝不当作翻页
  p.scrim.addEventListener("pointercancel", (e) => endDrag(e, true));
  p.scrim.addEventListener("lostpointercapture", (e) => endDrag(e, true));
  p.close.addEventListener("click", close);
  p.flip.addEventListener("click", flip);
  p.prev.addEventListener("click", () => turn(-1));
  p.next.addEventListener("click", () => turn(1));

  // 白条和背面的长文：点任意处展开 / 收起
  wireToggle(
    p.band,
    () => p.band.classList.contains("is-clamped") || bandOpen,
    () => setBandOpen(!bandOpen),
  );
  wireToggle(
    p.story,
    () => p.story.classList.contains("is-clamped") || storyOpen,
    () => setStoryOpen(!storyOpen),
    // 故事放得下时这一层是整个背面（height:100%），点击全落在这儿，到不了遮罩，
    // 翻回来只能从这里走。故事被截断时仍然是展开/收起优先，翻面得用右上角那颗按钮。
    flip,
  );

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
    // 上一次没弹回去的位移别带过来
    pid = -1;
    dragged = 0;
    dragX.reset(0);
    paintDrag();

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
