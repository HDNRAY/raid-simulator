import { createStage } from './app/bootstrap';
import { parseStageScale, resolveStageScale } from './render/stageScale';
import { capsOf } from './render/platform';
import { readUrlParams } from './app/urlParams';
import { createGameDeps } from './app/deps';
import { createGame } from './app/game';
import './styles.css';

/**
 * **MVP 入口 —— 只留主干。**
 *
 * 数据流（严格单向）：
 *   键盘 → Action → 引擎 tick → 事件 → view-model → Pixi 场景
 *
 * 渲染层**只读** view-model，从不反向调用引擎（架构规范 C3）。
 *
 * ==================================================================
 * 这个文件为什么这么短
 * ==================================================================
 *
 * 它原先 699 行（AGENTS.md §3 的上限是 700）：Pixi 构造、设置面板装配、
 * 触屏接线、`window.__raidBattle` 的每一格、键盘分发全挤在一个函数里。
 * 一个没读过这个仓库的人打开它，要翻过几十行"怎么建画布"才能看出
 * "这个应用是怎么立起来的"。
 *
 * 现在它只说四件事（其余各归其位）：
 *
 *   1. `createStage()`     —— Pixi `Application` + `#stage` 挂载
 *   2. `createGameDeps()`  —— 内容注册表 / 设置存储 / 键位表 / 输入方式
 *   3. `createGame(...)`   —— 场景 / 备战 / 设置 / 触屏 / 指针 / 键盘接线
 *   4. `game.start()`      —— 主循环 + 键盘分发 + `window.__raidBattle`
 *
 * ⚠️ **`createGame` 不启动任何东西**（没有 ticker、没有 window 监听、
 * 不碰 `window.__raidBattle`）：那些全在 `start()` 里。拆成两段是因为
 * `?prepare=skip` 要在"造好界面"与"开始跑"之间插一步进入战斗 ——
 * 这条路径的来龙去脉见 `app/game.ts` 文件头的"顺序即正确性"。
 *
 * ⚠️ 各模块之间的共享可变状态一律走 `app/flow.ts` 的 `GameState`
 * （延后回填的那几处都有注释说明为什么不能整理顺序），**没有全局变量**。
 */
async function bootstrap(): Promise<void> {
  /**
   * ⚠️ **顺序有讲究**：`deps` 要**先**造（它解析操作方式那个唯一 flag），
   * 而缓冲倍率要在 `createStage()` **之前**定（`resolution` 只能 init 时给）。
   * 于是：deps → scale → stage。`createGameDeps()` 不碰 stage，所以可以提前。
   */
  const deps = createGameDeps();
  const scale = resolveStageScale({
    touch: capsOf(deps.inputMode).touch,
    viewportWidth: globalThis.innerWidth,
    ...(() => {
      const override = parseStageScale(readUrlParams(globalThis.location.search).stageScale);
      return override === undefined ? {} : { override };
    })(),
  });
  const { app, stage } = await createStage(scale);
  const game = createGame({ app, stage, deps, scale });
  game.start();
}

void bootstrap();
