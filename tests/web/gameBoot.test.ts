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

/**
 * **给 jsdom 一张"能测字"的 2D 画布**。
 *
 * ⚠️ jsdom 的 `canvas.getContext('2d')` 返回 **null**（没装 `canvas` 原生包），
 * 而 Pixi 的 `Text` 在**量字**时会读 `ctx.measureText(...)` 与 `ctx.font`
 * ⇒ 直接报 `Cannot set properties of null (setting 'font')` ✗。
 *
 * 这个替身只实现"量字 + 画画用的空方法"：宽度按 `字数 × 字号 × 0.9` 估
 * （测试里只关心**能不能跑完装配**，不关心像素宽度 ✓）。
 */
function stubCanvas2d(): void {
  /**
   * ⚠️ Pixi 的 `CanvasTextMetrics` 会读**全局** `CanvasRenderingContext2D`
   * 的 `prototype`（判断 `letterSpacing` 支持与否）—— jsdom 里没有这个全局
   * ⇒ `ReferenceError: CanvasRenderingContext2D is not defined` ✗。
   * 所以给它一个"有 prototype"的占位类；真正的实例仍是下面那个替身对象。
   */
  if (!('CanvasRenderingContext2D' in globalThis)) {
    class FakeCtx2D {}
    Object.defineProperty(globalThis, 'CanvasRenderingContext2D', {
      value: FakeCtx2D,
      configurable: true,
    });
  }
  const proto = HTMLCanvasElement.prototype;
  proto.getContext = function getContext(kind: string): unknown {
    if (kind !== '2d') return null;
    const ctx = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      textBaseline: '',
      textAlign: '',
      letterSpacing: '0px',
      measureText: (text: string) => {
        /** ⚠️ 不用 `this`（隐式 any）：`ctx` 在闭包里延后读取，赋值早就完成了 ✓。 */
        const size = Number.parseFloat(/\d+/.exec(ctx.font)?.[0] ?? '12');
        const width = Math.max(1, [...text].length * size * 0.9);
        return {
          width,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: width,
          fontBoundingBoxAscent: size * 0.8,
          fontBoundingBoxDescent: size * 0.2,
        };
      },
      save: () => {},
      restore: () => {},
      scale: () => {},
      translate: () => {},
      rotate: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      fillText: () => {},
      strokeText: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      rect: () => {},
      clip: () => {},
      drawImage: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      setTransform: () => {},
    };
    return ctx;
  } as typeof proto.getContext;
}

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
