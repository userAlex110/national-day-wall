# 照片墙

一面拍立得照片墙。照片贴在石灰墙上，斜着、叠着，有的竖放有的横放。
点一下能拿起来细看，翻到背面是一段故事。

- **纯静态**：没有后端、没有数据库、没有用户输入。所有文字都由你写死在数据文件里。
- **零依赖运行时**：整个站点就是 HTML + CSS + 一小段 TypeScript，构建出来一共 52KB，gzip 后约 21KB。
- **照片可以一张一张加**：放几张就换掉几位，其余位置保持占位。
- **能存成一张图发出去**：右下角一键把前几张斜叠成一摞高清竖图，手机上调起系统分享面板，
  直接发去微信、小红书。

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

## 这个项目怎么构建、怎么上线

**GitHub 上这个仓库只是模板，不参与构建。**

整个项目只有一条链路：**在你自己的电脑上构建，然后推到你自己的 Cloudflare Pages**。
三个地方各管各的：

| | 在哪 | 干什么 |
|---|---|---|
| **GitHub** | 云端 | 存代码、给别人看和 fork。`.github/workflows/ci.yml` 每次推送后只验证「代码还构建得起来吗」，**不部署** |
| **你的电脑** | 本地 | 唯一有照片和 `captions.json` 的地方，**也是唯一能构建出成品的地方** |
| **Cloudflare Pages** | 云端 | 接住 `npm run deploy` 推上去的 `dist/`，也就是你线上那个站 |

**为什么 CI 不负责部署：** 仓库里**没有照片**（`.gitignore` 挡掉了，理由见
「部署」一节）。CI 从仓库构建出来是一面**占位墙**——`dist/photos/` 是空的，
让它去覆盖正式站等于把照片全删了。所以构建和上线都留在本地。

于是分工很清楚：

- **你自己**：本地换照片、改文案 → `npm run deploy` → 上线
- **别人**：clone 下来 → 看到一面占位墙 → 换成自己的照片 → 部署到**他们自己的** Cloudflare

---

## 日常维护：四步

全在本地，就这一条链路。

### (a) 把照片放进 `photos/`

文件名**开头的数字就是它在墙上的位置**：

```
photos/1x.jpg    →  第 1 位
photos/2x.jpg    →  第 2 位
photos/12x.jpg   →  第 12 位
```

只放新的那几张也行，其余位置继续用占位图。细节见下面「一、放照片」。

### (b) 改 `captions.json`

白条上那句短句（`caption`）和翻到背面的故事（`story`）。key 是**去掉扩展名的
文件名**——`photos/1x.jpg` 就写 `"1x"`。细节见下面「二、写文案」。

### (c) 构建

```bash
npm run photos     # ← 只有「新增或替换了照片」才需要跑这一步
npm run build
```

`npm run photos` 负责把 HEIC/JPEG 转成三档 WebP、取主色、更新照片清单，比较慢，
所以单独拎出来。**照片没动就可以跳过它。**

### (d) 上线

```bash
npm run deploy
```

`npm run deploy` 内部就是 `npm run build` + `wrangler pages deploy`，
所以 **(c) 里的 `npm run build` 可以省掉**，会被自动带上。

### 合起来看

```bash
# 平时只改文案、或者只改代码：
npm run deploy

# 加了新照片：
npm run photos && npm run deploy
```

跑完打开 **https://national-day-wall.pages.dev** 就是最新的。

> fork 这个仓库的人：上面这个域名是你自己的域名（第 (a) 步之前先在
> `index.html` 和 `package.json` 里换掉，见「四、把这面墙改成你自己的」）。
> 第一次用要先 `npx wrangler login`，见「三、部署」。

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
| `caption` | 照片**正面**下方那条白色边框上 | 墙上一行，点开后最多两行，超出加省略号 | 点开照片，白边就地长高把整句装下 |
| `story` | 照片**背面**（要翻过去看） | 最多 6 行，超出加省略号 | 点一下，在背面里滚动看全文 |

墙上的白条只给一行，字号跟着贴纸宽度缩放（桌面封顶 13px，手机约 9px）——
不点开也能读到那句话，但读到的是**预览**。想看全句就点开。

背面是半透明的深色，会透出后面墙上模糊的照片，像举着一张负片对着光看。

### 写多少字合适

实测（按实际字体量过）。「墙上白条」那一列是**一行**能放下的字数——因为白条很窄，
而且字号跟着贴纸宽度走，所以它基本是个常数，只在桌面（字号封顶 13px 之后）
才随那张照片有多宽而变化：

| 屏幕 | 墙上白条（1 行） | 点开后白条（2 行） | 背面能放 |
|---|---|---|---|
| 1920×1080 | 13–20 字 | 68 字 | 560 字 |
| 1440×900 | 10–17 字 | 58 字 | 391 字 |
| 390×844 手机 | 约 10 字 | 48 字 | 266 字 |
| **844×390 横屏** | **约 10 字** | **24 字** | **56 字** |

**建议：**

- **白条 ≤ 10 字。** 按最紧的那个来。写超了不会报错——墙上加省略号，
  点开后两行还能多装一些。**但这是预览，不是正文**：照片真正被读是在点开之后，
  所以宁可把话留给背面。
- **背面 120–150 字**（约五六行）。

超了不会报错，页面上会加省略号、点一下能展开全看，但**浏览器控制台会点名是哪一张**，
想自查就打开 F12 看 console。`npm run devices` 的体检报告里也会打印每个尺寸下
有几张的白条被截断——默认那 21 张占位古诗是 10~14 字，所以桌面上大概有三分之二
会截断，这是正常的。

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

### 为什么这里没有「推送即自动部署」

**照片不进版本库**（见 `.gitignore`），所以任何 CI 从仓库构建出来的都是一面
**占位墙**——`dist/photos/` 是空的。让 CI 去覆盖你自己那个有照片的站，等于把照片全删了。

所以分工是：

| | 干什么 |
|---|---|
| **GitHub** | 存代码、给别人看和 fork。`.github/workflows/ci.yml` 每次推送跑一次 `npm run build`，只验证「能不能构建」 |
| **本地 `npm run deploy`** | 真正上线。只有在你这台有照片的机器上，`public/photos/` 才是齐的 |

想验证这一点，自己跑一遍就知道：

```bash
git clone <你的仓库> /tmp/x && cd /tmp/x && npm ci && npm run build
ls dist/photos/     # 空的
```

> 如果你确实想要一个「推送就自动部署」的站，那得是一个**独立的演示项目**，
> 部署的是占位墙，和自己的正式站分开。做法：`npx wrangler pages project create
> national-day-wall-demo`，再建一个 `CLOUDFLARE_API_TOKEN` 的仓库 secret，
> 加一条 `wrangler pages deploy dist --project-name=national-day-wall-demo` 的
> workflow。别指向正式站。

### 仓库里为什么没有照片

`.gitignore` 挡了四样，全都是「跟着各人自己的照片走」的东西：

| 挡掉的 | 是什么 | 为什么 |
|---|---|---|
| `/photos/` | 你丢进去的相机原图 | 5MB+，带 EXIF，是私人东西 |
| `/public/photos/` | `npm run photos` 转出来的 webp/svg | 别人的站不该印着你的照片 |
| `/src/data/photos.json` | 照片清单（生成的） | 指向上面的图，不跟着走的话就是一份指向空处的清单 |
| `/captions.json` | 你写的那几句话 | 有私人内容；而且 README 让人把照片命名成 `1x`/`2x`，留在这里别人那张 1x 会被配上你的文案 |
| `/public/og.jpg` | 分享卡片（`npm run og` 生成） | **它里面印着照片本身** |

结果是：**别人 clone 下来 `npm install && npm run dev` 会看到一面占位墙**，
`package.json` 里的 `predev` / `prebuild` 钩子会补上缺的那几样：

```
src/data/photos.json 不在（刚 clone 下来都是这样），先铺一面占位墙…
占位图 21 张 → public/photos/
photos.json → src/data/photos.json
public/og.jpg 不在，用占位墙生成一张分享卡片…
og.jpg → 1200×630 35KB
```

自己拍了照片之后按第一节走 `npm run photos`、`npm run og` 覆盖掉就行。
`captions.json` 不用建，缺了 `prepare-photos.mjs` 会把文案留空（第 308 行），不报错。

> **代价要说清楚**：`captions.json` 不进库意味着**你写的那几句话没有版本历史**。
> 在意的话可以单独存一份，或者接受它只是本地文件——反正 `npm run deploy`
> 上传的是本地 `dist/`，不影响上线。

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
| **导出那一摞怎么摆** | `src/share/poster.ts` 的 `SLOTS`（每层的中心、格子大小、倾角） |
| 导出图里叠几张、多大 | `src/share/poster.ts` 的 `STACK_SIZE` 和 `POSTER_W` / `POSTER_H` |

改 `SLOTS` 不用反复刷新页面：

```bash
npm run dev
# 浏览器打开 http://localhost:5173/poster.html        ← 导出图直接铺满视口
# http://localhost:5173/poster.html?light=night        ← 顺便看夜里的墙
```

`poster.html` 和 `peek.html`、`dev-harness.html` 一样是**仅开发用**的：
Vite 只以 `index.html` 为入口，所以这些文件不会进 `dist/`。

### fork 下来要改哪几处

假设你的 Cloudflare Pages 项目叫 `my-wall`、域名是 `my-wall.pages.dev`，
**一共四处，两个文件**：

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `index.html` | `og:image` 和 `og:url` 里的 `https://national-day-wall.pages.dev` → 你的域名。**这两行最要紧**：微信和小红书不执行 JS，`og:*` 是它们唯一读得到的东西 |
| 2 | `package.json` | `deploy` 脚本里的 `--project-name=national-day-wall` → 你的项目名；顺手把上面那行 `"name"` 也换掉 |
| 3 | `scripts/make-og.mjs`（可选） | 分享卡片上印的字：`title` / `sub` / `sub2`，改完跑 `npm run og` |
| 4 | `scripts/make-demo-photos.mjs`（可选） | 还没放真照片时，那面占位墙上写什么：`LINES`（白条）和 `STORIES`（背面） |

改完自己核一遍，除了上面这几处不该再有别的：

```bash
grep -rn "national-day-wall" --include="*.ts" --include="*.mjs" \
  --include="*.json" --include="*.html" --include="*.yml" . \
  | grep -v node_modules | grep -v package-lock
```

然后：

```bash
npm install
npm run dev            # 先看到一面占位墙，说明跑起来了
# 把自己的照片丢进 photos/，按第一节命名
npm run photos
npm run og             # 重画分享卡片 —— 不然分享出去的是作者的占位图
npx wrangler login     # 第一次
npm run deploy
```

> **别人的仓库里没有照片，这是故意的。** 你 fork 之后 `public/photos/` 是空的，
> `predev` 钩子会自动铺一面占位墙让你先看到东西；丢进自己的照片跑 `npm run photos`
> 就会覆盖掉。**不要**去把 `public/photos/` 提交进自己的仓库——那是别人自己的照片。

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
│   ├── stage.ts         墙面 3D 舞台：指针视差 + 陀螺仪
│   └── sound.ts         WebAudio 合成的音效，没有音频文件
├── wall/
│   ├── sticker.ts       照片贴纸：瀑布流布局 + 拖拽物理 + 拍立得白边
│   └── loupe.ts         点开放大：拿起来细看、翻面、长文展开
├── share/
│   ├── poster.ts        导出图：Canvas 手画一叠拍立得
│   └── button.ts        右下角那枚按钮 + 分享/下载
├── data/
│   ├── config.ts        Photo 的数据结构
│   └── photos.json      照片清单（由 npm run photos 生成，不要手改）
└── styles/              tokens / wall / loupe / share / fonts

poster.html              仅开发：把导出图铺满视口，方便调 SLOTS
```

**`src/share/` 只依赖 `src/wall/sticker.ts`，反过来没有。** 相纸比例
（`FRAME_*` / `framedH()`）和胶带的随机位置（`rand01()`）都是从那边 import 的，
所以导出的那一张和屏幕上那一张是同一张。加新的导出形状时，也照这个方向来。

---

## 七、几个坑，先说在前面

**字号基本是固定像素，只有墙上那条白条是例外。** 点开后的白条 13px、背面 15px，
都不随照片尺寸变——同一支笔写的字，不该因为照片大小而变。但**墙上**那张贴纸太小时
13px 会顶出相纸（390×844 的手机上白条只有 12.9px 高，而 13px 的字行盒要 16.3px），
所以墙上那条用的是 `min(13px, 0.086 × --w)`：手机约 9px，桌面封顶 13px，
和点开后一样大。实测 8 档设备都塞得进，`npm run devices` 会替你盯着。

**绝对定位子元素的 `height: 13%` 和 `padding: 13%` 不是一个意思。**
百分比 padding 永远按包含块的**宽度**解析，百分比 `height` 却按**高度**解析。
相纸那条宽白边是 `padding`（按宽），贴在上面的 `.sticker__band` 是绝对定位的
（会按高）——所以白条四边一律写成 `calc(var(--w) * 0.13)` 这种形式，
不写百分比。写成 `height: 13%` 白条会当场跑到照片中间去。

**iOS 的 `navigator.share` 要一个「还活着」的用户手势。** 那个令牌大约一秒就过期，
而「点一下 → 加载图 → 画两百万像素 → toBlob」在真机上轻松超过一秒，
分享面板根本不会弹（报 `NotAllowedError`）。所以右下角那枚按钮在
`navigator.share` 存在的设备上会**在页面空闲时先把图渲染好存住**，点击时在同一个
手势里同步调 `share()`。万一点得太快、预热还没好，就退成两步：先出「点一下分享」，
第二次点击时 blob 已经在手，一定弹得出来。桌面 Chrome 没有 `navigator.share`、
走的是下载，不受这条约束，也就不预热。

**画布尺寸不要乘 `devicePixelRatio`。** iPhone 上 ×3 就是 3726×4968 ≈ 18.5Mpx，
越过 iOS 画布约 16.7Mpx 的上限——Safari **不报错，直接给你一张空白画布**，
`toBlob` 出来是个空文件。`POSTER_W × POSTER_H` 固定 1242×1656，
本来就已是正面那张相纸 CSS 宽度的三倍，再大只是把编码时间翻三倍。

**胶带只画最前面那张。** 墙上的胶带是 `multiply` 压在相纸上沿的，半张落在墙上。
但导出图里后面每一层的「墙」其实是**另一张照片**，同一卷胶带 multiply 到深色照片上
就成了一块发暗的脏斑。`make-og.mjs` 那张卡片干脆一张胶带都不画，绕开了同一个问题。

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
