/**
 * **一个整屏界面自己的"边角控件"**：齿轮（打开设置）＋ 可选返回箭头。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3：组件归**它所在的界面**所有）
 * ==================================================================
 *
 * 用户 2026-10-12 一次说清了三件事，而它们是**同一件事**：
 *
 *   1. "**stage 上理论上不挂任何小组件**"
 *   2. "**多个页面的齿轮，应该分别定义**"
 *   3. "**UI 缩放要带上**"
 *
 * 原先只有一个横屏通用的齿轮 + 一个通用的返回箭头，**挂在 stage 上**，
 * 靠 `SettingsButton.setScreen(...)` 挪锚点去适配所有页 ✗。后果实测到了：
 *
 *   - 它们不随任何界面走 —— 显隐只能靠 `applyPhase` 记得改，谁漏一次
 *     就露在别的屏上
 *   - "挪位置"这条路在部分路径上**没生效**：实测齿轮在"选角色屏 / 战斗屏"
 *     渲染在 `ANCHOR_BATTLE` 的位置 ✗（`setScreen('prepare')` 那条路径在
 *     那些相位输给了装配期的补摆位）。**这正是"共享一个"的 bug 形状**：
 *     一个组件要同时服务四种界面，就只能靠外部不断修正它。
 *   - `setUiScale` 只作用于 `BattleScene` 的各 HUD 区域，挂在 stage 上的
 *     按钮**完全不受缩放影响**（实测三张不同缩放的截图 md5 相同）
 *
 * 现在反过来：**每个全屏界面各造一个 `ScreenChrome`**，把它 `addChild` 到
 * 自己的 root 上。于是"显示什么、显示在哪"由那个界面自己说了算，而
 * **缩放**是它的第三条：系数变化时它自己重排。
 *
 * ⚠️ 这与 `SkillBarView` / `hud/bossHeader` 的既有范式同形：每个区域自己
 * 实现 `setUiScale(scale)`，`BattleScene` 只转发。**不要**回到"场景里逐个
 * 手调挂在别处的东西的缩放"—— 那正是 §3 点名的那类错位职责。
 *
 * ==================================================================
 * ⚠️ 缩放为什么是"按新系数重建"而不是"给容器乘一个系数"
 * ==================================================================
 *
 * `IconButton` 把布局**烤进了子对象的绝对坐标**（`icon.root.x = box.iconX`
 * 之类），构造之后改不了。两种解法：
 *
 *   1. 外面套一层容器、给它 `scale` + `position`（旧 `SettingsButton` 的
 *      做法）✗ —— 那要求按钮内部坐标从 `(0,0)` 开始，得给 `IconButton` 加一个
 *      "局部坐标"模式；而且平移量要为四条边各写一遍
 *   2. **系数变了就按新系数重建**（这里）✓ —— 与 `SkillBarView.setUiScale`
 *      同一条路（它也是清空重排），而且只在玩家拖滑块时发生、不在热路径
 *
 * 落位规则只有一条：**按当前系数算出按钮盒的左上角**，把按钮整体移到那里。
 * `IconButton` 内部的算术原地不动。
 *
 * ⚠️ 于是"画在哪"与"点在哪个区域"仍然是**同一段算术**（`hitTest` 直接拿
 * 屏幕坐标去问按钮的 `contains`）—— 旧 `SettingsButton` 那种"套一层容器 +
 * 命中测试里手工减偏移"的配对难点不存在。
 *
 * ==================================================================
 * 触屏对等（AGENTS.md §3b）
 * ==================================================================
 *
 * 齿轮是触屏玩家**唯一**的进设置入口（他们没有 `F1`）。所以本组件的
 * `hitTest` 是每个界面必须转发的那一条；键位提示则按
 * `showKeyHints()`（唯一 flag 的派生）随时隐藏 —— 触屏上画 `F1` / `Esc`
 * 只会误导。
 */

import type { Container } from 'pixi.js';
import { IconButton } from './IconButton';
import { HINT_GAP, iconHintBoxSize, type HintSide } from './iconHint';
import { PALETTE } from '../render/theme';
import { LOGICAL } from './layout';
import { KEY_EDIT_KEYS } from './settings/keyNames';
import type { PixiCtor } from './primitives';

/** 安全区边距：与 `LAYOUT` 的 8px 边距同一个语言（状态栏 / 日志 / 技能栏都贴它）。 */
const MARGIN = 8;

/**
 * 返回箭头取 22、齿轮取 20。
 *
 * ⚠️ 箭头笔画少，同尺寸看起来更小，所以大 2px（旧 `ScreenControls` 的
 * 同一条理由）。
 */
const ARROW_SIZE = 22;
const GEAR_SIZE = 20;

/**
 * 提示文字：`Esc`（返回）。
 *
 * ⚠️ 用全仓**那一份**键名显示映射，不许自己拼：旧版拼出 `Escape`，而设置页
 * 那句"方向键选择，Enter 改键，**Esc** 返回"写的是 `Esc` —— 同一个键两个
 * 写法，看起来就是"返回按钮没跟设置同步"（用户 2026-10-12 报的）。
 * 键名属于**键位表**而不是文案（AGENTS.md §3b：键名不进 i18n）。
 */
const ESC_SHORTCUT = KEY_EDIT_KEYS.cancel.label;

/** 一个按钮的**图标**落位（左上角 + 边长），全部是**缩放后**的逻辑像素。 */
export interface ChromeBox {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/**
 * **图标的左上角** —— 边角控件的落位规则，纯函数（可单测）。
 *
 * 两条边角共用它，靠 `inset` 表示"贴哪一条边"：
 *
 * | `inset.right` | `inset.bottom` | 位置 |
 * |---|---|---|
 * | `false` | `false` | 左上（返回箭头） |
 * | `true`  | `false` | 右上（全屏界面的齿轮） |
 *
 * ⚠️ 边距（`MARGIN`）与按钮尺寸（`size`）**都乘系数**：贴边的元素要
 * "从自己那条边长出来"，只乘一半会让它随缩放离开安全区（见
 * `uiLayout.ts` 文件头那条设计前提）。
 */
export function chromeBoxAt(
  inset: { readonly right: boolean; readonly bottom: boolean },
  size: number,
  scale: number,
): ChromeBox {
  const margin = Math.round(MARGIN * scale);
  const scaled = Math.max(1, Math.round(size * scale));
  return {
    x: inset.right ? LOGICAL.width - margin - scaled : margin,
    y: inset.bottom ? LOGICAL.height - margin - scaled : margin,
    size: scaled,
  };
}

/**
 * **战斗界面的齿轮落点**：画布**左下角安全区**（左下角为锚点）。
 *
 * ==================================================================
 * ⚠️ 2026-10-12：从"日志下方"改成"画布左下角"—— 因为旧规则**必然越界**
 * ==================================================================
 *
 * 旧版是"日志下方、与日志左对齐"：
 *
 * ```ts
 * x = round(LAYOUT.log.x * scale) + gap
 * y = round((LAYOUT.log.y + LAYOUT.log.h) * scale) + gap   // ← 这里
 * ```
 *
 * 日志矩形**自己也乘了系数**（`UiLayout.logPanel` 是 `top-left` 锚点，
 * `y 70..270` 随系数往下长），于是齿轮的 `y` 按 `(70 + 200) × scale` 走：
 *
 * | scale | 旧 y（= 270·scale + 8·scale） | 齿轮下缘 | 在 540 内？ |
 * |---|---|---|---|
 * | 0.5 | 139 | 149 | ✅ |
 * | 1   | 278 | 298 | ✅ |
 * | 1.4 | 389 | 417 | ✅ |
 * | 1.5 | 417 | 447 | ✅ |
 * | 2.0 | **556** | 596 | ✗ **出画布** |
 *
 * 用户实测报的正是这条（"放大时会溢出画布"）。根因不是"少夹了一下"，
 * 而是**锚点选错了**：把一个贴边的控件锚在一个"会跟着缩放长出去"的
 * 矩形上，越界是迟早的（画布高度是常量 540，而 `270 × scale` 无上界）。
 *
 * ==================================================================
 * 现在的规则：**从自己那条边反推**（贴边控件的老规矩）
 * ==================================================================
 *
 * ```ts
 * 图标左下角 = (MARGIN × scale, 画布高 − MARGIN × scale)
 * ```
 *
 * 与 `chromeBoxAt` 同一条纪律（"贴边的元素要从自己那条边长出来"）：
 * 边距与尺寸都乘系数，而**位置由画布边缘反推**。
 *
 * ⚠️ **为什么它自己就保证不越界**（不是算完再夹）：
 *   - 下缘 = `画布高 − MARGIN×scale` ≤ 画布高 − 8 ✓（对任何 scale ≥ 1）
 *   - 提示与图标**同一行**（`iconHintPlacement` 一条规则），它的高度是
 *     `max(图标, 字号)` —— 而字号 ≤ 图标（`BASE_HINT_FONT=13 < 20`），
 *     所以整块高度 = 图标高，下缘就是这个下缘 ✓
 *   - 右缘 = `MARGIN×scale + 图标 + gap + 提示`，2 倍时才 ~118px ≪ 960 ✓
 *
 * ⚠️ **一条规则**：没有"先算再夹"的第二套逻辑，也没有"看它在画布哪一半"
 * 的分支。四个边角控件都从**自己那条边**反推，战斗齿轮只是选了左下角。
 *
 * ⚠️ 为什么是**左下**而不是别的角：画布左下角那条竖带是空的（玩家面板从
 * `y 452` 开始，而齿轮整块贴的是 `画布高 − 边距`）。右上角被 Boss 血条
 * （贴顶、通栏）与 debuff 行占着。
 *
 * ⚠️ 提示在**右侧**（`'right'`）：齿轮贴的是画布左缘，右边有的是地方 ——
 * 与整屏界面右上角那个齿轮**镜像**（那边贴右缘，所以提示配 `'left'`）。
 */
export function battleGearBoxAt(scale: number): ChromeBox {
  const size = Math.max(1, Math.round(GEAR_SIZE * scale));
  return {
    /** 贴左下角：左缘从安全区起、下缘从画布底反推。 */
    x: Math.round(MARGIN * scale),
    y: LOGICAL.height - Math.round(MARGIN * scale) - size,
    size,
  };
}

/**
 * **"图标 + 并排的键位提示"整块**摆到画布的某条边上 —— 纯函数。
 *
 * ==================================================================
 * 为什么落位要按**整块**算，而不是只看图标
 * ==================================================================
 *
 * 提示与图标并排（`⚙ F1`），所以"图标贴到右缘"会让提示伸出画布 ——
 * 而用户明确否掉了"越界再夹一下"（"别再加第二套避让逻辑"）。规则本身要
 * 保证不越界，唯一的办法是：**先把整块摆进去，再说图标落在哪**。
 *
 * ⚠️ 提示在**哪一侧**由调用方给（`hintSide`）：
 *   - `'left'`（提示在图标左边）→ 整块向右长，所以 `inset.right` 时贴的是
 *     **整块的右缘**（提示那一头才是靠边的），图标在它左边
 *   - `'right'` → 整块向左长，贴的是**图标的右/左缘**
 *
 * 三个调用点各自显式选一侧，公式只有这一条 —— 没有"按画布哪一半猜"。
 *
 * ⚠️ 估宽由 `ui/iconHint.ts` 的 `iconWithHintSize` 给（`estimateMonoWidth`，
 * 宁宽勿窄）—— 那是提示几何的**唯一来源**，不在这里重估一遍。
 */
export function chromeBlockBoxAt(
  shortcut: string,
  iconSize: number,
  hintSide: HintSide,
  inset: { readonly right: boolean; readonly bottom: boolean },
  scale: number,
): ChromeBox {
  const margin = Math.round(MARGIN * scale);
  const scaled = Math.max(1, Math.round(iconSize * scale));
  const hint = iconHintBoxSize(shortcut, scaled);
  /**
   * 图标那一头贴边：提示在左时，**靠着右缘的是提示**，所以图标要再往左
   * 让出"提示宽 + 间隙"；提示在右时图标自己就是那一头。
   */
  const edgePad = hintSide === 'left' ? hint.w + HINT_GAP : 0;
  return {
    x: inset.right ? LOGICAL.width - margin - edgePad - scaled : margin,
    y: inset.bottom ? LOGICAL.height - margin - scaled : margin,
    size: scaled,
  };
}

export interface ScreenChromeOptions {
  readonly pixi: PixiCtor;
  /** 点齿轮（打开设置）—— 全屏界面统一接到 `settingsToggle.toggle()`。 */
  readonly onGear: () => void;
  /**
   * 点返回箭头。**不给就不画箭头**（首页 / 战斗没有"返回"这个动作）。
   *
   * ⚠️ 它是"这一屏有没有返回"的唯一判据 —— 与
   * `phaseLogic.CONTROL_VISIBILITY.back` 同源：首页是返回的目标本身、
   * 战斗中没有返回语义，两处都不该出现箭头。
   */
  readonly onBack?: (() => void) | undefined;
  /**
   * 齿轮的落位（默认右上角）。战斗界面传 `battleGearBoxAt`。
   *
   * ⚠️ 传的是**取值函数**而不是常量：它随 UI 缩放变，而缩放是运行期的事。
   */
  readonly gearAt?: (scale: number) => ChromeBox;
  /**
   * `F1` 的显示名（齿轮的键位提示）。
   *
   * ⚠️ 由调用方从 i18n 的键位标签 + 键位表**反查**后拼出来，本组件不碰
   * i18n（键名不进文案表，AGENTS.md §3b）。
   */
  readonly f1Label: () => string;
  /** 要不要显示键位提示（唯一 flag 的派生；触屏为假）。 */
  readonly showKeyHints: () => boolean;
}

/**
 * 边角控件。
 *
 * ⚠️ 生命周期与**界面**绑定，不与某一帧绑定：`setUiScale` 会重建里面的
 * 两个按钮，而 `root` 这个容器本身**始终不变** —— 所以界面 `addChild`
 * 一次就够。
 */
export class ScreenChrome {
  /** 本界面 root 的挂载点（`(0,0)`，逻辑坐标与界面一致）。 */
  readonly root: Container;

  private readonly pixi: PixiCtor;
  private readonly options: ScreenChromeOptions;
  private readonly gearAt: (scale: number) => ChromeBox;

  /** 当前系数（默认 1）—— 决定所有按钮的尺寸与落位。 */
  private uiScale = 1;
  /** 菜单面板打开时**只藏齿轮**（返回箭头照旧，见 `setGearVisible`）。 */
  private gearHidden = false;
  private gearFocused = false;

  private gear: IconButton | undefined;
  private back: IconButton | undefined;

  constructor(options: ScreenChromeOptions) {
    this.options = options;
    this.pixi = options.pixi;
    this.gearAt =
      options.gearAt ?? ((scale) => chromeBoxAt({ right: true, bottom: false }, GEAR_SIZE, scale));
    this.root = new this.pixi.Container();
    this.root.visible = false;
    this.build();
  }

  /**
   * 显示 / 隐藏整个边角控件。
   *
   * ⚠️ 正常情况下**它是界面 root 的子节点**：界面的 `setVisible` 会自动
   * 带上它，这个方法只是给"界面之外还想单独控制"的路径留一个口子
   * （调试里只拍 chrome、或者应用某一屏时统一重设）。界面自己**不要**
   * 去调它 —— 那会造出第二份显隐真相。
   */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /**
   * 显示 / 隐藏**齿轮**（不影响返回箭头、也不影响整个 chrome）。
   *
   * 用途：设置面板打开时把齿轮藏起来 —— 旧版齿轮在面板打开后仍然可见，
   * 从面板边缘露出来，既重叠又让人以为还能点（面板的命中测试虽然会拦下
   * 点击，但那只是"不可点"，不是"看起来不可点"）。
   */
  setGearVisible(visible: boolean): void {
    this.gearHidden = !visible;
    if (this.gear !== undefined) this.gear.root.visible = visible;
  }

  /**
   * 齿轮此刻是否可见（被面板藏起来时为假；探针读它）。
   *
   * ⚠️ 名字与 `setGearVisible` **不成对**（故意不叫 `gearVisible`）：那个
   * 名字会让本对象在结构上"看起来"满足 `{ gearVisible(v: boolean): void }`
   * 而实际是个布尔 —— 类型系统会拦下，但读代码的人先被绕一下。
   */
  get gearShown(): boolean {
    return this.gear !== undefined && !this.gearHidden;
  }

  /** 键盘焦点（`↑` 提上去 / `↓` 退下来）。 */
  setFocused(focused: boolean): void {
    this.gearFocused = focused;
    this.gear?.setFocused(focused);
  }

  get focused(): boolean {
    return this.gearFocused;
  }

  /**
   * 设定 UI 缩放：**按新系数重建**边角控件（理由见文件头）。
   *
   * 幂等：系数没变就直接返回（拖滑块时每格都会调一次）。
   */
  setUiScale(scale: number): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    this.build();
  }

  /** 当前系数（探针用）。 */
  get scale(): number {
    return this.uiScale;
  }

  /**
   * 点一下（逻辑坐标）。
   *
   * @returns 是否命中（命中即已经触发齿轮 / 返回）
   *
   * ⚠️ **齿轮先于返回**：两者分处右上 / 左上，正常不会重叠；顺序固定下来
   * 就不必去推"万一重叠该谁赢"（`canvasInput` 的"顺序即优先级"同一条纪律）。
   */
  hitTest(px: number, py: number): boolean {
    if (this.hitsGear(px, py)) {
      this.options.onGear();
      return true;
    }
    if (this.back !== undefined && this.back.contains(px, py)) {
      this.options.onBack?.();
      return true;
    }
    return false;
  }

  /** 齿轮的可点区域（探针 / 触屏层用它决定"点设置"的落点）。 */
  get gearBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.gear?.bounds;
  }

  /** 返回箭头的可点区域（探针用）。 */
  get backBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.back?.bounds;
  }

  /** 返回箭头的**中心**（截图脚本注入真实点击用）。 */
  get backCenter(): { readonly x: number; readonly y: number } | undefined {
    const b = this.back?.bounds;
    return b === undefined ? undefined : { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }

  /**
   * `Esc` 提示的包围盒（**画布坐标**；触屏隐藏时也仍然算得出来）。
   *
   * ⚠️ 提示的落位全在 `IconButton.iconHintPlacement` 里推出来（一条全局
   * 规则），"贴在图标左上角、且没伸出画布"这条结论需要一个**读得到**的数
   * （见 `__raidBattle.back.shortcutBounds`）。
   *
   * ⚠️ 必须加 `root.x/y`：`IconButton.hintBounds` 是**相对它自己 `root`**
   * 的坐标（落位函数只拿到"盒内"的图标矩形），而按钮整体被摆到了画布上的
   * 某个点 —— 不加就会报出一个假位置（实测：`{x:0,y:0}`，而画面上是
   * `(8,8)`）。`bounds`（可点区域）本来就是绝对坐标，两者在这里对齐。
   */
  get backShortcutBounds():
    | { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
    | undefined {
    return boundsOf(this.back);
  }

  /**
   * **齿轮**的键位提示（`F1`）包围盒（画布坐标）。
   *
   * ⚠️ 与 `backShortcutBounds` 同一个 `boundsOf` —— 上一轮只有返回箭头有
   * 这个读数，于是"齿轮的提示有没有伸出画布"**没有可读的证据**，只能靠
   * 肉眼看截图（而画布下缘和背景一样黑，"被裁掉"和"画在那"分不出来）。
   * 本轮"任何缩放下都不出画布"这条硬要求需要一个数来对账：截图脚本读它。
   */
  get gearShortcutBounds():
    | { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
    | undefined {
    return boundsOf(this.gear);
  }

  /**
   * 每帧：把**触屏能力**同步到两个按钮的键位提示上。
   *
   * ⚠️ 每帧重设 `setShowShortcut`，而不是只在装配期设一次、切换时再挨个
   * 通知：显隐是唯一 flag 的派生（玩家随时能在「通用」页切键盘 / 触屏），
   * 每帧读一次就不需要"切换时通知所有界面的所有齿轮"那张订阅表。
   * `IconButton` 内部只在值真的变了才动节点（见 `setShowShortcut`）。
   */
  update(): void {
    const show = this.options.showKeyHints();
    this.gear?.setShowShortcut(show);
    this.back?.setShowShortcut(show);
    /**
     * ⚠️ `update()` 也要转发：焦点环与图标颜色的切换收在那里面
     * （`IconButton.update` 只在 `lit` / 环的可见性真的变了才动节点）。
     */
    this.gear?.update();
    this.back?.update();
  }

  /* ------------------------------------------------------------------ *
   * 内部
   * ------------------------------------------------------------------ */

  private hitsGear(px: number, py: number): boolean {
    /** 齿轮被藏起来时不吃点击（设置面板打开的那段时间）。 */
    if (this.gearHidden || this.gear === undefined) return false;
    return this.gear.contains(px, py);
  }

  /** 按当前系数重建两个按钮（旧节点整棵销毁，避免缩放后两层重叠）。 */
  private build(): void {
    this.gear?.root.destroy({ children: true });
    this.back?.root.destroy({ children: true });
    this.gear = undefined;
    this.back = undefined;

    const f1 = this.options.f1Label();
    /**
     * ⚠️ 齿轮的提示在**左边**（齿轮贴的是画布右缘，提示放右边会顶出去）。
     * 这是**这一屏这个按钮的配置**，与战斗齿轮（贴左缘 → 提示在右）镜像。
     */
    const GEAR_HINT_SIDE: HintSide = 'left';
    /**
     * ⚠️ 默认落位（`chromeBoxAt`）**必须换成"按整块算"**：并排之后提示占宽度，
     * 只按图标反推会让提示顶出画布（提示在左时尤其明显）。
     *
     * `gearAt` 仍是可注入的（战斗界面传自己的落位函数），所以这里只换
     * **默认值** —— 注入的那份由它自己保证（见 `battleGearBoxAt` 的说明）。
     */
    const gearBox = this.options.gearAt === undefined
      ? chromeBlockBoxAt(f1, GEAR_SIZE, GEAR_HINT_SIDE, { right: true, bottom: false }, this.uiScale)
      : this.gearAt(this.uiScale);
    const gear = new IconButton({
      pixi: this.pixi,
      icon: 'gear',
      size: gearBox.size,
      color: PALETTE.textDim,
      /**
       * ⚠️ `brightColor` 不是金色：金色在本作里是"**选中**"的语言
       * （备战界面已确定的卡片）。齿轮被键盘聚焦是"**光标在这儿**"，
       * 两者不该同色（需求："设置按钮 有时也会被变黄"）。取
       * `PALETTE.focus`（冷白偏蓝），全项目"光标 / 焦点"只有这一种颜色。
       */
      brightColor: PALETTE.focus,
      /**
       * 焦点环：只描边、不填色。给"聚焦"一个**不依赖颜色**的线索，
       * 与悬停区分开（悬停是"我正在指过去"，聚焦是"按 Enter 会作用在它
       * 身上"）。填色版本会在战斗界面把齿轮画成一个方块。
       */
      focusRing: true,
      shortcut: f1,
      hintSide: GEAR_HINT_SIDE,
      /**
       * 锚点只用于**取尺寸**：真正的落位由 `place` 把内容盒钉到 `box`
       * （见 `place` 的说明）。x 取内容盒中心 —— 提示在左时图标会被推到
       * 盒内右侧，而"贴哪条边"是 `chromeBlockBoxAt` 算的，不是锚点算的。
       */
      anchor: { x: gearBox.x + gearBox.size / 2, y: gearBox.y + gearBox.size / 2 },
      onClick: () => this.options.onGear(),
    });
    /**
     * ⚠️ 战斗界面注入的 `gearAt` 给的是**图标**左上角（它与提示的关系由
     * `battleGearBoxAt` 自己保证）；默认落位给的是**整块**左上角。
     * 所以这里按落位函数是谁来选翻译方式 —— 不是两套绘制，是同一个 `place`
     * 的两种输入（见 `BLOCK_INSET` 的说明）。
     */
    this.gear = place(gear, gearBox, this.options.gearAt === undefined ? 'block' : 'icon', GEAR_HINT_SIDE);

    /**
     * 返回箭头：**只有给了 `onBack` 才画**（首页 / 战斗没有返回动作）。
     *
     * ⚠️ 它和齿轮**同一个组件、同一套视觉语言、同一个落位公式**
     * （`chromeBlockBoxAt`：按整块贴边），只是贴的是**另一条边**（左上）
     * —— 两条边角一条规则，没有"看在哪一半"的分支。
     */
    if (this.options.onBack !== undefined) {
      /**
       * ⚠️ 返回箭头的提示在**右边**（箭头贴的是画布左缘，提示放左边会顶出去）
       * —— 与齿轮**镜像**，这正是"并排摆法 + 每个按钮选一侧"的落点。
       */
      const BACK_HINT_SIDE: HintSide = 'right';
      const box = chromeBlockBoxAt(
        ESC_SHORTCUT,
        ARROW_SIZE,
        BACK_HINT_SIDE,
        { right: false, bottom: false },
        this.uiScale,
      );
      const arrow = new IconButton({
        pixi: this.pixi,
        icon: 'arrow-left',
        size: box.size,
        color: PALETTE.textDim,
        brightColor: PALETTE.focus,
        /** 返回不参与键盘焦点（`F1` 那条流程只管齿轮），所以不画永远不会亮的环。 */
        shortcut: ESC_SHORTCUT,
        hintSide: BACK_HINT_SIDE,
        anchor: { x: box.x + box.size / 2, y: box.y + box.size / 2 },
        onClick: () => this.options.onBack?.(),
      });
      this.back = place(arrow, box, 'block', BACK_HINT_SIDE);
    }

    const nodes: Container[] = [];
    if (this.gear !== undefined) nodes.push(this.gear.root);
    if (this.back !== undefined) nodes.push(this.back.root);
    this.root.addChild(...nodes);
    /**
     * 重建之后把"面板打开时藏齿轮""键盘焦点"这两个状态装回去。
     *
     * ⚠️ 用 `setVisible` 而不是 `setGearVisible`：后者的真值是
     * `gearHidden || !root.visible`，会把整个 chrome 打开 —— 而 chrome 的
     * 显隐归**它所在的那个界面**（`setVisible` 由界面/`applyPhase` 写）。
     */
    this.setVisible(this.gearShown);
    this.gear?.setFocused(this.gearFocused);
  }
}

/**
 * 把按钮钉到 `box` —— **`box` 说的是"哪条边贴住安全区"，不是"图标在哪"**。
 *
 * ==================================================================
 * 两种输入（同一条规则的两半，不是两套算法）
 * ==================================================================
 *
 * | `kind` | `box` 描述 | 谁给 |
 * |---|---|---|
 * | `'block'` | **整块**（图标 + 并排提示）的左上角 | `chromeBlockBoxAt` |
 * | `'icon'`  | **图标**的左上角（提示的方向由按钮自己的 `hintSide` 决定） | `battleGearBoxAt` |
 *
 * ⚠️ 为什么需要 `'icon'` 那一种：战斗界面的齿轮锚在**左下角**，而"左下"
 * 对它的含义是"图标贴左下、提示往右长"（`battleGearBoxAt` 就是这么算的）。
 * 那里没有"整块"可言 —— 整块往右长不需要让位。硬套 `'block'` 会把提示
 * 也算进"贴边"，于是图标被推离它该在的位置。
 *
 * ⚠️ 为什么 `'block'` 那一种要按**提示在哪一侧**补一个偏移：`anchor` 居中的
 * 是**整块**，提示在左时图标的左上角会被推到盒内右侧 —— 而 `chromeBlockBoxAt`
 * 给的是"整块该贴哪条边"（提示那一头贴边）。所以这里把整块钉到 `box`，
 * **图标在哪由 `IconButton` 自己算**（`bounds` / `hintBounds` 是同一段算术）。
 *
 * ⚠️ 平移 `root` 而不是重算子节点坐标：`IconButton` 内部那套绝对坐标
 * （可点区域 `rect`、命中测试、`bounds`、提示包围盒）**自动跟着走** ——
 * 因为它们都是相对 `root` 的。这正是它比"外面再套一层容器、命中测试手工
 * 减偏移"（旧 `SettingsButton`）干净的地方：画在哪与点在哪儿永远同一段算术。
 */
function place(
  button: IconButton,
  box: ChromeBox,
  kind: 'block' | 'icon',
  hintSide: HintSide,
): IconButton {
  const { x, y } = button.bounds;
  button.root.x = Math.round(box.x) - (kind === 'block' ? x : rightEdgePad(button, hintSide));
  button.root.y = Math.round(box.y) - y;
  return button;
}

/**
 * `'icon'` 落位时，内容盒左缘与盒子左缘之间该让出多少。
 *
 * 提示在左 → 让出"提示宽 + 间隙"（整块往右长，图标在整块里的右端）；
 * 提示在右 → 不让（图标就是整块的左端）。
 */
function rightEdgePad(button: IconButton, hintSide: HintSide): number {
  if (hintSide !== 'left') return button.bounds.x;
  const hint = button.hintBounds;
  if (hint === undefined) return button.bounds.x;
  return hint.x - HINT_GAP;
}

/**
 * 某个按钮的**键位提示包围盒（画布坐标）**；没有提示或没有按钮时 `undefined`。
 *
 * ⚠️ 抽出来是因为两个按钮都要它（齿轮 / 返回箭头）—— 各写一遍必然漂移，
 * 而"哪个按钮的提示算错了"在截图里长得一模一样（都像"没画"）。
 *
 * ⚠️ 必须加 `root.x/y`：`IconButton.hintBounds` 是**相对它自己 `root`**
 * 的坐标（落位函数只拿到"盒内"的图标矩形），而按钮整体被摆到了画布上的
 * 某个点 —— 不加就会报出一个假位置（实测：`{x:0,y:0}`，而画面上是
 * `(8,8)`）。`bounds`（可点区域）本来就是绝对坐标，两者在这里对齐。
 */
function boundsOf(
  button: IconButton | undefined,
): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
  if (button === undefined) return undefined;
  const hint = button.hintBounds;
  if (hint === undefined) return undefined;
  return { ...hint, x: hint.x + button.root.x, y: hint.y + button.root.y };
}
