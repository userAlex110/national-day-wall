/**
 * 音效：全部实时合成，不加载任何音频文件。
 * 现在只剩「把照片从墙上拿起来」这一声。
 */

type AC = AudioContext;

let ctx: AC | null = null;
let noise: AudioBuffer | null = null;
let master: GainNode | null = null;

function ac(): AC | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

function noiseBuffer(c: AC): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.6);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** 必须在用户手势里调一次，否则 iOS 不给声音 */
export function unlockAudio(): void {
  const c = ac();
  if (c && c.state === "suspended") void c.resume();
}

function burst(
  c: AC,
  at: number,
  dur: number,
  peak: number,
  filter: (b: BiquadFilterNode) => BiquadFilterNode,
  rate = 1,
): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.playbackRate.value = rate;

  const bp = c.createBiquadFilter();
  filter(bp);
  src.connect(bp);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  bp.connect(g);
  g.connect(master!);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** 从墙上拿起来：指尖离开相纸的一声轻擦，音高往上带一点 */
export function sfxPickup(): void {
  const c = ac();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;

  burst(
    c,
    t,
    0.14,
    0.13,
    (b) => {
      b.type = "bandpass";
      b.Q.value = 2.4;
      b.frequency.setValueAtTime(900, t);
      b.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
      return b;
    },
    1.1 + Math.random() * 0.2,
  );
}
