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
}

export function readUrlParams(search: string): UrlParams {
  const params = new URLSearchParams(search);
  return {
    skipPrepare: params.get('prepare') === 'skip',
    boss: params.get('boss'),
    noAi: params.get('noai') === '1',
  };
}
