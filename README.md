# 照片墙

一面拍立得照片墙。照片贴在石灰墙上，斜着、叠着，有的竖放有的横放。
点一下能拿起来细看，翻到背面是一段故事。

- **纯静态**：没有后端、没有数据库、没有用户输入。所有文字都由你写死在数据文件里。
- **零依赖运行时**：整个站点就是 HTML + CSS + 一小段 TypeScript，构建出来一共 42KB，gzip 后约 18KB。
- **照片可以一张一张加**：放几张就换掉几位，其余位置保持占位。

线上示例：https://national-day-wall.pages.dev

---

## 快速开始

```bash
git clone <这个仓库>
cd national-day-wall
npm install

npm run dev          # 起本地服务，改代码即时生效
```

打开浏览器就能看到一面铺满占位图的墙。占位文案是古诗和一篇篇小故事，
**你把自己的照片放进去之后，对应位置就会被换掉。**

---

## 一、放照片

### 命名规则：文件名开头的数字就是它在墙上的位置

```
photos/
├── 1x.jpg      → 墙上的第 1 位
├── 2x.jpg      → 第 2 位
├── 3x.jpg      → 第 3 位
└── ...
```

- 墙上默认留 **21 个位置**（在 `scripts/prepare-photos.mjs` 的 `SLOTS` 里改）
- 数字超过 21 就以文件名为准，不会截断
- 数字后面的部分随便写，只用来区分同一位置的多张候选
- **可以一张一张加**：`photos/` 里只有 1x 和 2x，那第 1、2 位就是你的照片，
  第 3–21 位保持占位图和占位文案。以后拍了新的，命名成 `5x.jpg` 丢进去再跑一次就行。
- 文件名**不带数字**的话，会补到最前面空着的位置，运行时会告诉你放到了第几位

### 支持的格式

`.heic` `.heif` `.jpg` `.jpeg` `.png` `.webp` `.avif`

iPhone 拍的 HEIC 会用 macOS 自带的 `sips` 转成 JPEG 再处理，不用装额外的工具。
**但这一步只有 macOS 有**——在 Linux / Windows 上跑的话，HEIC 得先自己转成 JPEG，
其他格式不受影响。

### 想删掉某一张

**从 `photos/` 里删掉源文件是不会把它从墙上拿掉的。** 位置照旧沿用上一次的条目，
照片还在墙上（产物 `public/photos/` 里还留着）。

真要撤掉一位，两个办法：

- **换掉**：把新照片命名成同一个数字丢进去，覆盖掉就行
- **整面墙重铺**：`npm run demo` 把 21 个位置全换成占位图，再 `npm run photos` 合并回来。
  代价是没写进 `captions.json` 的手工改动会丢

如果某一位的产物被手动删了（`photos.json` 指着一个不存在的文件），`npm run photos`
会告警并让那一位空着，不会留下一个看不见的坏图。

### 转换

```bash
npm run photos
```

这一步会：转成三档 WebP（480 / 1080 / 1920）、取一个主色防止图片加载前白闪、
把结果写进 `src/data/photos.json`。

原图按 `mtime + size` 记在 `.cache.json` 里，没动过的照片下次直接跳过，
所以补一张照片重跑只要一两秒。

> **`photos/` 和 `.cache.json` 都不进版本库。**
> 一是原图体积大，二是每个人的照片都不一样——别人 clone 下来应该放自己的照片。
> 生成物在 `public/photos/`，部署的时候会一起打包进 `dist/`。

---

## 二、写文案

### 在仓库根目录建一个 `captions.json`

```json
{
  "1x": {
    "caption": "白边上那句短句",
    "story": "翻到背面看到的那段故事。"
  },
  "2x": "只写白条也行，用纯字符串的旧写法"
}
```

- **key 就是照片的文件名**（去掉扩展名）：`1x.jpg` → `"1x"`
- `caption` 和 `story` 可以只给一个，缺的那个就是空
- 改完要重新跑 `npm run photos`

> **不要直接改 `src/data/photos.json`。**
> 那个文件是 `npm run photos` 每次重新生成的，你写在那里的字会被下一次覆盖掉。
> `captions.json` 这个侧车文件就是为了绕开这一点。

### 两处文字的位置

| | 在哪 | 收起时 | 展开方式 |
|---|---|---|---|
| `caption` | 照片**正面**下方那条白色边框上 | 最多 2 行，超出加省略号 | 点一下，白边就地长高把整句装下 |
| `story` | 照片**背面**（要翻过去看） | 最多 6 行，超出加省略号 | 点一下，在背面里滚动看全文 |

背面是半透明的深色，会透出后面墙上模糊的照片，像举着一张负片对着光看。

### 写多少字合适

实测（按实际字体量过）：

| 屏幕 | 白条能放 | 背面能放 |
|---|---|---|
| 1920×1080 | 68 字 | 560 字 |
| 1440×900 | 58 字 | 391 字 |
| 390×844 手机 | 48 字 | 266 字 |
| **844×390 横屏** | **24 字** | **56 字** |

**建议：**

- **白条 ≤ 20 字。** 桌面能放 58 字，但横屏手机只有 24 字——按最紧的那个来。
- **背面 120–150 字**（约五六行）。

超了不会报错，页面上会加省略号、点一下能展开全看，但**浏览器控制台会点名是哪一张**，
想自查就打开 F12 看 console。

---

## 三、部署

```bash
npm run deploy
```

会先 `npm run build` 再推到 Cloudflare Pages。**需要先改两个地方：**

1. `package.json` 里 `deploy` 脚本的 `--project-name=national-day-wall` 换成你的项目名
2. `index.html` 里 `og:image` 和 `og:url` 的域名换成你自己的

第一次用要先登录：

```bash
npx wrangler login
```

不想用 Cloudflare 也行——`npm run build` 出来的 `dist/` 是纯静态文件，
丢到任何静态托管（Vercel / Netlify / GitHub Pages / 自己的服务器）都能跑。

---

## 四、把这面墙改成你自己的

这个项目是从一个国庆主题的照片墙来的。要改成你自己的，动这几处就够：

| 想改什么 | 改哪 |
|---|---|
| 网站上 / 分享卡片上的文字 | `index.html` 的 `<title>`、`description`、`og:*` |
| 分享卡片的图和文案 | `scripts/make-og.mjs`，然后 `npm run og` |
| 墙上留几个位置 | `scripts/prepare-photos.mjs` 的 `SLOTS` |
| 没有真照片时的占位内容 | `scripts/make-demo-photos.mjs` 的 `LINES`（白条）和 `STORIES`（背面） |
| 配色 | `src/styles/tokens.css` 顶部的 CSS 变量 |
| 照片往哪个方向倒、多散 | `src/wall/sticker.ts` 的 `packInto()`（抖动、旋转角、列数） |

---

## 五、脚本一览

```bash
npm run dev        # 本地开发服务
npm run build      # 类型检查 + 打包到 dist/
npm run preview    # 预览打包结果
npm run deploy     # 构建并推送到 Cloudflare Pages

npm run photos     # 处理 photos/ 里的真照片（见第一节）
npm run demo       # 重新生成占位图 + 占位文案（见第四节）
npm run og         # 重新生成分享卡片 public/og.jpg
npm run font       # 重新子集化字体（见下）
npm run devices    # 跨 10 档设备截图 + 量真实几何，产出 preview/index.html
```

---

## 六、项目结构

```
src/
├── main.ts              装配：算布局 → 一次性把照片铺满 → 接上各种交互
├── core/
│   ├── ticker.ts        脏标记调度器。订阅者返回 false 即视为静止、自动退场
│   ├── spring.ts        弹簧物理（照片拖拽、墙面倾斜都用它）
│   └── stage.ts         墙面 3D 舞台：指针视差 + 陀螺仪
├── wall/
│   ├── sticker.ts       照片贴纸：瀑布流布局 + 拖拽物理 + 拍立得白边
│   └── loupe.ts         点开放大：拿起来细看、翻面、长文展开
├── data/
│   ├── config.ts        Photo 的数据结构
│   └── photos.json      照片清单（由 npm run photos 生成，不要手改）
└── styles/              tokens / wall / loupe / fonts
```

---

## 七、几个坑，先说在前面

**字号是固定像素，不是相对单位。** 白条 13px、背面 15px，不随照片尺寸变。
所以一张照片能装下多少字，取决于它在墙上被排成多宽。这是故意的——
同一支笔写的字，不该因为照片大小而变。

**照片的 `translateZ` 是负的，而且必须配一条 CSS。**
`wall.css` 里 `.wall__plane` 是 `transform-style: preserve-3d`，而 3D 渲染上下文里
层叠顺序由三维位置决定，DOM 顺序和 `z-index` 都不作数——平面自己占着 z=0 那层，
会把每一次点击都接走。所以要 `pointer-events: none`，再把 `.sticker` 显式设回 `auto`。
**不要把 z 改成正数来绕开**，透视会把照片往外推，窄屏上会溢出画布。

**`pointer-events` 是继承属性。** 上面那条一改，所有子元素都会跟着变成 `none`，
每一层想接收点击的地方都得自己设回 `auto`。这个项目里踩过三次。

**`-webkit-line-clamp` 截断后，`offsetHeight` 只剩显示出来的那几行。**
要判断有没有被截断、或者要量全文高度，得看 `scrollHeight`。

**flex 居中 + 溢出 = 顶部永远看不到。** `justify-content: center` 在内容超出容器时
会把两端同时推出去，上面那截滚都滚不到。居中要用子元素的 `margin-block: auto`——
空间够时它吸收余量实现居中，空间不够时归零。

**字体是子集化的。** `public/fonts/` 里只有 `0123456789國慶←→×` 这几个字形
（见 `scripts/build-font.mjs` 的 `GLYPHS`）。往用 `--font-display` 的地方加新的
中文，会掉到系统字体。要加字形就改 `GLYPHS` 再跑 `npm run font`。

**`npm run demo` 只删自己生成的 `p*.svg`。** 早先它 `rm -rf` 整个 `public/photos/`，
会把真照片的 webp 一起删掉——而 `.cache.json` 会让 `npm run photos` 跳过重新生成，
页面上就成了一片空白。改掉了，别再改回去。

---

## 授权

代码随便用。

`public/fonts/` 里的字体是 Noto Serif SC（SIL Open Font License 1.1）。

占位文案里的古诗都取自唐宋及更早，属于公有领域；小故事是原创的。
