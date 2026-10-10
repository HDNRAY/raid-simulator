/**
 * **设置面板的选项装配**（它怎么读写键位表、缩放、捕获）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这一块有 60 多行，而且它是一整块**内聚的知识**："设置界面能改哪些
 * 东西、改了之后要同步到哪儿"。抽出来之后 `main.ts` 只剩
 * `new SettingsPanel(buildSettingsOptions({...}))` 一行，而"改键之后
 * 必须同步到 loop + touch + 存储"这类规则集中在一处 —— 少一处就会
 * 出现"改了键但触屏按钮没变"。
 *
 * ⚠️ 注意"三处同步"：`loop`（键盘输入）、`touch`（触屏按钮）、
 * `settingsStore`（持久化）。**改键 / 换位 / 恢复默认三条路径都要全做**。
 */

import { DEFAULT_BINDINGS, type KeyBinding } from '../input/keyboard';
import type { SettingsPanelOptions } from './../ui/settings/SettingsPanel';
import { rebindWithSwap, swapSlots } from './bindingActions';
import { buildKeyRows } from './keyRows';
import type { ContentRegistry } from '../core/content/registry';
import { EMPTY_SNAPSHOT } from '../render/viewModel';

export interface SettingsOptionsDeps {
  readonly registry: ContentRegistry;
  /** 当前键位表（读引用，改键会替换它）。 */
  readonly getBindings: () => readonly KeyBinding[];
  /** 写入新键位表（同时同步到 loop / touch / 存储 —— 见文件头）。 */
  readonly setBindings: (next: readonly KeyBinding[]) => void;
  readonly settingsStore: {
    saveBindings(b: readonly KeyBinding[]): void;
    saveUiScale(v: number): void;
  };
  readonly getUiScale: () => number;
  readonly setUiScale: (v: number) => void;
  /** 当前战斗快照（设置页用它显示代价 / CD）。备战阶段给空快照。 */
  readonly snapshot: () => unknown;
  readonly translate: (key: string) => string;
  /** 触屏按钮的只读预览。 */
  readonly getTouchSkills: () => readonly string[];
  readonly getShowKeyHints: () => boolean;
  readonly pixi: SettingsPanelOptions['pixi'];
  /** 关闭面板（由 `settingsToggle` 处理"恢复暂停"）。 */
  readonly close: () => void;
  /** 键盘捕获转发（输入层独占键盘）。 */
  readonly capture: (handler: ((key: string) => void) | undefined) => void;
  /** 是否正由主监听器处理这次按键（是则跳过捕获，避免重复投递）。 */
  readonly isHandlingKeyDown: () => boolean;
}

/** 造一份设置面板选项。 */
export function buildSettingsOptions(d: SettingsOptionsDeps): SettingsPanelOptions {
  const t = d.translate;
  return {
    /** 触屏按钮的只读预览 —— 从布局读（唯一真相）。 */
    getTouchSkills: () => d.getTouchSkills(),
    getShowKeyHints: () => d.getShowKeyHints(),
    pixi: d.pixi,
    translate: (key) => t(key),
    getRows: () =>
      buildKeyRows({
        bindings: d.getBindings(),
        registry: d.registry,
        snapshotOf: () => (d.snapshot() ?? EMPTY_SNAPSHOT) as never,
        translate: t,
      }),
    onRebind: (skillId, key) => {
      apply(d, rebindWithSwap(d.getBindings(), skillId, key));
    },
    /** 触屏换位（与改键分开：那个换键、这个换**位置**）。 */
    onSwapSlots: (from, to) => {
      apply(d, swapSlots(d.getBindings(), from, to));
    },
    onResetKeys: () => {
      /** 恢复默认**也覆盖存储**，否则刷新之后又变回玩家改过的键位。 */
      apply(d, DEFAULT_BINDINGS);
    },
    /**
     * 把捕获回调包一层：**主监听器正在处理这次按键时直接跳过**。
     *
     * 否则那一次按键会被输入层重复投递，导致"一次按键进入改键并立刻
     * 完成绑定"。
     */
    onCapture: (handler) =>
      d.capture(
        handler === undefined
          ? undefined
          : (key) => {
              if (d.isHandlingKeyDown()) return;
              handler(key);
            },
      ),
    onClose: () => d.close(),
    getUiScale: () => d.getUiScale(),
    onUiScale: (value) => d.setUiScale(value),
  };
}

/** 三条改动路径共用的同步（见文件头的"三处同步"）。 */
function apply(d: SettingsOptionsDeps, next: readonly KeyBinding[]): void {
  d.setBindings([...next]);
  d.settingsStore.saveBindings(d.getBindings());
}
