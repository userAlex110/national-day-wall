/**
 * 右下角那枚「存成一张图」。
 *
 * 这个页面本来一点 UI 都没有（整页就是一面墙），所以按钮必须小、必须像墙上
 * 本来就有的东西——做成一张压着和纸胶带的纸片，和墙、和 loupe 里的按钮同一套材质。
 *
 * ── 为什么要「预热」 ────────────────────────────────────────────────
 * iOS 上 navigator.share 必须在一个还没过期的用户手势里调用，而那个令牌大约
 * 一秒就失效了。而「点一下 → 加载图 → 画两百万像素 → toBlob」在真机上轻松
 * 超过一秒，分享面板根本不会弹（报 NotAllowedError）。
 *
 * 所以：页面空闲时先把图渲染好、把 blob 存住，点击时在同一个手势里**同步**
 * 调 share()，一下就能弹出来。代价是没人点的时候也白画一张——只在
 * navigator.share 存在的设备上预热，桌面 Chrome 那种走下载的不受这条约束，
 * 就不预热了。
 *
 * 万一那一下点得太快、预热还没好，就退成两步：先出「点一下分享」，
 * 第二次点击时 blob 已经在手，同步调 share() 一定成功。
 */
import type { Photo } from "../data/config";
import { renderPoster } from "./poster";

const FILE_NAME = "国庆七天-照片墙.jpg";
const SHARE_TEXT = "国庆七天 · 照片墙";

/** 预热要等墙先画完，别跟首屏抢 */
const PREWARM_DELAY = 1500;

type State = "idle" | "working" | "ready" | "error";

const LABEL: Record<State, string> = {
  idle: "存成一张图",
  working: "正在生成…",
  ready: "点一下分享",
  error: "没成功，再试一次",
};

export interface ShareButtonOpts {
  photos: Photo[];
}

export interface ShareButton {
  /** loupe 打开时把它藏起来 */
  setObscured(open: boolean): void;
}

type Verdict = "ok" | "aborted" | "stale" | "unsupported";

export function mountShareButton(opts: ShareButtonOpts): ShareButton {
  // 一张照片都没有就别挂一枚按了也没用的按钮
  if (!opts.photos.length) return { setObscured() {} };

  // 外面套一层：胶带要压在纸片的上沿、探出去一截，而 button 在有些浏览器里
  // 会被 UA 样式裁掉溢出的内容。让胶带挂在 wrapper 上就没这回事了。
  const wrap = document.createElement("div");
  wrap.className = "share";

  const el = document.createElement("button");
  el.type = "button";
  el.className = "share__btn";
  el.dataset.state = "idle";
  el.setAttribute("aria-label", "把这面墙存成一张图");

  const label = document.createElement("span");
  label.className = "share__label";
  label.textContent = LABEL.idle;

  // 和墙上、loupe 上同一卷和纸胶带（wall.css 的 .tape）
  const tape = document.createElement("span");
  tape.className = "tape tape--mustard";
  tape.setAttribute("aria-hidden", "true");

  el.append(label);
  wrap.append(el, tape);
  document.body.append(wrap);

  let blob: Blob | null = null;
  let inflight: Promise<Blob> | null = null;
  let busy = false;

  function setState(state: State): void {
    el.dataset.state = state;
    label.textContent = LABEL[state];
    el.disabled = state === "working";
    if (state === "working") el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  }

  /** 渲染一次就存住；同时只会有一张在画 */
  function ensure(): Promise<Blob> {
    if (blob) return Promise.resolve(blob);
    inflight ??= renderPoster(opts.photos)
      .then((b) => {
        blob = b;
        return b;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  /**
   * 交给系统分享面板。返回：
   *  · ok         —— 发出去了
   *  · aborted    —— 用户自己把面板划掉了，这不是错误，什么都别提示
   *  · stale      —— 手势过期了，需要用户再点一下
   *  · unsupported—— 这台设备没有分享面板，走下载
   */
  async function share(b: Blob): Promise<Verdict> {
    if (typeof navigator.share !== "function") return "unsupported";
    // 必须是 File，裸 Blob 会被 share 拒掉
    const file = new File([b], FILE_NAME, { type: "image/jpeg" });
    const payload: ShareData = { files: [file], title: document.title, text: SHARE_TEXT };
    try {
      // 有些浏览器遇到不合法的 payload 是直接抛，不是返回 false
      if (navigator.canShare && !navigator.canShare(payload)) return "unsupported";
    } catch {
      return "unsupported";
    }
    try {
      await navigator.share(payload);
      return "ok";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "aborted";
      if (err instanceof DOMException && err.name === "NotAllowedError") return "stale";
      throw err;
    }
  }

  /** 存下来。iOS 上这条路进的是「文件」不是「照片」，所以它只是备选。 */
  function download(b: Blob): void {
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = FILE_NAME;
    // Firefox 要求锚点在文档里才认这次点击
    document.body.append(a);
    a.click();
    a.remove();
    // 下一轮宏任务再撤销。同步撤销会在 Safari 上把下载掐断。
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  el.addEventListener("click", () => {
    if (busy) return;
    void (async () => {
      busy = true;
      const had = blob !== null;
      try {
        if (!blob) {
          setState("working");
          await ensure();
        }
        if (!blob) return;

        const verdict = await share(blob);
        if (verdict === "unsupported") {
          download(blob);
          setState("idle");
        } else if (verdict === "stale" && !had) {
          // 图是刚刚才画好的，那一下手势已经过期了。让用户再点一次——
          // 第二次点击时 blob 已经在手，同步调用一定弹得出来。
          setState("ready");
        } else {
          setState("idle");
        }
      } catch (err) {
        console.warn("[share] 导出失败", err);
        setState("error");
      } finally {
        busy = false;
      }
    })();
  });

  // 只有需要「手势还活着」的设备才值得预热：桌面 Chrome 走下载，不需要
  if (typeof navigator.share === "function") {
    window.setTimeout(() => {
      void document.fonts?.ready.then(() =>
        ensure().catch(() => {
          /* 预热失败不打扰用户，真点的时候会再试一次 */
        }),
      );
    }, PREWARM_DELAY);
  }

  return {
    setObscured(open) {
      wrap.classList.toggle("is-obscured", open);
    },
  };
}
