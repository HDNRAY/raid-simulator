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
import type { SettingsToggle } from './settingsToggle';
import type { TouchControls } from './touchControls';
import { activeInputLayer, type InputLayer } from './inputRouter';

/**
 * 一个界面的**边角控件**在主循环里要满足的最小面。
 *
 * ⚠️ 结构性类型（只有 `update`）：驱动层不需要认识 `ScreenChrome` 的其它
 * 能力（命中、缩放、焦点）—— 那些各有各的调用点（指针路由 / 设置面板 /
 * 键盘接线）。契约越小，"谁在什么时候碰它"越清楚。
 */
export interface ChromeFrameTarget {
  /** 每帧：把触屏能力同步到键位提示的显隐上。 */
  update(): void;
}

/** 主循环要驱动的界面对象。 */
export interface CanvasHost {
  /** 首页（默认入口）。 */
  readonly home: {
    frame(): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
  /**
   * **二次确认弹窗**（2026-10-22）：模态 —— 开着时**吃光**键盘与指针。
   * 只有三个动作：←→ 换焦点 / Enter 执行 / Esc 取消。
   */
  readonly confirm: {
    frame(): void;
    readonly visible: boolean;
    moveFocus(delta: number): void;
    press(): void;
    cancel(): void;
  };
  /** 图鉴（2026-10-21）：只读屏 —— 只需要 `frame()` 与"回首页"。 */
  readonly codex: {
    frame(): void;
    back(): void;
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
    /** ← →：**块内**移动光标。 */
    cycle(delta: number): void;
    /**
     * ↑ ↓：**块内**换行（炁机那块是两行；人物 / 对手只有一行）。
     *
     * ⚠️ 它与 `moveFocus`（Tab）**是两件事**，见下面那段分支里的说明。
     */
    stepVertical(dir: 'up' | 'down'): void;
    /**
     * **Shift + ↑ ↓**：滚**详情区正文**（`up` = 往回看）。
     *
     * ⚠️ 详情区**不是一块独立的区域**（用户原话："每个 tab 都有详情啊"）——
     * 它显示的就是"当前展开那一块"里的东西，所以滚它**不切焦点、不动
     * 光标**，也不是"第 4 个站"（见 `PrepareScreen.scrollDetail`）。
     */
    scrollDetail(dir: 'up' | 'down'): void;
    /** **Tab / Shift+Tab**：块与块之间换焦点。 */
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
  /** 选炁机屏（P3；← → ↑ ↓ 移光标，Enter 选一个生效）。 */
  readonly qijiSelect: {
    frame(): void;
    cycle(delta: number): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
  /**
   * **确认屏**（肉鸽每场战斗之前，2026-10-15）。
   *
   * ⚠️ 它有三件事：**Tab / ↑↓ 切焦点**（炁机 → 对手 → 开始战斗，与备战屏
   * 同一套状态机）、**Enter / Space 开始这一场**、**Shift+↑↓ 滚右侧详情**
   * （Boss 的招式 + 被动比一屏长）。
   */
  readonly runConfirm: {
    frame(): void;
    confirm(): void;
    /** **Tab / Shift+Tab / ↑ / ↓**：焦点在炁机 → 对手 → 开始战斗间切（环绕）。 */
    moveFocus(delta: number): void;
    /** **Shift + ↑ ↓**：滚右侧详情正文（不切焦点）。 */
    scrollDetail(dir: 'up' | 'down'): void;
  };
  /** 一局结束屏（P3；Enter / 点屏幕 = 回选角色）。 */
  readonly runOver: {
    frame(): void;
    confirm(): void;
  };
  /**
   * **当前这一屏的边角控件**（齿轮 / 返回箭头）—— 由那一屏自己的
   * `frame()` 调它的 `update()`（键位提示跟着唯一 flag 走）。
   *
   * ⚠️ 四个界面各自持有自己的那一个（用户 2026-10-12："多个页面的齿轮，
   * 应该分别定义"）。这里保留这个取值函数是为了**调试入口**与
   * `main.ts` 的接线看得见"谁在台上"，主循环本身不直接调它 ——
   * 战斗那一屏的齿轮归 `scene.update` 的帧部件。
   */
  readonly chrome: () => ChromeFrameTarget | undefined;
  /** 设置面板（每帧更新）。 */
  readonly settings: SettingsPanel;
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
  /**
   * **返回首页**（`Esc` / 点左上角箭头）。
   *
   * ⚠️ 键盘那条路（`Esc`）走这里，触屏/鼠标那条路走各屏 `ScreenChrome`
   * 的 `onBack`（造界面时接到这里）—— 两条路都落到 `phaseFlow` 里**同一个**闭包
   * （`backToHome`），所以不会出现"按 `Esc` 回首页、点箭头去别处"。
   */
  readonly backToHome: () => void;
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
  /**
   * **复盘那一层**（一局结束后的全屏战报）。
   *
   * ⚠️ 键盘分发要问它"开着没有"：复盘是 `battle` 相位里的**子模式**
   * （一局结束仍停在 `battle`），所以只看 `state.phase` 会把复盘漏掉 ——
   * 那正是用户报的"上下键无效、反而选中设置按钮"。
   */
  readonly review: {
    /** 复盘此刻是否在接收输入。 */
    isOpen(): boolean;
    /** 把这次按键交给复盘（`true` = 消费了）。 */
    handleKey(key: string): boolean;
  };
  /**
   * **FPS 层**（`?fps=1` 才存在；`app/fpsOverlay.createFpsOverlay` 的产物）。
   *
   * ⚠️ 它由**这里**喂帧（`state.frameCount += 1` 那一刻），而不是自己挂一个
   * `requestAnimationFrame` —— 帧的唯一真相就是那个 ticker，两份必然漂
   * （设计稿 §1/§6）。所以这一层只暴露一个 `frame(now)`。
   */
  readonly fps?: { frame(nowMs: number): void } | undefined;
}

/**
 * 装上主循环 + 键盘 + 卸载处理，并标记页面就绪。
 *
 * ⚠️ 它**不构造任何界面对象** —— 全部由调用方传进来（`CanvasHost`）。
 * 这样"驱动"与"装配"分开：主循环将来要加暂停 / 快进只需要动这里。
 */
export function wireLoop(o: WireOptions): void {
  const { state, host } = o;

  /**
   * **谁在接收输入** —— 一个地方回答（`app/inputRouter.ts`）。
   *
   * ⚠️ 主循环的每帧分发**仍然按 `phase`**（那是"哪一屏要重画 / 显隐"的事，
   * 由 `applyPhase` 收口）；只有**键盘归属**走这一层 —— 因为键盘要看
   * "子模式"（复盘 / 设置），而重画不看。两件事的判据不同，不要合并。
   */
  const layerNow = (): InputLayer =>
    activeInputLayer({
      phase: state.phase,
      settingsOpen: host.settingsToggle.isOpen(),
      reviewOpen: o.review.isOpen(),
    });

  /* ---------- 主循环 ---------- */
  o.app.ticker.add(() => {
    /**
     * 帧计数在这里加（调试探针靠它证明"战斗在推进"）。
     *
     * ⚠️ 写进 `state.frameCount` 而不是一个局部 `let`：探针在别的模块里
     * 读同一个值，复制一份就会出现"探针里的帧数永远不动"。
     */
    state.frameCount += 1;
    /**
     * ⚠️ **FPS 采样紧贴帧计数**（就在这一行下面）：那个计数器是"帧"的
     * 唯一真相，采样必须与它同源 —— 排在相位分支**之前**，所以菜单 / 战斗
     * 都算（FPS 是**应用**的帧率，不是"战斗的帧率"）。`?fps=1` 之外它是
     * `undefined`，这一行就是一次可选的调用，没有任何别的影响。
     */
    o.fps?.frame(performance.now());
    if (state.phase !== 'battle') {
      /**
       * **非战斗阶段**：**不碰战斗**（`loop` 已经 dispose）。三个整屏界面
       * 各画各的，战斗场景与触屏按钮整块藏起来 —— 否则会从界面下面露出来。
       *
       * ⚠️ 显隐的**唯一写入点**是 `game.ts` 的 `applyPhase`，这里只负责
       * "让当前那一屏重画"。所以这里的分发**必须**覆盖全部非战斗 phase：
       * 少一个分支的表现是"那一屏停住不动"（选择变了画面不跟）。
       */
      /** ⚠️ 模态优先：开着就先画它（也不让下面那些屏继续吃帧）。 */
      if (host.confirm.visible) {
        host.confirm.frame();
        host.settings.update();
        return;
      }
      if (state.phase === 'home') host.home.frame();
      else if (state.phase === 'characterSelect') host.select.frame();
      else if (state.phase === 'prepare') host.prepare.frame();
      else if (state.phase === 'runConfirm') host.runConfirm.frame();
      else if (state.phase === 'qijiSelect') host.qijiSelect.frame();
      /**
       * ⚠️ **2026-10-21 补**：图鉴这一屏原先落在最后那个 `else`（= 被当成
       * `runOver`）⇒ 它的 `frame()` 永远不跑（画面靠 `setVisible` 里那次
       * 重画撑着，看起来"正常"，但任何逐帧效果都不会动）。
       * 用户报的"图鉴没有清首页的按键"同源：这张分发表**漏了一屏**。
       */
      else if (state.phase === 'codex') host.codex.frame();
      else host.runOver.frame();
      /**
       * ⚠️ **非战斗阶段也要调触屏层的 `frame()`（不带快照）**：
       * 它是"按钮层显隐"的**唯一写入点**，而按钮层的初值是
       * `visible = caps.touch` —— 不在这条分支里算一次，触屏设备上首页 /
       * 选角色 / 自由模式的右下角就会一直浮着双弧按钮（实测踩到）。
       */
      host.touch.frame();
      host.settings.update();
      return;
    }
    const l = host.battle();
    if (l === undefined) return; // 理论上到不了；防一手崩溃
    l.frame(performance.now());
    /**
     * ⚠️ 战斗那一屏的齿轮由**场景**持有，所以它跟着 `scene.update` 里注册的
     * 帧部件走（`parts/battleChrome.ts`）—— 这里不用再调一次。
     */
    host.scene.update(l.snapshot, l.logEntries);
    /** 触屏按钮的文本要跟着快照更新（冷却数字会变）。 */
    host.touch.frame(l.snapshot);
    host.settings.update();
  });

  /* ---------- 重开 / 返回 ----------
   * 战斗结束后：**键盘 Enter** 或 **触屏点屏幕** 都离开战斗。
   *
   * ⚠️ 两条路径**共用这一个函数** —— 否则很容易出现"桌面能重开、
   * 触屏不行"这种只在一边坏掉的问题。
   *
   * ⚠️ 去哪一屏由 `host.backFromBattle` 决定（肉鸽 → 选角色；
   * 自由 → 备战界面）。这里不判模式，避免三处各判一遍。 */
  window.addEventListener('keydown', (event) => {
    /**
     * **这一次按键归谁** —— 一个地方回答（`app/inputRouter.ts`）。
     *
     * ⚠️ 原先每个分支各判一次 `state.phase`，而"复盘"是 `battle` 相位里的
     * **子模式** —— 于是复盘开着时 `state.phase !== 'battle'` 为假，
     * 整段键盘分发被跳过，上下键落到别处（设置按钮）。用户报的就是这条。
     */
    const layer = layerNow();

    /**
     * **复盘开着：这一次按键整块交给它**（`Space` 切换战报、`↑↓` /
     * `PgUp·PgDn` / `Home·End` 滚动）。
     *
     * ⚠️ 放在**最前**且**整体 return**：
     *   - 排在后面：`ArrowUp` 会先被别的分支看到（这正是设置按钮抢键的形态）
     *   - 不 return：一次按键会同时滚日志又做别的事
     *
     * ⚠️ 它**不抢 `Esc`**：复盘没有"关闭"语义（`Space` 才是切换键），
     * 而 `Esc` 在 `battle` 相位本来就不做事（见下面 `phaseFromEscape` 的表）。
     * 所以把 `Esc` 放行给下面那条返回分支 —— 它自己判"该相位有没有返回目标"。
     */
    if (layer === 'review' && event.key !== 'Escape') {
      if (o.review.handleKey(event.key)) event.preventDefault();
      return;
    }

    /**
     * **返回（`Esc`）先判** —— 它在"哪个相位能用"这件事上与前缀无关。
     *
     * | 相位 | `Esc` |
     * |---|---|
     * | 首页 | 无（首页就是返回的目标） |
     * | 选角色 | → 首页 |
     * | 自由模式 | → 首页 |
     * | 战斗 | **什么都不做** |
     *
     * ⚠️ **战斗中 `Esc` 不做事，也不被消费**（用户的判断）：战斗中的 `Esc`
     * 传统上是"暂停 / 菜单"，而本作**没有菜单**，所以它没有语义。
     * 既不中途弃局（没有确认的弃局比如没反应更坏），也不打开设置
     * —— 设置现在是 `F1`（原先是 `Esc` / `,`，这一轮腾给了返回）。
     *
     * ⚠️ 三条前置守卫与下面那段**同源**，不能少：
     *   - `settingsToggle.isOpen()`：面板开着时 `Esc` 是**它的**关闭键
     *   - `settingsButtonFocused()`：焦点在齿轮上时，`Esc` 不该顺手把界面
     *     也切走（与 `Enter` 那条同一个道理）
     *   - `layer !== 'battle'`：见上表最后一行（复盘开着时，`layer` 是
     *     `review`，`phaseFromEscape` 对 `battle` 相位本来就没有目标，
     *     所以这里不额外判 —— 判据仍然只有一处）
     */
    if (
      !host.settingsToggle.isOpen() &&
      !state.settingsButtonFocused() &&
      layer !== 'battle' &&
      event.key === 'Escape'
    ) {
      /**
       * 目标相位由 `game.ts` 的 `backToHome` 自己判（`phaseFromEscape`）
       * —— 这里**不重复判一次**：那是同一个判据的第二份，而两份判据
       * 漂移的样子正是"首页按 Esc 会跳到某处"。
       */
      host.backToHome();
      return;
    }
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
     * | 自由模式 | ↑ ↓ | **块内**走光标（人物 → 对手 → 开始），两端停住 |
     * | 自由模式 | Shift + ↑ ↓ | **滚详情区正文**（不切焦点、不动光标；见下） |
     * | 自由模式 | Tab / Shift+Tab | 同上但**环绕**（Tab 的通用语义） |
     * | 自由模式 | Enter | **确定**光标处的那一项；在「开始战斗」上时开战 |
     * | 确认屏 | Tab / ↑ ↓ | 焦点在炁机 → 对手 → 开始战斗间切（环绕） |
     * | 确认屏 | Enter / Space | 开始这一场 |
     * | 确认屏 | Shift + ↑ ↓ | 滚右侧详情正文（Boss 的招式比一屏长） |
     * | 自由模式 / 选角色 | `Esc` | **返回首页**（战斗中无反应，见上） |
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
     * ⚠️ 三条分支**互斥**（输入层一次只有一个值），但每条都要
     * `default: return`：不 return 的话未处理的键会掉到下面的战斗分支上，
     * 而那里判的是 `state.loop`（非战斗阶段是 `undefined`）。
     *
     * ⚠️ 判 `layer !== 'battle'` 仍然对：复盘开着时上面那段已经 return 了，
     * 所以走到这里只可能是"三个整屏界面之一"或"设置面板"。
     */
    /**
     * **模态确认框开着时吃光键盘**（2026-10-22）：
     * ←→ / Tab 换焦点、Enter 执行、Esc 取消；其余键无视。
     */
    if (host.confirm.visible) {
      switch (event.key) {
        case 'ArrowLeft':
          host.confirm.moveFocus(-1);
          return;
        case 'ArrowRight':
        case 'Tab':
          host.confirm.moveFocus(1);
          event.preventDefault();
          return;
        case 'Enter':
        case ' ':
          host.confirm.press();
          return;
        case 'Escape':
          host.confirm.cancel();
          return;
        default:
          return;
      }
    }

    if (
      !host.settingsToggle.isOpen() &&
      !state.settingsButtonFocused() &&
      layer !== 'battle'
    ) {
      if (layer === 'home') {
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
      /**
       * **选炁机屏（P3）**：与其它选择屏同构 —— ← → ↑ ↓ 移光标、
       * Enter 选一个生效。⚠️ **没有"确定 / 取消"两步**：选了当场生效
       * （§5.3"选了不能换"），所以 Enter 与点击是同一种动作。
       */
      if (layer === 'qijiSelect') {
        switch (event.key) {
          case 'ArrowLeft':
            host.qijiSelect.cycle(-1);
            return;
          case 'ArrowRight':
            host.qijiSelect.cycle(1);
            return;
          case 'ArrowUp':
            host.qijiSelect.moveFocus(-1);
            return;
          case 'ArrowDown':
            host.qijiSelect.moveFocus(1);
            return;
          case 'Tab':
            host.qijiSelect.moveFocus(event.shiftKey ? -1 : 1, true);
            event.preventDefault();
            return;
          case 'Enter':
            host.qijiSelect.confirm();
            return;
          default:
            return;
        }
      }
      /**
       * **一局结束屏（P3）**：整屏只有一个动作（回选角色），所以只认
       * `Enter`；`Esc` 已经在上面那条返回分支里处理过了
       * （`phaseFromEscape('runOver')` = `'characterSelect'`，两者**同一个
       * 去向**，见 `phaseLogic` 的表）。
       */
      if (layer === 'runOver') {
        if (event.key === 'Enter') host.runOver.confirm();
        return;
      }
      /**
       * **图鉴（2026-10-21）**：只读屏 —— `Enter` / `Space` / `Backspace` 回首页
       * （与"点屏幕任意处"同一条），**其余键一律吃掉**。
       *
       * ⚠️ 关键是最后那个 `return`：不加的话 `←→↑↓` 会漏到下面的战斗分支上，
       * 而用户在首页按过的那几个键（`↑↓` / `Tab` / `Enter`）就会在**图鉴里
       * 继续作用在首页状态上** —— 这就是"图鉴没有清首页的按键"。
       */
      if (layer === 'codex') {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Backspace') {
          host.codex.back();
        }
        return;
      }
      /**
       * **确认屏（肉鸽；2026-10-15）**：Tab 切焦点、Enter 开始、Shift+↑↓ 滚详情。
       *
       * ⚠️ 这一屏的分工与备战屏**逐条对应**（"老规矩"）：
       *
       * ```
       *   Tab / Shift+Tab  → 焦点跨块（炁机 → 对手 → 开始战斗，环绕）
       *   ↑ ↓              → 同上（这一屏的块内没有游标，所以不另设一条）
       *   Shift + ↑ ↓      → 滚右侧详情正文（不切焦点）
       *   Enter / Space    → 开始这一场（确认屏上"Enter = 确认"）
       * ```
       *
       * ⚠️ `Space` 也认：它是"确认"的通用键（触屏对等不受影响 —— 触屏走
       * 点「开始战斗」那一条），而这一屏是"确认 / 继续"语义，正是空格的
       * 传统含义。一局结束屏只认 `Enter`（那里没有需要防的歧义），
       * 两者不同**是有意的**。
       */
      if (layer === 'runConfirm') {
        switch (event.key) {
          case 'Tab':
            host.runConfirm.moveFocus(event.shiftKey ? -1 : 1);
            event.preventDefault();
            return;
          case 'ArrowUp':
          case 'ArrowDown': {
            const dir = event.key === 'ArrowUp' ? 'up' : 'down';
            if (event.shiftKey) host.runConfirm.scrollDetail(dir);
            else host.runConfirm.moveFocus(dir === 'up' ? -1 : 1);
            return;
          }
          case 'Enter':
          case ' ':
            host.runConfirm.confirm();
            return;
          default:
            return;
        }
      }
      if (layer === 'characterSelect') {
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
        /**
         * ==============================================================
         * ⚠️⚠️ 2026-10-13 第三轮：**方向键只管块内，Tab 才跨块**
         * ==============================================================
         *
         * 用户原话："**炁机内部无法用方向键选择，所以把人物 炁机 对手的
         * 切换换成 tab**"。
         *
         * 旧版这里 ↑ ↓ 调的是 `moveFocus`（= 换块），而炁机那一块是**两行**
         * （8 条 5 列）—— 于是**第二行的炁机永远选不到**（↑↓ 直接从炁机块
         * 跳到人物 / 对手），而 ← → 到行尾又不环绕。两件事叠起来就是用户
         * 看到的那句"炁机内部无法用方向键选择"。
         *
         * 现在分工是**互斥**的（见 `prepareLogic.stepCursor` 的说明）：
         *
         * ```
         *   ← → ↑ ↓  → 块【内】**（`cycle` / `stepVertical`，到边界停住）
         *   Tab      → 块【间】（`moveFocus`，唯一的路，环绕）
         *   Shift+↑↓ → **详情区正文**（`scrollDetail`：不切焦点、不动光标）
         * ```
         */
        case 'ArrowLeft':
          host.prepare.cycle(-1);
          return;
        case 'ArrowRight':
          host.prepare.cycle(1);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          const dir = event.key === 'ArrowUp' ? 'up' : 'down';
          /**
           * ============================================================
           * ⚠️⚠️ 2026-10-13 第五轮：**Shift + ↑ ↓ = 滚详情区正文**
           * ============================================================
           *
           * 详情区**不是一块独立的区域**（用户纠正过上层的一个理解错误：
           * "**每个 tab 都有详情啊**"）—— 它显示的就是"当前展开那一块"
           * 里的东西。所以"滚它"是**不需要切焦点**的动作：
           *
           * ```
           *   ↑ ↓        → 块【内】走光标（`stepVertical`，到边界停住）
           *   Shift+↑ ↓  → 滚详情区（本分支；不管当前展开哪一块、光标在哪）
           * ```
           *
           * ⚠️ 两条路在这里**互斥**（裸 ↑↓ 一个字没变）：详情区没有自己的
           * 焦点，"滚它"就绝不能抢走"块内走光标"。
           *
           * ⚠️ 触屏对等（AGENTS.md §3b）走的是**另一条已经存在的路**
           * ——拖动详情（`PrepareScreen.dragDetail`），不是这一条。
           */
          if (event.shiftKey) host.prepare.scrollDetail(dir);
          else host.prepare.stepVertical(dir);
          return;
        }
        case 'Tab':
          /**
           * Shift+Tab 反向。它是**唯一**能跨块的键，所以必须**环绕** ——
           * 两端停住的话，在「开始战斗」上按 Tab 会毫无反应，而玩家对
           * Tab 的预期是"跳到下一个"。
           *
           * ⚠️ 触屏没有 Tab（AGENTS.md §3b）：那条路是**点块头展开**
           * （`PrepareScreen.expand`，见 `hitTest` 的 `summary` 分支）。
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
      layer === 'battle' &&
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
