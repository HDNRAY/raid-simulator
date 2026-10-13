/**
 * **调试入口的两块**（`window.__raidBattle.prepare` / `.settings`）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 它们的成员都是"转调界面自己的方法"，几十行样板；留在 `main.ts`
 * （已经很长的装配文件）里会把装配流水账冲淡。抽出来之后：
 *   - `main.ts` 只写一行 `...settingsDebugApi(settings)` / `...prepareDebugApi(prepare)`
 *   - 这两个入口的**存在理由**（为什么 headless 下必须读状态而不是看图）
 *     集中在一处，而不是散在装配代码中间
 *
 * ⚠️ 它们**不另写一套逻辑**：每个方法都直接转调界面自己的方法
 * （与键盘 / 点击同一条路径）。旁路会掩盖真 bug —— 例如"方向键只移动
 * 光标"这条需求，如果调试入口自己改状态，那验证的就是调试入口而不是界面。
 */

/**
 * ⚠️ tab 用 `SettingsTab` 而不是 `'general' | 'keys'` 字面量：面板现在有
 * **三个** tab（加了「触屏」），写死两个字面量会让调试入口打不开第三页
 * —— 而"验证脚本进不去"正是这次要修的那类问题。
 *
 * 类型从 `ui/settings/logic` 取（**类型**，编译期擦除，不构成运行期依赖）。
 */
import type { SettingsTab } from '../ui/settings/tabs';
import type { PanelTextMetric } from '../ui/settings/panelTextProbe';

/**
 * ⚠️ **必须把 Pixi 对象在页面里拍平成纯数据**（`toPlain`），不能直接把
 * `panelText()` 的返回值交给 `Runtime.evaluate` 的 `returnByValue`。
 *
 * 实测过的坑：Pixi v8 的文字对象把 `style` / `worldTransform` 挂在**原型
 * getter** 上，而 CDP 的值序列化只认对象自己的属性 —— 于是脚本读到的
 * `fontSize` / `x` / `y` 全是 `-1`（"探针说 -1"看起来像"字号没设"，
 * 排查方向直接跑偏）。
 */
function toPlainText(metrics: readonly PanelTextMetric[]): PanelTextMetric[] {
  return metrics.map((t) => ({ ...t }));
}

/**
 * 备战界面暴露给调试的最小面（`PrepareScreen` 满足它）。
 *
 * ⚠️ 2026-10-13（自由模式改造）加了四样，**都是为了"截图能当证据"**：
 *
 *   - `current.cursor.qijiId`：光标现在停在哪条炁机上
 *   - `freeQiji`：当前开着哪些炁机、各几层（**效果叠加**的验收要读它）
 *   - `hover(x, y)`：鼠标悬停（详情区的鼠标那条路）
 *   - `detail()`：详情区**此刻显示的是哪一项** —— 截图能看出"面板上有字"，
 *     但"是**谁的**字"只有这个读数能钉死
 *   - `current.expanded` / `expand(slot)`：手风琴**展开的是哪一块**
 *     （2026-10-13 第二轮）—— "同时只展开一块"这件事只拍图看不出来
 *     （三张图各有一块展开，但"另外两块收起了吗"要靠这个读数）
 *
 * ⚠️ 全部是**只读 + 转调**（同本文件的纪律）：探针不解释规则，
 * 只是把界面已有的状态读出来。
 */
export interface PrepareDebugTarget {
  current: {
    readonly playerId: string;
    readonly bossId: string;
    readonly focus: 'player' | 'qiji' | 'boss' | 'start';
    /** 手风琴里**展开的那一块**（焦点在「开始」上时它保持上一块）。 */
    readonly expanded: 'player' | 'qiji' | 'boss';
    readonly cursor: { readonly playerId: string; readonly bossId: string; readonly qijiId: string };
  };
  /** 当前开着的炁机（id → 层数；没开的不出现）。 */
  readonly freeQiji: Readonly<Record<string, number>>;
  cycle(delta: number): void;
  moveFocus(delta: number, wrap?: boolean): void;
  confirm(back?: boolean): void;
  pick(kind: 'player' | 'boss', id: string): void;
  focusSlot(slot: 'player' | 'qiji' | 'boss' | 'start'): void;
  /** 展开某一块（手风琴；只换焦点，不改选择）。 */
  expand(slot: 'player' | 'qiji' | 'boss'): void;
  /** 鼠标悬停到逻辑坐标（返回有没有命中）。 */
  hover(px: number, py: number): boolean;
  /** 详情区此刻显示的是哪一项（`undefined` = 没聚焦任何卡片）。 */
  detail(): { readonly kind: 'player' | 'qiji' | 'boss'; readonly id: string } | undefined;
  /** 详情区**此刻拿到的画面模型**（只读；`undefined` = 没聚焦任何卡片）。 */
  detailModel(): unknown;
  /** 清空炁机激活（让截图 / 探针可复现）。 */
  resetQiji(): void;
  /** 当前布局的可点区域（**只读**；截图脚本按它换算真实坐标）。 */
  hitAreas(): readonly {
    readonly kind: string;
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }[];
}

/**
 * 备战界面的调试入口。
 *
 * 需求（用户）："选中 和 目前光标 目前颜色是一样的" → 改完之后
 * "光标与选择可以分离"。**这条不能只靠截图验证**：画面上的区别是颜色，
 * 而"白框在哪张卡 / 金底在哪张卡"读取状态才是硬证据（截图只用来确认
 * "确实看得出区别"）。
 *
 * ⚠️ `state()` 返回**拷贝**：调用方（验证脚本）拿到的对象若与内部共享，
 * 它自己改一下就会把界面状态改坏 —— 调试入口不该有写穿的能力。
 */
export function prepareDebugApi(prepare: PrepareDebugTarget): {
  readonly prepare: {
    state(): PrepareDebugTarget['current'];
    freeQiji(): Readonly<Record<string, number>>;
    detail(): ReturnType<PrepareDebugTarget['detail']>;
    cycle(delta: number): void;
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(back?: boolean): void;
    pick(kind: 'player' | 'boss', id: string): void;
    focusSlot(slot: 'player' | 'qiji' | 'boss' | 'start'): void;
    expand(slot: 'player' | 'qiji' | 'boss'): void;
    hover(px: number, py: number): boolean;
    hitAreas(): ReturnType<PrepareDebugTarget['hitAreas']>;
    detailModel(): unknown;
    resetQiji(): void;
  };
} {
  const copy = (): PrepareDebugTarget['current'] => ({
    playerId: prepare.current.playerId,
    bossId: prepare.current.bossId,
    focus: prepare.current.focus,
    expanded: prepare.current.expanded,
    cursor: { ...prepare.current.cursor },
  });
  return {
    prepare: {
      /** 当前选择 + 光标（两者分离时能一眼看出差别）。 */
      state: copy,
      /** 同 ← →：**只移动光标**，不改选择。 */
      cycle: (delta) => prepare.cycle(delta),
      /** 同 ↑ ↓（`wrap` = Tab / Shift+Tab：可见地环绕）。 */
      moveFocus: (delta, wrap = false) => prepare.moveFocus(delta, wrap),
      /** 当前开着的炁机（效果叠加的验收读它）。 */
      freeQiji: () => ({ ...prepare.freeQiji }),
      /** 详情区此刻显示的是哪一项（"是**谁的**字"只有这个读数能钉死）。 */
      detail: () => prepare.detail(),
      /**
       * 同 Enter：确定光标处那一项；光标在炁机上则**叠一层**
       * （`back` = Shift+Enter：退一层）。
       */
      confirm: (back = false) => prepare.confirm(back),
      /** 同点击卡片：移光标 + 确定（一步到位）。 */
      pick: (kind, id) => prepare.pick(kind, id),
      /**
       * 只把**焦点**换到某个槽位（同 Tab 到达那里的状态）。
       *
       * 截图脚本用它一步摆出"光标在这一行、选择在另一行"，省掉
       * "按几次方向键"这种一改布局就失效的脆弱脚本。
       */
      focusSlot: (slot) => prepare.focusSlot(slot),
      /** 展开某一块（手风琴；截图脚本一步摆出"炁机块展开"的画面）。 */
      expand: (slot) => prepare.expand(slot),
      /** 同鼠标划过：只影响详情区（不动光标）。 */
      hover: (px, py) => prepare.hover(px, py),
      /**
       * 当前**可点区域**（只读）。
       *
       * ⚠️ 它是"截图脚本不许复制一份几何"的落点（与 `touchButtonCenter`
       * 同一条纪律）：布局一调，脚本不该跟着改；脚本问页面要坐标，
       * 点在真实命中区上，"点空了"与"功能坏了"才不会混成一个样子。
       */
      hitAreas: () => prepare.hitAreas().map((a) => ({ ...a })),
      detailModel: () => prepare.detailModel(),
      resetQiji: () => prepare.resetQiji(),
    },
  };
}

/** 首页暴露给调试的最小面（`HomeScreen` 满足它）。 */
export interface HomeDebugTarget {
  readonly current: { readonly cursor: number };
  moveFocus(delta: number, wrap?: boolean): void;
  confirm(): void;
}

/**
 * 首页的调试入口。
 *
 * 与 `prepareDebugApi` 同源的两条理由：
 *   1. headless 下模拟点击不可靠（rAF 被降频、CSS 缩放 → 逻辑坐标依赖
 *      真实布局），截图脚本需要"把界面推到某个状态再拍"
 *   2. 每个方法都**转调界面自己的方法**（同键盘 / 同点击），不另写一套 ——
 *      旁路会掩盖真 bug（验证的会是调试入口而不是界面）
 *
 * ⚠️ `state()` 返回**拷贝**：调试入口不该有写穿界面的能力。
 */
export function homeDebugApi(home: HomeDebugTarget): {
  readonly home: {
    state(): { readonly cursor: number };
    moveFocus(delta: number, wrap?: boolean): void;
    confirm(): void;
  };
} {
  return {
    home: {
      /** 光标停在第几个入口（0 = 肉鸽模式，1 = 自由模式）。 */
      state: () => ({ cursor: home.current.cursor }),
      /** 同 ↑ ↓（`wrap` = Tab / Shift+Tab）。 */
      moveFocus: (delta, wrap = false) => home.moveFocus(delta, wrap),
      /** 同 Enter：进入光标处的模式（会真的切界面）。 */
      confirm: () => home.confirm(),
    },
  };
}

/** 选角色屏暴露给调试的最小面（`CharacterSelectScreen` 满足它）。 */
/**
 * 选角色屏暴露给调试的最小面。
 *
 * ⚠️ `current` 与备战界面**同一个形状**（`PrepareDebugTarget['current']`）：
 * 两个界面共用一套光标模型，调试脚本可以复用同一段读状态的代码。
 * 选角色屏的 `bossId` 恒为空串、`cursor.qijiId` 恒为空串、`focus` 恒为
 * `'player'`（它没有对手槽位、没有炁机行、没有开始键）。
 */
export interface CharacterSelectDebugTarget {
  /**
   * ⚠️ 形状与备战界面**同一个**（`PrepareDebugTarget['current']`），所以
   * `focus` 的类型里带着 `'qiji'` —— 而这一屏今天**到不了**那个值
   * （没有炁机行）。保留同一个类型是**有意**的：调试脚本读状态的代码
   * 要能两屏复用，而"这一屏不会产生它"是运行期事实、不是类型要管的。
   */
  readonly current: PrepareDebugTarget['current'];
  cycle(delta: number): void;
  confirm(): void;
  pick(id: string): void;
}

/**
 * 选角色屏的调试入口。
 *
 * ⚠️ `state()` 的形状与备战界面**同一个**（`PrepareDebugTarget['current']`）：
 * 两个界面用的是同一套光标模型，调试脚本因此可以复用同一段读状态的代码。
 * 选角色屏的 `bossId` 恒为空串（没有对手槽位，见 `characterSelectLogic`）。
 */
export function characterSelectDebugApi(select: CharacterSelectDebugTarget): {
  readonly characterSelect: {
    state(): PrepareDebugTarget['current'];
    cycle(delta: number): void;
    confirm(): void;
    pick(id: string): void;
  };
} {
  const copy = (): PrepareDebugTarget['current'] => ({
    playerId: select.current.playerId,
    bossId: select.current.bossId,
    focus: select.current.focus,
    /** 选角色屏只有人物一行（见 `characterSelectLogic`），展开块恒为它。 */
    expanded: select.current.expanded,
    cursor: { ...select.current.cursor },
  });
  return {
    characterSelect: {
      /** 当前已确定的角色 + 光标（两者分离时能一眼看出差别）。 */
      state: copy,
      /** 同 ← →：**只移动光标**，不改已确定的角色。 */
      cycle: (delta) => select.cycle(delta),
      /** 同 Enter：确定光标处的角色；能开始就开始一局（会真的进战斗）。 */
      confirm: () => select.confirm(),
      /** 同点击卡片：移光标 + 确定 + 开始（一步到位）。 */
      pick: (id) => select.pick(id),
    },
  };
}

/** 设置面板暴露给调试的最小面（`SettingsPanel` 满足它）。 */
export interface SettingsDebugTarget {
  readonly capturingSkillId: string | undefined;
  readonly focusState: { readonly zone: string; readonly index?: number };
  readonly settingsTrace: readonly string[];
  hitTest(px: number, py: number): boolean;
  /**
   * 第 `index` 个**技能格**的圆心（逻辑坐标）—— 验证脚本注入真实点击用。
   *
   * ⚠️ 脚本**不许自己复制一份 `keyCellRect`**：布局一调，脚本会静默失效
   * （"点空了"看起来和"功能坏了"一模一样）。与 `touchButtonCenter`
   * 同一个理由。
   */
  /** ⚠️ 探针整块在 `settings.probes`（面板不再逐个转发）。 */
  readonly probes: {
    cellCenter(index: number): { readonly x: number; readonly y: number };
    slotCenter(index: number): { readonly x: number; readonly y: number } | undefined;
    /** **触屏技能面**第 `index` 格（窗口内下标）的圆心。 */
    pickerCellCenter(index: number): { readonly x: number; readonly y: number } | undefined;
    detailScroll(): {
      readonly offset: number;
      readonly total: number;
      readonly rows: number;
      readonly lines: readonly number[];
    };
    /** 面板当前用的缩放系数（`settingsScale` 钳位之后的）。 */
    panelScale(): { readonly uiScale: number; readonly panelScale: number };
    /** 面板里的**可见文字**（字号 / 坐标 / 前 24 字）。 */
    panelText(): readonly PanelTextMetric[];
    /** 面板外框 + 详情区的矩形（"没溢出画布"的判据）。 */
    panelLayout(): {
      readonly panel: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      readonly detail: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      readonly gridBottom: number;
      readonly hintTop: number;
    };
  };
}

/**
 * 设置**齿轮**暴露给调试的最小面（`ScreenChrome` 满足它）。
 *
 * ⚠️ 它不再叫 `SettingsButtonDebugTarget`：齿轮从"一个共享的
 * `SettingsButton`"变成**四个界面各自持有的 `ScreenChrome`**（用户
 * 2026-10-12："多个页面的齿轮，应该分别定义"）。调试入口拿的是**当前这一屏**
 * 的那一个（`game.ts` 的 `getChrome()`），所以取值函数可能返回 `undefined`
 * （装配期那一瞬）—— 那时这几个入口是无害的空操作。
 */
export interface SettingsGearDebugTarget {
  /** 只点亮**这一屏**的齿轮（`↑` / `↓` 那条路的状态）。 */
  setFocused(focused: boolean): void;
  /** 齿轮此刻是否持有键盘焦点。 */
  readonly focused: boolean;
  /** 重绘一次（headless 下可能没有下一帧，探针要立刻看到状态）。 */
  update(): void;
}

/**
 * 设置界面的调试入口。
 *
 * 存在的理由（原先写在 `main.ts` 里，随代码一起搬过来）：
 * headless 环境下模拟鼠标点击不可靠（rAF 会被降频，而且 CSS 缩放 →
 * 逻辑坐标的换算依赖真实布局），这个入口让验证脚本能直接把界面推到
 * 某个状态再截图。
 *
 * ⚠️ 两个参数都是**取值函数**而不是对象：设置面板与它的开关在
 * `main.ts` 里构造得比 `window.__raidBattle` 更晚（那里是装配顺序：
 * 面板要用到触屏层的能力值）。直接传引用会撞 TDZ；传取值函数则
 * "用的时候才去拿"，与 `restart` / `touchButtonCenter` 那几条
 * 延后转调是同一个处理方式。
 */
export function settingsDebugApi(
  getSettings: () => SettingsDebugTarget,
  getToggle: () => {
    readonly open: (tab: SettingsTab) => void;
    readonly close: () => void;
    readonly isOpen: () => boolean;
  },
  getGear: () => SettingsGearDebugTarget | undefined,
): {
  readonly settings: {
    open(tab?: SettingsTab): void;
    close(): void;
    openIn(px: number, py: number): void;
    isOpen(): boolean;
    capturing(): string | undefined;
    focus(): { readonly zone: string; readonly index?: number };
    /** 第 `index` 个技能格的圆心（验证脚本注入真实点击用）。 */
    cellCenter(index: number): { readonly x: number; readonly y: number };
    /** 右下角第 `index` 个键位的圆心（越界为 `null`）。 */
    slotCenter(index: number): { readonly x: number; readonly y: number } | null;
    /**
     * **触屏技能面**第 `index` 格（**窗口内**下标）的圆心（越界为 `null`）。
     *
     * ⚠️ 它与 `cellCenter` 是**两个面**：触屏那套自己的技能面
     * （`TouchSkillPicker`）不再借键盘格阵。
     */
    pickerCellCenter(index: number): { readonly x: number; readonly y: number } | null;
    /**
     * 技能详情区的滚动状态（`offset` 变了 = 真的滚了）。
     *
     * `lines` = 名字 / 说明折了几行 / 代价 —— 用来验证"说明**换行**了"
     * （而不是截断），见 `SkillDetail.scrollState`。
     */
    detailScroll(): {
      readonly offset: number;
      readonly total: number;
      readonly rows: number;
      readonly lines: readonly number[];
    };
    trace(): readonly string[];
    /**
     * 把**当前这一屏的齿轮**的键盘焦点打开/关掉，并立刻重绘一次。
     *
     * 为什么需要：`↑`（或悬停）是被逐帧循环重绘的，而 headless 下
     * 这局战斗 3.5 秒就结束了 —— 之后没有帧，任何"聚焦后的外观"都拍不到。
     * 这个入口让验证脚本能把按钮推到聚焦态并**在同一个 tick 里**画出来。
     *
     * ⚠️ 它改的就是齿轮自己的状态（同 `↑` 那条路），不是另画一个样子。
     * ⚠️ 齿轮有**四个**（每屏一个），所以这里问的是"当前那一屏"的
     * 那一个（`game.ts` 的 `getChrome()`）；没有对应的齿轮时是无害空操作。
     */
    setButtonFocused(focused: boolean): void;
    /** 当前这一屏的齿轮此刻是否持有键盘焦点。 */
    buttonFocused(): boolean;
    /**
     * **面板的缩放状态**（`uiScale` = 滑块那个值，`panelScale` = 面板实际
     * 用的系数）。
     *
     * ⚠️ 两个数**不是**同一个：竖向预算把面板钳在 `PANEL_SCALE_MAX`
     * （见 `ui/settings/settingsScale.ts` 文件头）。验证脚本要断言的是
     * **两个**——只报一个就没法区分"滑块没生效"与"钳位生效了"。
     */
    panelScale(): { readonly uiScale: number; readonly panelScale: number };
    /** 面板里的可见文字（字号 / 坐标）——"字变大了没有"的硬证据。 */
    panelText(): readonly PanelTextMetric[];
    /** 面板外框 + 详情区矩形（"外框没动、没溢出画布"的判据）。 */
    panelLayout(): {
      readonly panel: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      readonly detail: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
      readonly gridBottom: number;
      readonly hintTop: number;
    };
  };
} {
  return {
    settings: {
      open: (tab = 'keys') => getToggle().open(tab),
      close: () => getToggle().close(),
      openIn: (px, py) => getSettings().hitTest(px, py),
      isOpen: () => getToggle().isOpen(),
      /** 正在等待按键改键的技能 id（没有则为 null）。 */
      capturing: () => getSettings().capturingSkillId,
      /** 当前键盘焦点（调试用）。 */
      focus: () => ({ ...getSettings().focusState }),
      /** 第 `index` 个技能格的圆心（真实点击的注入坐标）。 */
      cellCenter: (index) => ({ ...getSettings().probes.cellCenter(index) }),
      /** 第 `index` 个键位的圆心（没有则 null）。 */
      slotCenter: (index) => getSettings().probes.slotCenter(index) ?? null,
      pickerCellCenter: (index) => {
        const c = getSettings().probes.pickerCellCenter(index);
        return c === undefined ? null : { ...c };
      },
      detailScroll: () => ({ ...getSettings().probes.detailScroll() }),
      panelScale: () => ({ ...getSettings().probes.panelScale() }),
      panelText: () => toPlainText(getSettings().probes.panelText()),
      panelLayout: () => {
        const l = getSettings().probes.panelLayout();
        return {
          panel: { ...l.panel },
          detail: { ...l.detail },
          gridBottom: l.gridBottom,
          hintTop: l.hintTop,
        };
      },
      trace: () => [...getSettings().settingsTrace],
      setButtonFocused: (focused) => {
        const gear = getGear();
        if (gear === undefined) return;
        gear.setFocused(focused);
        /** 立即重绘（正常路径由主循环每帧调，headless 下可能没有下一帧）。 */
        gear.update();
      },
      buttonFocused: () => getGear()?.focused ?? false,
    },
  };
}

/**
 * **P3 的两屏**（选炁机 / 一局结束）的调试入口。
 *
 * ==================================================================
 * 为什么需要它（"截图证明不了"的那两件事）
 * ==================================================================
 *
 * `?runlen=2` 的验收要能回答：
 *   1. **选炁机屏现在有几个候选、光标在哪** —— 截图只能看出"画了几张卡"，
 *      而"候选集合对不对"（解锁了哪些、叠满了没有）只有状态能证明。
 *      尤其是那条**反面**验收（"没到 3 次时它【不】出现"）：
 *      截图上"少一张卡"与"画漏了一张"完全一样。
 *   2. **一局结束屏的摘要是哪一局** —— 通关 / 失败两种文案长得像，
 *      而"打到第几场、带了哪些炁机"必须能从状态读出来。
 *
 * ⚠️ 一律**转调界面自己的方法**（`confirm` / `cycle` / `pick`），不另写一套：
 * 旁路会让"验证的是探针而不是界面"（见 `debugApi.ts` 文件头）。
 * ⚠️ `state()` 返回**拷贝**：调用方拿到共享引用就可能把界面改坏。
 */
export interface QijiDebugTarget {
  readonly current: {
    readonly cursor: number;
    readonly candidates: readonly string[];
  };
  cycle(delta: number): void;
  moveFocus(delta: number, wrap?: boolean): void;
  confirm(): void;
}

/** 一局结束屏暴露给调试的最小面。 */
export interface RunOverDebugTarget {
  readonly visible: boolean;
}

export function qijiDebugApi(
  qijiSelect: QijiDebugTarget,
  runOver: RunOverDebugTarget,
): {
  readonly qiji: {
    /** 候选的**炁机 id 列表**（顺序 = 画出来的顺序）。 */
    candidates(): readonly string[];
    /** 光标下标。 */
    cursor(): number;
    /** 同 ← →：移光标（不改任何选择）。 */
    cycle(delta: number): void;
    /** 同 ↑ ↓ / Tab：换行（`wrap` 为真时环绕）。 */
    moveFocus(delta: number, wrap?: boolean): void;
    /** 同 Enter：选光标处那一个（**会真的生效并离开这一屏**）。 */
    confirm(): void;
    /** 一局结束屏此刻是否可见（验收"打到第几场之后停了"）。 */
    overviewOpen(): boolean;
  };
} {
  return {
    qiji: {
      candidates: () => [...qijiSelect.current.candidates],
      cursor: () => qijiSelect.current.cursor,
      cycle: (delta) => qijiSelect.cycle(delta),
      moveFocus: (delta, wrap = false) => qijiSelect.moveFocus(delta, wrap),
      confirm: () => qijiSelect.confirm(),
      overviewOpen: () => runOver.visible,
    },
  };
}
