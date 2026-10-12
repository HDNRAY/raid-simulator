/**
 * **切换操作方式**（键盘 / 触屏）—— 唯一 flag 的**运行期写入点**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `app/game.ts` 在加了这段之后到了 **740 行**（AGENTS.md §3 的上限 700）。
 * 按 §3 不许压注释 —— 切出来的是"切一次操作方式到底要改哪几件事"这一个
 * 关注点：它横跨 `GameState` / 存储 / 战斗循环 / 场景 / 面板五处，
 * 而这些细节留在装配函数里只会被"接下来还有一堆界面要建"淹掉。
 *
 * ==================================================================
 * 启动时的初值不是在这里决定的
 * ==================================================================
 *
 *   ```
 *   ?touch=1 / ?touch=0     覆盖（截图验证 / 用户自救）
 *   存档 raid.operationMode.v1
 *   默认 keyboard
 *        ↓ 解析在 render/platform.resolveOperationMode（纯函数、有单测）
 *   GameDeps.inputMode → GameState.operationMode
 *   ```
 *
 * 本文件只管**运行期**那一次切换（玩家在「通用」页点按钮）。
 */

import { capsOf, type OperationMode } from '../render/platform';
import { parseBindings, type SettingsStore } from './settingsStore';
import type { ContentRegistry } from '../core/content/registry';
import type { GameState } from './flow';

export interface OperationModeSwitchDeps {
  /** 共享可变状态（`operationMode` / `bindings` / `loop` 都住在里面）。 */
  readonly state: Pick<GameState, 'operationMode' | 'bindings' | 'loop'>;
  readonly store: SettingsStore;
  /** 用来把键位表里的失效 id 过滤掉（与启动时同一份判据）。 */
  readonly registry: ContentRegistry;
  readonly scene: { setShowKeyHints(show: boolean): void };
  readonly settingsButton: { setShowShortcut(show: boolean): void };
  /** 设置面板（切完让它重画 + 把焦点挪到存在的区）。 */
  readonly settings: { setOperationMode(): void };
}

/**
 * 切一次操作方式。玩家在「通用」页点那一下会走到这里，一次改五件事：
 *
 *   1. `GameState.operationMode` —— 所有"键盘 / 触屏"判断的**唯一**来源
 *      （面板、触屏层、场景与齿轮的键名提示下一次重画就读到新值）
 *   2. 存档（`raid.operationMode.v1`）—— 刷新之后还记得
 *   3. **读哪一份键位表**（`raid.bindings.keyboard.v1` /
 *      `raid.bindings.touch.v1`）—— 两张表分开存（用户要求"方便我用电脑
 *      测试"），所以换方式就得换那一份
 *   4. 战斗循环里的键位（这一局立刻生效）
 *   5. 让设置面板重画 + 把焦点挪到一个**现在存在**的区
 *
 * ⚠️ 它**不重建**触屏控件：那一层读的是 `() => state.operationMode`
 * （取值函数），所以"切过去"对它是下一帧自然发生的
 * （见 `touchControls.createTouchControls` 里 `caps()` 的说明）。
 */
export function switchOperationMode(
  deps: OperationModeSwitchDeps,
  mode: OperationMode,
): void {
  const { state } = deps;
  if (mode === state.operationMode) return;
  state.operationMode = mode;
  deps.store.setMode(mode);
  deps.store.saveOperationMode(mode);

  /**
   * ⚠️ **换一份键位表**：`SettingsStore.bindings` 按当前 mode 读对应的 key，
   * 所以这里 `setMode` 之后紧跟着读就是另一种形态那一份。
   * 校验（丢掉内容里已不存在的技能）与启动时**同一份**判据
   * （`parseBindings`）—— 两处各写一遍就会漂。
   */
  const next = parseBindings(deps.store.bindings, new Set(deps.registry.skills.keys()));
  state.bindings = next;
  state.loop?.setBindings(next);

  const caps = capsOf(mode);
  deps.scene.setShowKeyHints(caps.showKeyHints);
  deps.settingsButton.setShowShortcut(caps.showKeyHints);
  deps.settings.setOperationMode();
}
