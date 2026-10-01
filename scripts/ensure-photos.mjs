/**
 * 兜底：photos.json 不在就先铺一面占位墙。
 *
 * 为什么需要它：src/data/photos.json 是 npm run photos / npm run demo 生成的，
 * 跟着各人自己的照片走，所以不进版本库。但 main.ts 是静态 import 它的——
 * 缺了这个文件，dev 和 build 都会直接报错。
 *
 * 别人 clone 下来第一次跑 npm run dev 的时候会走到这里，
 * 自动生成 21 张占位图 + 一份对应的清单，打开就是一整面墙。
 * 自己拍了照片之后按 README 第一节走 npm run photos 覆盖掉就行。
 *
 * 由 package.json 的 predev / prebuild 钩子调用，不用手动跑。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "src/data/photos.json");

if (existsSync(dataFile)) process.exit(0);

console.log("src/data/photos.json 不在（刚 clone 下来都是这样），先铺一面占位墙…");
// make-demo-photos.mjs 是顶层 await 的 ESM，直接 import 就会跑完
await import("./make-demo-photos.mjs");
