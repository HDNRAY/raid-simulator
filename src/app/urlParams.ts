/**
 * **URL 参数**（启动开关）—— `?prepare=skip` / `?boss=` / `?noai=1`。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `app/game.ts` 在加了"操作方式"的写入点之后到了 **740 行**（AGENTS.md §3
 * 的上限 700）。按 §3 的顺序**不许压注释**：要么拆 util、要么横向切割 ——
 * 这一撮是"启动参数从哪儿读、每个参数是什么意思"，与"界面怎么装配"没有
 * 交集，整块搬出来最干净（注释一起搬，不留摘要）。
 *
 * ⚠️ 还有一个"读取口只有一处"的好处：`?touch=1/0` 那条在
 * `render/platform.resolveOperationMode` 里读（它属于操作方式的解析），
 * 其余在这里读 —— 谁读什么都写在这两个文件的文件头里，不再散在装配代码里。
 *
 * ⚠️ 纯函数（收 `search` 字符串）：可以在 node 里直接测，不必起浏览器。
 */

export interface UrlParams {
  /**
   * **跳过备战界面直接进战斗**：`?prepare=skip`（截图 / 调试脚本用）。
   *
   * ⚠️ 用 URL 参数而不是"再加一个调试方法"：后者是**旁路**，而备战界面是
   * 真实入口的一部分（"点开始"本身也会坏）。走参数则与玩家同一条路。
   * ⚠️ 只有显式带这个参数才生效 —— 线上地址没有它，玩家路径一字未变。
   */
  readonly skipPrepare: boolean;
  /**
   * `?boss=lust` —— 指定对手（截图 / 调试用）。
   *
   * ⚠️ 与 `?prepare=skip` 配合使用：`?prepare=skip&boss=lust` 直接开一局
   * 打色欲。单独给 `?boss=` 只在跳过备战时才有意义（否则备战界面会按
   * 存储里的选择走）。
   */
  readonly boss: string | null;
  /** `?noai=1` —— 对手不行动（用来拍"我先手"那类画面）。 */
  readonly noAi: boolean;
  /**
   * **`?runlen=N` —— 这一局肉鸽打几场**（开发期跑短局用；设计稿 §2.3）。
   *
   * ⚠️ **不传时是"池子多长就打几场"**（`null`），而**不是 7**：
   * 7 是满编的**终点**，今天只有 2 个 Boss 能打 —— 拿 7 当缺省会让一局
   * 永远通不了关（见 `core/run/types.ts` 的 `MAX_RUN_POSITION`）。
   *
   * 解析规则：**正整数**才认；`0` / 负数 / 小数 / 非数字一律当**没传**
   * （回落到池子长度）。⚠️ 这是调试入口，"写错了当作没写"比"抛错/夹到一个
   * 意外的小值"更好排查 —— 而真正的越界（比池子长）由
   * `app/runSession.ts` 的 `lengthOf` 夹到池子长度。
   */
  readonly runLength: number | null;
}

export function readUrlParams(search: string): UrlParams {
  const params = new URLSearchParams(search);
  return {
    skipPrepare: params.get('prepare') === 'skip',
    boss: params.get('boss'),
    noAi: params.get('noai') === '1',
    runLength: parseRunLength(params.get('runlen')),
  };
}

/**
 * 解析 `?runlen=` 的值（见 `UrlParams.runLength` 的口径）。
 *
 * ⚠️ 用 `Number(...)` 而不是 `parseInt(...)`：`parseInt('2abc')` 会给 2
 * （把拼错的参数当成合法值），而 `Number('2abc')` 是 `NaN` —— 后者才是
 * "这个参数不是个数字"。调试入口宁可**当没写**。
 */
function parseRunLength(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}
