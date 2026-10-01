/**
 * 生成占位图（真照片还没到位时用）。
 * 输出 SVG + photos.json，路径字段与真照片管线完全一致，
 * 所以后续换成 prepare-photos.mjs 产物时前端代码不用动。
 *
 * 图上不写任何字：日期、张数这些系统信息从照片上全部拿掉了，
 * 照片上出现的一切都应该是人自己写的。文字走 captions.json。
 *
 *   node scripts/make-demo-photos.mjs [张数，默认 21]
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public/photos");
const dataFile = path.join(root, "src/data/photos.json");

/** 占位图总数 */
const COUNT = Number(process.argv[2] ?? 21);

/** mulberry32：同一 seed 永远同一张图 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 低饱和的"照片色"，刻意避开页面 UI 色，避免跟墙抢注意力 */
const PALETTES = [
  ["#3E5063", "#7B8794", "#C3C0B4"],
  ["#6B5342", "#9C8468", "#D6C9B2"],
  ["#46564A", "#7C8A76", "#C2C4AE"],
  ["#5B4A55", "#8E7B84", "#CFC2BE"],
  ["#43525A", "#77898D", "#BCC5C0"],
  ["#6E5B45", "#A08D6F", "#D8CDB4"],
  ["#4B4E63", "#7B7E94", "#C3C2C6"],
];

// 真照片是 3:4 或 4:3——同一个形状的两个朝向，所以不管怎么混，
// 拍立得外框的形状都是一致的，只是有的竖放有的横放。
const SHAPES = [
  [3, 4],
  [4, 3],
];
// 步长和 SHAPES 长度互质，否则 i*步长 % 2 永远是同一个数，全是一个朝向。
const STEP = 7;

/** 占位图也得有正面那句话和背面的故事，不然白条和「翻面」没法验收。
    真照片进来后由 prepare-photos.mjs 从 captions.json 读，这里只是先顶上。 */
const LINES = [
  "出门前才发现忘了带伞。",
  "这条路走了三次才找到对的。",
  "风比想象中大，帽子吹跑了。",
  "楼下的猫认得我们了。",
  "坐在台阶上吃了半小时。",
  "天黑得比预报早。",
  "手机剩百分之三，没敢点手电。",
  "相机里唯一一张糊的也是这张。",
  "她说这张最好看，我信了。",
  "刚好赶上末班车。",
  "灯一开，影子比人先到。",
  "在便利店门口站了很久。",
  "第一次觉得排队也不坏。",
  "同行的人先睡着了。",
  "路过的小店还开着。",
];

const STORIES = [
  "早上出门的时候天还是阴的，走到一半太阳就出来了。伞一直没打开，倒是被用来挡了两回车。",
  "导航说二十分钟，我们走了快一个钟头。中间在一家卖凉茶的铺子停下，老板说这条路他也常走错。",
  "风大得说话都得凑到耳边。帽子是去年买的，飞出去之后挂在了树上，够不着，就留给树了。",
  "楼下那只橘猫本来是躲人的，第三天开始蹲在台阶上等。它不吃面包，只吃火腿肠。",
  "台阶是石头的，坐久了有点凉。买了两个包子，一人一个，看着对面楼上的晾衣绳发呆。",
  "预报说六点半天黑，结果五点四十就暗下来了。路灯亮的那一下，整条街的颜色都变了。",
  "出门忘了带充电宝，一整天都省着用。最后那张是关了闪光灯拍的，反而比别的都好看。",
  "那天光很好，我急着按快门，手抖了。回来看才发现糊成这样，但舍不得删。",
  "她指着这张说好看，我看了半天没看出哪儿好看。后来洗出来贴在墙上，好像确实还行。",
  "从店里出来已经快十点了，一路小跑。到站台的时候车正好进站，司机还等了我们两秒。",
  "进门的时候天已经全黑，开灯的一瞬间，墙上的影子比人先进屋。站在原地愣了两秒才反应过来。",
  "那家便利店门口有个长椅，我们坐着把刚买的水喝完。看进出的人，猜他们要去哪儿。",
  "队伍排到了门外，本来想走的，结果发现前面那对老夫妻在聊很老的事，就听进去了。",
  "车上颠得厉害，同行的人靠着窗睡着了。我拍了一张，怕快门声吵醒他，其实根本听不见。",
  "拐进巷子的时候以为走错了，那家店还开着，灯是暖的。老板认得我们，说好久没来了。",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

function svg({ seed, w, h, palette }) {
  const r = rng(seed);
  const [a, b, c] = palette;
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const cx = r() * w;
    const cy = r() * h;
    const rad = (0.22 + r() * 0.4) * Math.max(w, h);
    const fill = [a, b, c][i % 3];
    return `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rad.toFixed(0)}" ry="${(rad * (0.5 + r() * 0.6)).toFixed(0)}" fill="${fill}" opacity="${(0.28 + r() * 0.34).toFixed(2)}" transform="rotate(${(r() * 60 - 30).toFixed(1)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="${(r()).toFixed(2)}" y2="1">
<stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/>
</linearGradient>
<filter id="n" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/>
<feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
</filter>
<filter id="s" x="-20%" y="-20%" width="140%" height="140%">
<feGaussianBlur stdDeviation="${(Math.max(w, h) * 0.06).toFixed(0)}"/>
</filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<g filter="url(#s)">${blobs}</g>
<rect width="${w}" height="${h}" filter="url(#n)" opacity="0.22" style="mix-blend-mode:overlay"/>
</svg>`;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const photos = [];
for (let i = 0; i < COUNT; i++) {
  // shot 只是数据里的一个字段，页面上不显示任何日期，按顺序铺开就够
  const shot = Math.min(31, i + 1);
  const id = `p${pad(i + 1)}`;
  const [rw, rh] = SHAPES[(i * STEP) % SHAPES.length];
  const w = 900;
  const h = Math.round((w * rh) / rw);
  const palette = PALETTES[(i * 3) % PALETTES.length];
  const file = `${id}.svg`;
  await writeFile(path.join(outDir, file), svg({ seed: i * 977 + 7, w, h, palette }));
  photos.push({
    id,
    page: i + 1,
    shot,
    thumb: `/photos/${file}`,
    card: `/photos/${file}`,
    full: `/photos/${file}`,
    w,
    h,
    color: palette[0],
    // 两个步长都和数组长度（15）互质，否则会几组几组地重复
    caption: LINES[(i * 7) % LINES.length],
    story: STORIES[(i * 11) % STORIES.length],
  });
}

await writeFile(
  dataFile,
  `${JSON.stringify({ generated: new Date().toISOString(), demo: true, photos }, null, 2)}\n`,
);

console.log(`占位图 ${photos.length} 张 → public/photos/`);
console.log(`photos.json → src/data/photos.json`);