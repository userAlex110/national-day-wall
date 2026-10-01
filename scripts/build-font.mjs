/**
 * 标题字。
 *
 * 页面上的大数字、印章、箭头，只有十六个字形真正用得上（0-9、國慶、←→×），
 * 所以不必为它背一整个中文字库。全量 Noto Serif SC 差不多 8MB，
 * 4G 下要等五秒以上；而这十六个字形子集化之后只有几 KB。
 *
 * 便利贴上的字不用这套——那是访客运行时输入的，没法预先知道会出现哪些字，
 * 所以那边继续用系统楷体栈（见 tokens.css 的 --font-hand）。
 *
 * 跑：npm run font
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "public/fonts");

/**
 * 这个字会渲染哪些字，必须跟样式表对得上。
 * 改了这里就要同步改 tokens.css 里 @font-face 的 unicode-range，
 * 不然缺字会静默掉回系统字体（Android 上就是宋体以外的那个随机衬线）。
 */
const GLYPHS = "0123456789國慶←→×";

/** 两个字重：大数字要 900 的厚重，箭头要 300 的细，不然 26px 上太扎眼 */
const WEIGHTS = [
  { w: 900, file: "display-900.woff2" },
  { w: 300, file: "display-300.woff2" },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Google Fonts 的 css2 接口：text 参数进去，返回的就是子集 */
const CSS_URL = (weight, text) =>
  `https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@${weight}&text=${encodeURIComponent(text)}`;

async function grab(weight, file) {
  const css = await (await fetch(CSS_URL(weight, GLYPHS), {
    headers: { "User-Agent": UA },
  })).text();

  const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
  if (!url) throw new Error(`没拿到 ${weight} 的字体地址，Google 返回了：\n${css}`);

  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(resolve(OUT_DIR, file), buf);
  return buf.length;
}

/** unicode-range 写死不如从 Google 给的响应里抄——它知道子集里到底有哪些码位 */
async function ranges() {
  const css = await (
    await fetch(CSS_URL(900, GLYPHS), { headers: { "User-Agent": UA } })
  ).text();
  return css.match(/unicode-range:\s*([^;]+);/)?.[1].trim() ?? "";
}

await mkdir(OUT_DIR, { recursive: true });

const range = await ranges();
const parts = [
  "/* 标题字。十六个字形，两个字重。",
  "   由 scripts/build-font.mjs 生成 —— 改字形要改那个脚本，然后重跑。 */",
  "",
];

let total = 0;
for (const { w, file } of WEIGHTS) {
  const size = await grab(w, file);
  total += size;
  parts.push(
    "@font-face {",
    '  font-family: "Wall Display";',
    "  font-style: normal;",
    `  font-weight: ${w};`,
    "  font-display: swap;",
    `  src: url("/fonts/${file}") format("woff2");`,
    `  unicode-range: ${range};`,
    "}",
    ""
  );
  console.log(`  ${file}  ${(size / 1024).toFixed(1)} KB`);
}

await writeFile(resolve(ROOT, "src/styles/fonts.css"), parts.join("\n"));
console.log(`标题字 ${(total / 1024).toFixed(1)} KB → src/styles/fonts.css`);

// 顺手记一笔，免得以后忘了字体从哪来、能不能再生成
await writeFile(
  resolve(OUT_DIR, "README.txt"),
  [
    "Noto Serif SC, SIL Open Font License 1.1",
    "https://fonts.google.com/noto/specimen/Noto+Serif+SC",
    "",
    "这里是按页面实际用到的字形子集化的，不是全量字体。",
    "重新生成：npm run font",
    "改字形：编辑 scripts/build-font.mjs 里的 GLYPHS，然后重跑。",
    "",
  ].join("\n")
);

// 确认 fonts.css 真的写进去了，别让脚本静默失败
const written = await readFile(resolve(ROOT, "src/styles/fonts.css"), "utf8");
if (!written.includes("Wall Display")) throw new Error("fonts.css 没写对");
