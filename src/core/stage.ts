/**
 * 墙面 3D 舞台：鼠标 / 陀螺仪 → 弹簧 → 整面墙的透视倾斜。
 * 两套输入驱动同一组目标值，用户随时可以互相覆盖。
 */
import { ticker } from "./ticker";
import { approach } from "./spring";

const MAX_TILT = 8; // deg
const GYRO_RANGE = 26; // deg，对应满舵

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** iOS 13+ 的 requestPermission 不在标准 lib 里 */
type DeviceOrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

export interface Tilt {
  /** 平台是否需要用户手势才能开陀螺仪（iOS 13+） */
  needsPermission: boolean;
  /** 在用户手势里调用。返回是否真的拿到了姿态数据 */
  enableGyro(): Promise<boolean>;
  /** 临时接管倾角。传 true 时墙自己回正，锁到 false 为止 */
  hold(on: boolean): void;
}

export function mountTilt(
  plane: HTMLElement,
  wall: HTMLElement,
  /** 拿到（或没拿到）姿态数据时通知一次。没有 UI 要提示就省略 */
  onGyroChange: (ok: boolean) => void = () => {},
): Tilt {
  let tx = 0;
  let ty = 0;
  let vx = 0;
  let vy = 0;
  let sub: symbol | null = null;
  let gyroLive = false;
  let gyroBase: number | null = null;
  let held = false;

  const render = () => {
    plane.style.transform = `rotateX(${vx.toFixed(3)}deg) rotateY(${vy.toFixed(3)}deg)`;
  };

  const run = () => {
    if (sub) return;
    sub = ticker.add((dt) => {
      const px = vx;
      const py = vy;
      vx = approach(vx, tx, 9, dt);
      vy = approach(vy, ty, 9, dt);
      if (
        Math.abs(vx - px) < 0.003 &&
        Math.abs(vy - py) < 0.003 &&
        Math.abs(vx - tx) < 0.01 &&
        Math.abs(vy - ty) < 0.01
      ) {
        vx = tx;
        vy = ty;
        render();
        // 先把 sub 清掉再退场。ticker 会因为返回 false 把订阅者删掉，
        // 但那个 symbol 还留在这里，下一次 run() 就会被上面的 if (sub) 挡住——
        // 弹簧第一次静止之后视差就永久死了。sticker.ts 的 run() 是同样的写法。
        sub = null;
        return false;
      }
      render();
      return true;
    });
  };

  // ── 指针视差 ────────────────────────────────────────────────────────
  wall.addEventListener(
    "pointermove",
    (e) => {
      if (gyroLive || held) return;
      const r = wall.getBoundingClientRect();
      const nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      const ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      ty = nx * MAX_TILT;
      tx = -ny * MAX_TILT;
      run();
    },
    { passive: true },
  );

  wall.addEventListener(
    "pointerleave",
    () => {
      if (gyroLive || held) return;
      tx = 0;
      ty = 0;
      run();
    },
    { passive: true },
  );

  // ── 陀螺仪 ─────────────────────────────────────────────────────────
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    gyroLive = true;
    if (gyroBase === null) gyroBase = e.beta;
    if (held) return;
    ty = clamp(e.gamma / GYRO_RANGE, -1, 1) * MAX_TILT;
    tx = -clamp((e.beta - gyroBase) / GYRO_RANGE, -1, 1) * MAX_TILT;
    run();
  };

  /** 必须在用户手势里调用（iOS 13+ 强制） */
  async function enableGyro(): Promise<boolean> {
    const D = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventCtor })
      .DeviceOrientationEvent;
    if (!D) return false;
    try {
      if (typeof D.requestPermission === "function") {
        const res = (await D.requestPermission()) as PermissionState;
        if (res !== "granted") return false;
      }
    } catch {
      return false;
    }
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    // 给 200ms 拿到第一个真实读数再回报
    return new Promise((resolve) => {
      setTimeout(() => {
        onGyroChange(gyroLive);
        resolve(gyroLive);
      }, 220);
    });
  }

  return {
    needsPermission:
      typeof (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventCtor })
        .DeviceOrientationEvent?.requestPermission === "function",
    enableGyro,
    hold(on) {
      held = on;
      if (on) {
        tx = 0;
        ty = 0;
      }
      run();
    },
  };
}
