/**
 * 弹簧-阻尼积分器。
 * 半隐式欧拉，固定子步长保证不同刷新率下手感一致、不炸。
 */

const SUBSTEP = 1 / 240;

export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(
    value = 0,
    private stiffness = 170,
    private damping = 16,
  ) {
    this.value = value;
    this.target = value;
  }

  /** 瞬时跳转，不留速度 */
  reset(v = this.target): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  get settled(): boolean {
    return this.value === this.target && this.velocity === 0;
  }

  /** 推进 dt 秒。返回 true 表示已静止 */
  step(dt: number): boolean {
    let remaining = Math.min(dt, 0.064);
    while (remaining > 0) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      const force = -this.stiffness * (this.value - this.target);
      this.velocity += (force - this.damping * this.velocity) * h;
      this.value += this.velocity * h;
    }
    const span = Math.abs(this.value - this.target);
    if (span < 0.0015 && Math.abs(this.velocity) < 0.0015) {
      this.value = this.target;
      this.velocity = 0;
      return true;
    }
    return false;
  }
}

/** 三个独立弹簧捆在一起，用来做位移/旋转偏移 */
export class Spring3 {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;

  constructor(value = 0, stiffness = 170, damping = 16) {
    this.x = new Spring(value, stiffness, damping);
    this.y = new Spring(value, stiffness, damping);
    this.z = new Spring(value, stiffness, damping);
  }

  /** 瞬时跳转，不留速度。省略的参数保持原值 */
  reset(x: number, y = this.y.value, z = this.z.value): void {
    this.x.reset(x);
    this.y.reset(y);
    this.z.reset(z);
  }

  setTarget(x: number, y: number, z: number): void {
    this.x.target = x;
    this.y.target = y;
    this.z.target = z;
  }

  setVelocity(x: number, y: number, z: number): void {
    this.x.velocity = x;
    this.y.velocity = y;
    this.z.velocity = z;
  }

  get settled(): boolean {
    return this.x.settled && this.y.settled && this.z.settled;
  }

  step(dt: number): boolean {
    const a = this.x.step(dt);
    const b = this.y.step(dt);
    const c = this.z.step(dt);
    return a && b && c;
  }
}

/** 指数趋近，用于不需要惯性的视觉跟随（陀螺仪视差） */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}