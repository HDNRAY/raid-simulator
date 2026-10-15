/**
 * **URL 参数**（启动开关）—— `?prepare=skip` / `?boss=` / `?noai=1` /
 * `?runlen=N` / `?runseed=N`。
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
   * **`?fps=1` —— 显示 HTML 的 FPS 层**（录制 / 导出日志；2026-10-15）。
   *
   * ⚠️ **只有显式带这个参数才创建**那一层 DOM（线上默认不挂调试条）。
   * "不带参数时一行 DOM 都不建"这条性质由 `app/fpsOverlay` 的工厂自己保证
   * 并被单测钉住（`tests/web/fpsOverlay.test.ts`）—— 见设计稿
   * `docs/specs/2026-10-15-fps-overlay.md` §2。
   */
  readonly fps: boolean;
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
  /**
   * **`?runseed=N` —— 指定这一局肉鸽的种子**（Boss 顺序因此可复现）。
   *
   * ==================================================================
   * ⚠️ 为什么需要它（这一轮**两个** agent 都为此绕过路）
   * ==================================================================
   *
   * 一局肉鸽的种子在 app 层由 `Date.now() >>> 0` 生成
   * （`app/phaseFlow.ts` 的 `startRoguelikeRun`，语义见
   * `core/run/lifecycle.ts` 的 `StartRunInput.runSeed`），它**决定 Boss
   * 顺序**。而仓库里**没有 `Math.random`**（lint C2 禁它，只有注释），
   * 于是"要复现某一局特定的 Boss 顺序"的人在页面上用 CDP 把 `Date.now`
   * 猴子补丁成 1 —— 只是为了把种子钉住。
   *
   * 有 `?runseed=123` 之后直接写参数即可，不用再打补丁。
   *
   * ==================================================================
   * ⚠️ 它现在钉住**整个一局**（B，2026-10-13）—— 之前只钉住顺序
   * ==================================================================
   *
   * 一场战斗的种子**从 run seed 派生**（`app/battleSetup.ts` 的
   * `battleSeedOf` → `core/run/shuffle.ts` 的 `battleSeed(runSeed, position)`），
   * 所以同一个 `?runseed=` 跑两次：**Boss 顺序 + 每一场战斗内部的随机
   * （出招 / 概率判定）全部相同** —— 这就是"完整复现一局"。
   *
   * ==================================================================
   * ⚠️ 沿革：**这个参数上一版只钉得住顺序**（为什么当初对不上）
   * ==================================================================
   *
   * 上一轮加这个参数时，`battleSetup.ts` 给战斗种子的是
   * `seed: Date.now() >>> 0` —— 与 run seed **没有任何派生关系**。而
   * `core/run/types.ts` 的 `RunBattleRecord.seed` 注释与
   * `tests/unit/run/record.test.ts` 都写着"由 `battleSeed(runSeed, position)`
   * 派生"：**约定早就存在，线上那条路没接**。于是同一个 `?runseed=` 的两次
   * 运行，战斗内部仍然不同 —— 而 P7（中途存档 + 重放）要的正是"同一局能
   * 重放出来"，那个缺口会以"重放对不上、但没人知道是哪一层"的形式爆出来。
   *
   * 当时的注释把这件事**如实写下来**（而不是假装已实现）是对的；这一轮
   * 把它做掉，于是"文档 / 测试描述的"与"线上跑的"成了同一件事。
   * 结论文档见 `docs/specs/2026-10-12-roguelike.md` §0.3 / §2.3 / §7.1。
   *
   * 解析规则与 `?runlen=` **同一个**（`parsePositiveInt`）：**正整数**才认；
   * `0` / 负数 / 小数 / 非数字一律当**没传**（回落到 `Date.now() >>> 0`）——
   * 与其它调试入口"写错了当作没写"的口径一致。
   * 不传时（`null`）行为**逐字不变**：`runSeed` 仍是 `Date.now() >>> 0`，
   * 而战斗种子由上一条派生（在自由模式 / 直接单场那条路上，没有这一局，
   * 战斗种子仍是时钟 —— 见 `battleSetup.ts` 的 `battleSeedOf`）。
   *
   * ⚠️ 没有上限校验：`startRun` / `createRng` 内部都会 `>>> 0` 规范化
   * （种子是 uint32），所以"给个很大的数"是合法的、不是错误。
   */
  readonly runSeed: number | null;
}

export function readUrlParams(search: string): UrlParams {
  const params = new URLSearchParams(search);
  return {
    skipPrepare: params.get('prepare') === 'skip',
    boss: params.get('boss'),
    noAi: params.get('noai') === '1',
    fps: params.get('fps') === '1',
    runLength: parsePositiveInt(params.get('runlen')),
    runSeed: parsePositiveInt(params.get('runseed')),
  };
}

/**
 * 解析一个"正整数或没传"的参数（`?runlen=` / `?runseed=`）。
 *
 * ⚠️ 用 `Number(...)` 而不是 `parseInt(...)`：`parseInt('2abc')` 会给 2
 * （把拼错的参数当成合法值），而 `Number('2abc')` 是 `NaN` —— 后者才是
 * "这个参数不是个数字"。调试入口宁可**当没写**。
 *
 * ⚠️ 两个参数共用这一处（口径必须一致）：各写一份必然漂，而漂的样子是
 * "`?runlen=` 把 `2abc` 当 2、`?runseed=` 把它当没传"这种没法解释的差别。
 * 具体每个参数怎么用返回的值见各自的字段注释。
 */
function parsePositiveInt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}
