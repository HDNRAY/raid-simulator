import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  activeInputLayer,
  battleExitOnPointer,
  dragExceedsTapSlop,
  pointInRect,
  reviewConsumesPointer,
  reviewScrollable,
  reviewRowsAt,
  type InputLayer,
  type InputLayerSnapshot,
} from '../../src/app/inputRouter';
import type { Phase } from '../../src/app/phaseLogic';

/**
 * **输入归属**的唯一判据。
 *
 * ==================================================================
 * 这个文件钉的是哪一个 bug（用户原话）
 * ==================================================================
 *
 * "对局结束看日志时，键盘上下键无效，会选中设置按钮"。
 *
 * 根因：**复盘面板是 `battle` 相位里的子模式** —— 一局结束**不换相位**
 * （`phaseLogic` 刻意不新增 `'result'`，见那里的说明），而"谁该拿键盘"
 * 原先只看 `state.phase`。于是复盘开着时：
 *
 *   - `settingsKeys` 的 `acceptsKeyboardFocus` 返回 `true` → `↑` 被它
 *     先吃掉去点亮设置按钮（它是**捕获阶段**，跑在复盘前面）
 *   - 复盘**永远收不到** `↑↓`
 *
 * 触屏那一半是同一个判据的第二份：`canvasInput` 判"结算中点屏幕 =
 * 离开战斗"时也只看相位 → 手指一碰屏幕就重开，复盘永远拖不动。
 *
 * 所以这里第一组用例就是"**复盘开着 = 输入层是 `review`，不是 `battle`**"，
 * 并且它**必须**在这个文件里过 —— 那正是修复本身的判据。
 */

/** 全部相位，**逐条列出来**（加值时会漏在这里，正是漏改的报警器）。 */
const ALL_PHASES: readonly Phase[] = ['home', 'characterSelect', 'prepare', 'battle'];

/** 少了哪个字段编译器会拦；显式写出来是为了让用例读起来像"一张表"。 */
function snapshot(p: Partial<InputLayerSnapshot> = {}): InputLayerSnapshot {
  return {
    phase: 'home',
    settingsOpen: false,
    reviewOpen: false,
    ...p,
  };
}

describe('activeInputLayer：谁在接收输入', () => {
  it('【本 bug】battle + 复盘开着 → `review`（**不是** `battle`）', () => {
    expect(activeInputLayer(snapshot({ phase: 'battle', reviewOpen: true }))).toBe('review');
  });

  it('battle + 复盘关着 → `battle`（战斗自己拿）', () => {
    expect(activeInputLayer(snapshot({ phase: 'battle' }))).toBe('battle');
  });

  it('设置面板打开时**压过**一切（含复盘）—— 它是模态弹窗', () => {
    for (const phase of ALL_PHASES) {
      expect(activeInputLayer(snapshot({ phase, settingsOpen: true }))).toBe('settings');
      expect(
        activeInputLayer(snapshot({ phase, settingsOpen: true, reviewOpen: true })),
      ).toBe('settings');
    }
  });

  it('三个整屏界面各归各（复盘 / 设置都没开）', () => {
    expect(activeInputLayer(snapshot({ phase: 'home' }))).toBe('home');
    expect(activeInputLayer(snapshot({ phase: 'characterSelect' }))).toBe('characterSelect');
    expect(activeInputLayer(snapshot({ phase: 'prepare' }))).toBe('prepare');
  });

  it('复盘只在它真开着时才算一层（关着不影响相位路由）', () => {
    expect(activeInputLayer(snapshot({ phase: 'prepare', reviewOpen: true }))).toBe('review');
    expect(activeInputLayer(snapshot({ phase: 'prepare', reviewOpen: false }))).toBe('prepare');
  });

  it('每个输入状态都有确定归属（没有 `undefined` 这种"没人管"）', () => {
    for (const phase of ALL_PHASES) {
      for (const settingsOpen of [false, true]) {
        for (const reviewOpen of [false, true]) {
          const layer: InputLayer = activeInputLayer({ phase, settingsOpen, reviewOpen });
          expect(layer).toBeTruthy();
        }
      }
    }
  });
});

describe('【回归】复盘开着时，↑↓ **不归设置按钮**', () => {
  /**
   * ⚠️ 设置按钮的入口条件就是原来那一行
   * `acceptsKeyboardFocus: () => state.phase === 'battle'`（`game.ts`）。
   * 这里把它当成"**旧的判据**"重放一遍：它必须在这个场景下返回 `false`，
   * 否则 `↑` 又会被吃掉。
   */
  const oldPredicateReadingPhaseOnly = (phase: Phase): boolean => phase === 'battle';

  it('旧的"只看 phase"判据在复盘开着时**确实**返回 true（所以它是错的）', () => {
    // 这条不是"要求"，而是把根因钉下来：`battle` + 复盘开着时相位仍是 battle。
    expect(oldPredicateReadingPhaseOnly('battle')).toBe(true);
  });

  it('新的判据（输入层）在复盘开着时**拒绝**把 ↑ 给设置按钮', () => {
    const s = snapshot({ phase: 'battle', reviewOpen: true });
    // 设置按钮允许聚焦 ⟺ 输入层是 battle（`game.ts` 的 `currentLayer() === 'battle'`）
    expect(activeInputLayer(s) === 'battle').toBe(false);
    expect(activeInputLayer(s)).toBe('review');
  });

  it('复盘关着时设置按钮照旧可以聚焦（修 bug 不能把功能一起修没）', () => {
    expect(activeInputLayer(snapshot({ phase: 'battle' })) === 'battle').toBe(true);
  });

  it('接线层面：`game.ts` **不许**再按相位判设置焦点（源码扫描）', () => {
    /**
     * ⚠️ 这条是**防回退**：单元测试能证明"判据正确"，但证明不了
     * `game.ts` 接线时用的是它。原先那一行长得就是
     * `acceptsKeyboardFocus: () => state.phase === 'battle'`。
     */
    const game = readFileSync('src/app/game.ts', 'utf8');
    expect(game).not.toMatch(/acceptsKeyboardFocus:\s*\(\)\s*=>\s*state\.phase === 'battle'/);
    expect(game).toMatch(/acceptsKeyboardFocus:\s*\(\)\s*=>\s*currentLayer\(\) === 'battle'/);
  });

  it('接线层面：`canvasInput` / `loopWiring` 的归属判据走 `inputRouter`', () => {
    const canvas = readFileSync('src/app/canvasInput.ts', 'utf8');
    expect(canvas).toMatch(/activeInputLayer\(/);
    expect(canvas).toMatch(/reviewConsumesPointer\(/);
    expect(canvas).toMatch(/battleExitOnPointer\(/);
    const loop = readFileSync('src/app/loopWiring.ts', 'utf8');
    expect(loop).toMatch(/activeInputLayer\(/);
    expect(loop).toMatch(/o\.review\.handleKey\(/);
  });
});

describe('reviewConsumesPointer：复盘什么时候吃掉指针', () => {
  /** 可滚的列表区（表头 / 页脚不在内 —— 见 `REVIEW_ROWS_RECT`）。 */
  const rows = { x: 16, y: 66, w: 928, h: 432 };

  it('层是 review + 点在列表区 + 滚得动 → 吃掉（开始拖拽滚动）', () => {
    expect(reviewConsumesPointer('review', { x: 480, y: 270 }, rows, true)).toBe(true);
  });

  it('点在列表区**外** → 不吃（那是"点屏幕离开战斗"的手势）', () => {
    expect(reviewConsumesPointer('review', { x: 480, y: 20 }, rows, true)).toBe(false);
    expect(reviewConsumesPointer('review', { x: 480, y: 516 }, rows, true)).toBe(false);
    expect(reviewConsumesPointer('review', { x: 5, y: 270 }, rows, true)).toBe(false);
  });

  it('【触屏对等】**滚不动时不吃** —— 那一下留给"点屏幕离开战斗"', () => {
    /**
     * 内容装得下一屏时，点按永远不改变画面（滚无可滚）。若复盘仍吃掉它，
     * 就只是**吞掉**玩家的退出操作 —— 触屏玩家出不去复盘。
     */
    expect(reviewConsumesPointer('review', { x: 480, y: 270 }, rows, false)).toBe(false);
  });

  it('设置面板开着（层是 settings）→ 复盘不吃，哪怕点在它矩形里', () => {
    expect(reviewConsumesPointer('settings', { x: 480, y: 270 }, rows, true)).toBe(false);
  });

  it('别的层一律不吃', () => {
    for (const layer of ['battle', 'home', 'prepare', 'characterSelect'] as const) {
      expect(reviewConsumesPointer(layer, { x: 480, y: 270 }, rows, true)).toBe(false);
    }
  });

  it('reviewScrollable：多于一屏才算滚得动（与滚条的显示条件同源）', () => {
    expect(reviewScrollable(28, 27)).toBe(true);
    expect(reviewScrollable(27, 27)).toBe(false);
    expect(reviewScrollable(0, 27)).toBe(false);
  });

  it('【回归·触屏】复盘滚得动时，那一下归复盘（不退出）', () => {
    /**
     * 原先"点屏幕离开战斗"判 `phase === 'battle'` —— 复盘开着时那一下会
     * **先**把玩家带离战斗（重开一局），所以触屏的拖拽滚动永远开始不了
     * （AGENTS.md §3b"触屏与键盘功能必须对等"）。
     */
    const layer = activeInputLayer(snapshot({ phase: 'battle', reviewOpen: true }));
    const consumed = reviewConsumesPointer(layer, { x: 480, y: 270 }, rows, true);
    expect(consumed).toBe(true);
    expect(battleExitOnPointer(layer, consumed)).toBe(false);
  });

  it('【回归·触屏】复盘**滚不动**时，点屏幕照旧能离开战斗', () => {
    /**
     * ⚠️ 这条修的是第一版修法带出来的**新**问题：把退出条件写成
     * `layer === 'battle'` 之后，复盘开着时那一下**永远不退出** ——
     * 而复盘几乎占满屏幕、滚不动的局又很多，触屏玩家于是**出不去复盘**
     * （键盘还有 `Enter`，触屏只有点屏幕）。
     */
    const layer = activeInputLayer(snapshot({ phase: 'battle', reviewOpen: true }));
    const consumed = reviewConsumesPointer(layer, { x: 480, y: 270 }, rows, false);
    expect(consumed).toBe(false);
    expect(battleExitOnPointer(layer, consumed)).toBe(true);
  });

  it('复盘开着、点在列表区**外**（表头 / 页脚）→ 也能离开战斗', () => {
    const layer = activeInputLayer(snapshot({ phase: 'battle', reviewOpen: true }));
    const consumed = reviewConsumesPointer(layer, { x: 480, y: 516 }, rows, true);
    expect(consumed).toBe(false);
    expect(battleExitOnPointer(layer, consumed)).toBe(true);
  });

  it('复盘关着时那条路照旧（结算面板"点屏幕再来一次"没被修坏）', () => {
    const layer = activeInputLayer(snapshot({ phase: 'battle' }));
    expect(battleExitOnPointer(layer, false)).toBe(true);
  });

  it('设置面板开着时**不**触发"点屏幕离开战斗"（它是自己的模态）', () => {
    const layer = activeInputLayer(snapshot({ phase: 'battle', settingsOpen: true }));
    expect(battleExitOnPointer(layer, false)).toBe(false);
  });

  it('非战斗相位不触发 → 首页点屏幕不会把人送去选角色', () => {
    expect(battleExitOnPointer(activeInputLayer(snapshot({ phase: 'home' })), false)).toBe(false);
    expect(battleExitOnPointer(activeInputLayer(snapshot({ phase: 'prepare' })), false)).toBe(false);
  });
});

describe('几何小工具', () => {
  it('pointInRect 含边界', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(pointInRect({ x: 0, y: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 10, y: 10 }, r)).toBe(true);
    expect(pointInRect({ x: 10.1, y: 5 }, r)).toBe(false);
    expect(pointInRect({ x: -0.1, y: 5 }, r)).toBe(false);
  });

  it('reviewRowsAt 把逻辑 Y 折成行（含小数）', () => {
    expect(reviewRowsAt(0, 0, 16)).toBe(0);
    expect(reviewRowsAt(32, 0, 16)).toBe(2);
    expect(reviewRowsAt(8, 0, 16)).toBe(0.5);
    /**
     * 复盘那边算的是 `dy = 上一次的 Y - 这一次的 Y`（`pointerMove`）：
     * 向上拖使 Y 变小 → `dy` 为正 → 往新的翻。这里钉住这个符号约定。
     */
    const dy = reviewRowsAt(100, 0, 16) - reviewRowsAt(68, 0, 16);
    expect(dy).toBeGreaterThan(0);
  });
});

/**
 * ==================================================================
 * 【关键】可滚区里"点一下"与"拖一下"的分界
 * ==================================================================
 *
 * 备战屏的卡片视口能滚时，按下不能立刻判"点了哪张卡"（那一下可能是在
 * 滚动），所以路由先占住手势、松手才决定。**"松手时算不算点了这一下"**
 * 就是这条判据 —— 它错了的表现是"整块卡片点不动"（用户报的"点了没反应"）。
 *
 * ⚠️ 这里只钉**判定**（边界含不含、方向、slop 由调用方给）；"占住 → 松手
 * 补一次 hitTest"那段接线在 `app/canvasInput.ts`（Pixi / DOM 层），靠截图
 * 与真指针探针验（见 `prepareDragMoved` 的说明）。
 */
describe('【关键】手势位移 = 点还是拖（dragExceedsTapSlop）', () => {
  it('没动 / 抖动在 slop 内 → **不是**拖动（那一下要当点击处理）', () => {
    expect(dragExceedsTapSlop(200, 200, 6)).toBe(false);
    expect(dragExceedsTapSlop(200, 206, 6)).toBe(false);
    expect(dragExceedsTapSlop(200, 194, 6)).toBe(false);
  });

  it('超过 slop（向上或向下都算）→ 是拖动（滚动，不补点击）', () => {
    expect(dragExceedsTapSlop(200, 206.1, 6)).toBe(true);
    expect(dragExceedsTapSlop(200, 193.9, 6)).toBe(true);
    expect(dragExceedsTapSlop(200, 260, 6)).toBe(true);
  });

  it('slop 是参数（不是散落在调用处的魔数）', () => {
    expect(dragExceedsTapSlop(0, 10, 20)).toBe(false);
    expect(dragExceedsTapSlop(0, 10, 4)).toBe(true);
  });
});
