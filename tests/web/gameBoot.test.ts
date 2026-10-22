import { Application } from 'pixi.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGame } from '../../src/app/game';
import { createGameDeps } from '../../src/app/deps';

/**
 * **`createGame` 能起来**（2026-10-22）。
 *
 * ==================================================================
 * 这条测试为什么存在
 * ==================================================================
 *
 * 真 bug（`40f1af7` 修的那个）：`createChrome` 的选项里写了**属性简写**
 * `battle`，而 `const battle = ...` 在 `createGame` 里**后面**才声明；
 * 而 `createChrome` 被 `new BattleScene(...)` **在造场景时就立刻调用**
 * ⇒ 在 TDZ 里读 `battle` ⇒ `ReferenceError` ⇒ `createGame` 抛出 ⇒
 * **整页黑屏**。
 *
 * 当时的四件套（typecheck / eslint / vitest / build）**全绿** ✗ ——
 * 因为类型完全正确，而且**没有任何测试真正把 `createGame` 跑起来**。
 * 于是"启动期顺序错误"这一类 bug 在测试里是**完全隐形**的。
 *
 * ==================================================================
 * 它钉的是什么
 * ==================================================================
 *
 * **只有一条：`createGame(最小依赖)` 不抛错，并且交回一个能用的 handle。**
 *
 * ⚠️ 这里**不**断言一屏一屏的细节 —— 那是各屏自己的测试。这条的价值在于
 * "装配流水账能在同一个真实顺序里从头走到尾"，而顺序错误**只能**这样抓到。
 *
 * ⚠️ 用**假的 `Application`**（真 pixi 的 `Application.init()` 需要 WebGL，
 * jsdom 里起不来）—— 但 `createGame` 用到的 three 个成员都给了真实现：
 * `stage`（真 `Container`，场景会往里 `addChild`）、`canvas`、`ticker`。
 * 出问题的是**装配顺序**，不是渲染后端，所以这个替身够用 ✓。
 */
/**
 * **一个真的 pixi `Application` 实例**，只是没 `init()`。
 *
 * ⚠️ 为什么不用手写的假对象：`createGame` 的 `app` 参数类型是 pixi 的
 * `Application`，手写对象要么缺一堆成员、要么得用 `as unknown as` 硬转
 * （**AGENTS §1 明令禁止** ✗）。而 `new Application()` 的 `stage` / `ticker`
 * 本来就是真的 ✓，只缺 `canvas` / `renderer` / `screen`（那些要 `init()` 才有
 * —— 而 `init()` 需要 WebGL，jsdom 里起不来 ✗）⇒ 用 `Object.defineProperty`
 * 补这三个，**不涉及任何类型断言** ✓。
 */
function fakeApp(): Application {
  /**
   * ⚠️ 画布的**backing size 必须是 960×540 × scale**：`observeStage` 会断言
   * 它（"缩放只许改 CSS 尺寸"）。给 300×150（`<canvas>` 的默认值）会在
   * `createGame` 的第 N 行抛错 —— 那是**测试装置**的问题，不是装配的问题。
   */
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const app = new Application();
  Object.defineProperty(app, 'canvas', { value: canvas, configurable: true });
  Object.defineProperty(app, 'renderer', {
    value: { resolution: 1, resize: () => {} },
    configurable: true,
  });
  Object.defineProperty(app, 'screen', {
    value: { width: 960, height: 540 },
    configurable: true,
  });
  return app;
}

import { stubCanvas2d } from './canvas2dStub';

describe('createGame 启动装配', () => {
  beforeAll(() => {
    stubCanvas2d();
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="stage"></div>';
    localStorage.clear();
  });

  it('用最小依赖跑完装配，不抛错（TDZ / 顺序错误在这里会红）', () => {
    const stage = document.querySelector<HTMLElement>('#stage');
    expect(stage).not.toBeNull();
    if (stage === null) throw new Error('测试装置缺 #stage');

    const app = fakeApp();
    const game = createGame({
      app,
      stage,
      deps: createGameDeps(),
      scale: 1,
    });

    expect(typeof game.start).toBe('function');
    /** 场景真的挂进了 stage（说明 `new BattleScene(...)` 这一句跑完了）。 */
    expect(app.stage.children.length).toBeGreaterThan(0);
  });
});
