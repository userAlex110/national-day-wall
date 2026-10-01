/**
 * 脏标记调度器。
 * 每个订阅者返回 false 即视为静止、自动退场；全部退场后 rAF 完全停机，
 * 页面空闲时 CPU 占用归零。
 */

export type Tick = (dt: number) => boolean;

export class Ticker {
  private readonly subs = new Map<symbol, Tick>();
  private running = false;
  private last = 0;
  private readonly loop = (now: number): void => {
    const dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    for (const [id, tick] of [...this.subs]) {
      if (!tick(dt)) this.subs.delete(id);
    }
    if (this.subs.size > 0) {
      requestAnimationFrame(this.loop);
    } else {
      this.running = false;
    }
  };

  add(tick: Tick): symbol {
    const id = Symbol("tick");
    this.subs.set(id, tick);
    this.wake();
    return id;
  }

  remove(id: symbol): void {
    this.subs.delete(id);
  }

  /** 外部状态变化后把订阅者叫醒继续跑 */
  wake(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.loop);
  }

  get size(): number {
    return this.subs.size;
  }
}

export const ticker = new Ticker();