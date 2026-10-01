/**
 * 照片的数据结构。
 *
 * 真正的数据在 photos.json，由 scripts/prepare-photos.mjs 从 photos/ 目录生成
 * ——把真实照片丢进 photos/ 再跑 `npm run photos` 就行，不用改这里的代码。
 */

export interface Photo {
  id: string;
  /** 第几张，1 起。只用来排序和翻页计数，不印在照片上。 */
  page: number;
  /** 拍摄日，1~31，由 EXIF 带出来。只作数据保留，页面上不显示任何日期。 */
  shot: number;
  /** 480px 宽的缩略图，给墙上的小贴纸用 */
  thumb: string;
  /** 1080px，墙上的默认档 */
  card: string;
  /** 1920px，loupe 放大时才取 */
  full: string;
  w: number;
  h: number;
  /** 占位色，避免图片加载前的布局抖动 */
  color: string;
  /** 正面白边上的那一句短句。靠左、最多两行、超出截断。 */
  caption: string;
  /** 翻到背面看到的那段故事。手写体横排，五六行的篇幅。 */
  story: string;
}
