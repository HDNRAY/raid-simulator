/**
 * **设置面板的开关**（含"打开时暂停战斗"的状态机）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它管着一个**容易被漏掉的状态**：打开设置前是否本来就暂停。抽出来之后
 * "打开 → 记住原状态 → 关闭 → 恢复"这条链在一处看全，而 `main.ts` 的
 * 装配只剩一行接线。
 *
 * ==================================================================
 * ⚠️ 打开设置必须暂停战斗
 * ==================================================================
 *
 * 否则玩家在改键时会被 Boss 打死（而且读条会继续走完）。
 *
 * ⚠️ 关闭时**恢复原状**，不是无脑 `setPaused(false)`。
 * 否则"暂停中打开设置、关掉设置"会把玩家的暂停状态吞掉 —— 玩家明明
 * 还按着暂停，界面却继续跑了。
 */

import type { SettingsOrigin, SettingsTab } from '../ui/settings/tabs';

export interface SettingsToggleTargets {
  /** 面板本体。 */
  readonly settings: {
    /** ⚠️ `origin` = **从哪打开的**（决定哪几页可见，见 `ui/settings/tabs.ts`）。 */
    open(tab: SettingsTab, origin: SettingsOrigin): void;
    close(): void;
  };
  /**
   * 打开设置时的**来源**（`home` / `gameplay`）。
   *
   * ⚠️ 是**取值函数**而不是构造期快照：同一个面板会先在首页打开、
   * 再在战斗里打开，来源当然不同。
   */
  readonly origin: () => SettingsOrigin;
  /** 当前是否暂停（可能是玩家自己暂停的）。 */
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  /**
   * 打开 / 关闭时藏 / 显示**齿轮**。
   *
   * ⚠️ 它由调用方实现为"藏**当前那一屏**的齿轮"（`game.ts` 的
   * `getChrome()`）—— 齿轮从"一个共享组件"变成**四个界面各自持有**之后，
   * 本模块不再认识某一个具体的按钮对象。契约保持只有两个动作，
   * 于是"谁拥有齿轮"这件事不进这里。
   *
   * 为什么必须藏：旧版齿轮在面板打开后仍然可见（实测
   * `stage.children[1].visible === true`），从面板边缘露出来，既重叠又
   * 让人以为还能点。面板的命中测试虽然会拦下点击，但那只是"不可点"，
   * 不是"看起来不可点"。
   */
  setGearVisible(visible: boolean): void;
}

export interface SettingsToggle {
  isOpen(): boolean;
  open(tab: SettingsTab): void;
  close(): void;
  toggle(): void;
}

/**
 * 造一个设置开关。
 *
 * ⚠️ 返回的是**闭包持有的状态**，而不是让调用方各存一个 `settingsOpen`
 * 布尔 —— 两处真相必然出现"面板关了但标记还是 true"这类不一致。
 */
export function createSettingsToggle(t: SettingsToggleTargets): SettingsToggle {
  let open = false;

  /**
   * 打开设置前是否**本来就**处于暂停（关闭时要恢复这个值）。
   */
  let pausedBefore = false;

  const openSettings = (tab: SettingsTab): void => {
    if (open) return;
    open = true;
    pausedBefore = t.isPaused();
    // 打开设置必须暂停战斗 —— 否则玩家改键时会被 Boss 打死
    t.setPaused(true);
    /** 面板打开时隐藏齿轮 —— 否则它会从面板边缘露出来（看着还能点）。 */
    t.setGearVisible(false);
    t.settings.open(tab, t.origin());
  };

  const close = (): void => {
    open = false;
    t.setGearVisible(true);
    t.settings.close();
    // 恢复打开前的暂停状态
    t.setPaused(pausedBefore);
  };

  return {
    isOpen: () => open,
    open: openSettings,
    close,
    toggle: () => (open ? close() : openSettings('keys')),
  };
}
