/**
 * **主循环与窗口级事件**（Pixi ticker + 键盘 + 卸载）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这是应用的"驱动层"：每帧把时间推给谁、键盘事件怎么分发到备战 / 战斗、
 * 页面卸载时释放什么。它与"界面怎么造出来"是两件事，而且它的三段各自
 * 带着独立的由来（重开的两条路径必须共用一个函数、`Tab` 必须
 * `preventDefault`、`ResizeObserver` 要显式 dispose）。
 */

import type { BattleLoop } from './battleLoop';
import type { GameState } from './flow';
import type { SettingsPanel } from '../ui/settings/SettingsPanel';
import type { SettingsButton } from '../ui/settings/SettingsButton';
import type { SettingsToggle } from './settingsToggle';
import type { TouchControls } from './touchControls';

/** 主循环要驱动的界面对象。 */
export interface CanvasHost {
  /** 首页（默认入口）。 */
  readonly home: {
    frame(): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
  /** 选角色屏（肉鸽模式的第一屏）。 */
  readonly select: {
    frame(): void;
    cycle(delta: number): void;
    confirm(): void;
  };
  /** 自由模式（原备战界面；`frame()` / 键盘分发用）。 */
  readonly prepare: {
    frame(): void;
    cycle(delta: number): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
  /** 设置面板（每帧更新）。 */
  readonly settings: SettingsPanel;
  /** 设置齿轮按钮（每帧更新）。 */
  readonly settingsButton: SettingsButton;
  /** 触屏按钮层（每帧按快照更新文本）。 */
  readonly touch: TouchControls;
  /** 战斗场景（每帧把快照推给它）。 */
  readonly scene: {
    update(
      view: BattleLoop['snapshot'],
      logEntries: BattleLoop['logEntries'],
    ): void;
  };
  /** 设置开关（键盘分发时读 `isOpen()`）。 */
  readonly settingsToggle: SettingsToggle;
  /**
   * 战斗结束后按 Enter / 触屏点屏的去向。
   *
   * ⚠️ 名字不再是 `backToPrepare`：现在是**按模式分流**的
   * （肉鸽 → 选角色；自由 → 备战界面）。分流判据在 `game.ts` 里
   * （`runSession.active` 是唯一的真相），这里只管"叫它一声"。
   */
  readonly backFromBattle: () => void;
  /** 当前的战斗循环（非战斗阶段为 `undefined`）。 */
  readonly battle: () => BattleLoop | undefined;
}

export interface WireOptions {
  readonly state: GameState;
  readonly host: CanvasHost;
  readonly app: {
    readonly ticker: { add(fn: () => void): void };
  };
  /** `#stage` 容器（页面就绪标记加在它身上，缩放观察也看它）。 */
  readonly stage: HTMLElement;
  /** 缩放观察器的句柄（卸载时要 dispose）。 */
  readonly observer: {
    refresh(): void;
    dispose(): void;
  };
}

/**
 * 装上主循环 + 键盘 + 卸载处理，并标记页面就绪。
 *
 * ⚠️ 它**不构造任何界面对象** —— 全部由调用方传进来（`CanvasHost`）。
 * 这样"驱动"与"装配"分开：主循环将来要加暂停 / 快进只需要动这里。
 */
export function wireLoop(o: WireOptions): void {
  const { state, host } = o;

  /* ---------- 主循环 ---------- */
  o.app.ticker.add(() => {
    /**
     * 帧计数在这里加（调试探针靠它证明"战斗在推进"）。
     *
     * ⚠️ 写进 `state.frameCount` 而不是一个局部 `let`：探针在别的模块里
     * 读同一个值，复制一份就会出现"探针里的帧数永远不动"。
     */
    state.frameCount += 1;
    if (state.phase !== 'battle') {
      /**
       * **非战斗阶段**：**不碰战斗**（`loop` 已经 dispose）。三个整屏界面
       * 各画各的，战斗场景与触屏按钮整块藏起来 —— 否则会从界面下面露出来。
       *
       * ⚠️ 显隐的**唯一写入点**是 `game.ts` 的 `applyPhase`，这里只负责
       * "让当前那一屏重画"。所以这里的分发**必须**覆盖全部非战斗 phase：
       * 少一个分支的表现是"那一屏停住不动"（选择变了画面不跟）。
       */
      if (state.phase === 'home') host.home.frame();
      else if (state.phase === 'characterSelect') host.select.frame();
      else host.prepare.frame();
      /**
       * ⚠️ **非战斗阶段也要调触屏层的 `frame()`（不带快照）**：
       * 它是"按钮层显隐"的**唯一写入点**，而按钮层的初值是
       * `visible = caps.touch` —— 不在这条分支里算一次，触屏设备上首页 /
       * 选角色 / 自由模式的右下角就会一直浮着双弧按钮（实测踩到）。
       */
      host.touch.frame();
      host.settingsButton.update();
      host.settings.update();
      return;
    }
    const l = host.battle();
    if (l === undefined) return; // 理论上到不了；防一手崩溃
    l.frame(performance.now());
    host.scene.update(l.snapshot, l.logEntries);
    /** 触屏按钮的文本要跟着快照更新（冷却数字会变）。 */
    host.touch.frame(l.snapshot);
    host.settingsButton.update();
    host.settings.update();
  });

  /* ---------- 重开 ----------
   * 战斗结束后：**键盘 Enter** 或 **触屏点屏幕** 都离开战斗。
   *
   * ⚠️ 两条路径**共用这一个函数** —— 否则很容易出现"桌面能重开、
   * 触屏不行"这种只在一边坏掉的问题。
   *
   * ⚠️ 去哪一屏由 `host.backFromBattle` 决定（肉鸽 → 选角色；
   * 自由 → 备战界面）。这里不判模式，避免三处各判一遍。 */
  window.addEventListener('keydown', (event) => {
    /**
     * **各屏的键盘操作**。
     *
     * | 屏幕 | 键 | 作用 |
     * |---|---|---|
     * | 首页 | ↑ ↓ | 移动光标（两端停住） |
     * | 首页 | Tab / Shift+Tab | 同上但**环绕** |
     * | 首页 | Enter | 进入光标处的模式 |
     * | 选角色 | ← → / Tab | 在卡片间移动光标（不改已确定的角色） |
     * | 选角色 | Enter | 以光标处的角色开始一局肉鸽 |
     * | 自由模式 | ← → | 在槽位里**移动光标**（不改选择） |
     * | 自由模式 | ↑ ↓ | 换槽位（人物 → 对手 → 开始），两端停住 |
     * | 自由模式 | Tab / Shift+Tab | 同上但**环绕**（Tab 的通用语义） |
     * | 自由模式 | Enter | **确定**光标处的那一项；在「开始战斗」上时开战 |
     *
     * ⚠️ **移动光标 ≠ 确定选择**（需求原话："用 enter 来确定选择，
     * 而不是靠移动到下一项"）。旧的 `Enter` 直接 `prepare.start()`，
     * 而"选谁"是靠方向键移动带出来的 —— 现在方向键只动光标。
     *
     * ⚠️ `Tab` 必须 `preventDefault`：否则浏览器会把焦点移出画布
     * （架构规范 §7 明确要求拦下 Tab）。
     *
     * ⚠️ 设置面板打开 / 齿轮按钮聚焦时**不能抢键** —— 那时玩家可能正在
     * 改键，方向键是移动焦点的。`settingsToggle.isOpen()` 与
     * `settingsButtonFocused()` 的优先级高于一切界面。
     *
     * ⚠️ 三条分支**互斥**（`phase` 一次只有一个值），但每条都要
     * `default: return`：不 return 的话未处理的键会掉到下面的战斗分支上，
     * 而那里判的是 `state.loop`（非战斗阶段是 `undefined`）。
     */
    if (
      !host.settingsToggle.isOpen() &&
      !state.settingsButtonFocused() &&
      state.phase !== 'battle'
    ) {
      if (state.phase === 'home') {
        switch (event.key) {
          case 'ArrowUp':
            host.home.moveFocus(-1);
            return;
          case 'ArrowDown':
            host.home.moveFocus(1);
            return;
          case 'Tab':
            /** Shift+Tab 反向；环绕是 Tab 的通用语义。 */
            host.home.moveFocus(event.shiftKey ? -1 : 1, true);
            event.preventDefault();
            return;
          case 'Enter':
            host.home.confirm();
            return;
          default:
            return;
        }
      }
      if (state.phase === 'characterSelect') {
        switch (event.key) {
          case 'ArrowLeft':
            host.select.cycle(-1);
            return;
          case 'ArrowRight':
            host.select.cycle(1);
            return;
          case 'Tab':
            /**
             * ⚠️ 只用一行卡片，没有"下一行"可去 —— 但 Tab 仍然要拦下
             * （否则焦点跑出画布），所以让它**同 ← →**（到两端停住）。
             */
            host.select.cycle(event.shiftKey ? -1 : 1);
            event.preventDefault();
            return;
          case 'Enter':
            host.select.confirm();
            return;
          default:
            return;
        }
      }
      switch (event.key) {
        case 'ArrowLeft':
          host.prepare.cycle(-1);
          return;
        case 'ArrowRight':
          host.prepare.cycle(1);
          return;
        case 'ArrowUp':
          host.prepare.moveFocus(-1);
          return;
        case 'ArrowDown':
          host.prepare.moveFocus(1);
          return;
        case 'Tab':
          /**
           * Shift+Tab 反向。与 ↑↓ 的区别只有**环绕**（Tab 的通用语义）——
           * 两端停住的话，在「开始战斗」上按 Tab 会毫无反应，而玩家对
           * Tab 的预期是"跳到下一个"。
           */
          host.prepare.moveFocus(event.shiftKey ? -1 : 1, true);
          event.preventDefault();
          return;
        case 'Enter':
          host.prepare.confirm();
          return;
        default:
          return;
      }
    }
    if (
      state.phase === 'battle' &&
      event.key === 'Enter' &&
      host.battle()?.engineState.snapshot.status !== 'running'
    ) {
      host.backFromBattle();
    }
  });

  /**
   * ⚠️ 页面卸载时也要 `dispose` 掉缩放观察器：`ResizeObserver` 不释放
   * 会在热重载 / 页面切换时留下悬挂回调（它仍旧读着已经报废的 canvas）。
   */
  window.addEventListener('pagehide', () => {
    o.observer.dispose();
    state.loop?.dispose();
  });

  /** 让测试 / 截图脚本知道"首页已经装配完了"（`styles.css` 用它淡入）。 */
  o.stage.classList.add('ready');
}
