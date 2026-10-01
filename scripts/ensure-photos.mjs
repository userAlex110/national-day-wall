/**
 * 兜底：照片相关的那几样东西不在，就先铺一面占位墙。
 *
 * 为什么需要它：这个仓库**不含照片**。`src/data/photos.json`（照片清单）和
 * `public/photos/`（图）都是 npm run photos / npm run demo 生成的，跟着各人的
 * 照片走，所以全在 .gitignore 里。但 main.ts 是**静态 import** photos.json 的——
 * 缺了这个文件，dev 和 build 都会直接报错。
 *
 * 别人 clone 下来第一次跑 npm run dev / build 会走到这里：自动生成 21 张占位图
 * 和对应的清单，打开就是一整面墙。自己拍了照片之后按 README 第一节走
 * `npm run photos` 覆盖掉就行。
 *
 * captions.json 不在这里管：prepare-photos.mjs 自己会处理「文件不在」的情况
 * （第 308 行），没有就是文案全空。
 *
 * 由 package.json 的 predev / prebuild 钩子调用，不用手动跑。
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "src/data/photos.json");
const ogFile = path.join(root, "public/og.jpg");

if (!existsSync(dataFile)) {
  console.log("src/data/photos.json 不在（刚 clone 下来都是这样），先铺一面占位墙…");
  // make-demo-photos.mjs 是顶层 await 的 ESM，直接 import 就会跑完
  await import("./make-demo-photos.mjs");
}

if (!existsSync(ogFile)) {
  // 分享卡片是从照片算出来的，所以必须等占位墙铺好之后再生成。
  //
  // 单独开一个进程而不是 import：make-og.mjs 缺 sharp 时会 process.exit(1)，
  // 那个 exit 是 import 拦不住的，会把整个 prebuild 一起带崩。
  // 而缺一张分享卡片只是 og:image 404，页面本身照常能用——不该因此构建失败。
  console.log("public/og.jpg 不在，用占位墙生成一张分享卡片…");
  const r = spawnSync(process.execPath, [path.join(root, "scripts/make-og.mjs")], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.warn("  ⚠️ 分享卡片没生成出来，og:image 会 404（不影响页面本身）");
  }
}
