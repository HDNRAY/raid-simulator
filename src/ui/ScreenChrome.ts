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
import { PALETTE } from '../render/theme';
import { LOGICAL } from './layout';
import { UiLayout } from './uiLayout';
import { KEY_EDIT_KEYS } from './settings/keyNames';
import type { PixiCtor } from './primitives';

/**
 * **边角控件自己的边距**（逻辑像素，随 UI 缩放）—— 左上返回箭头 / 右上齿轮。
 *
 * ==================================================================
 * ⚠️ 2026-10-13：8 → **16**（用户："左上右上 2 个按钮可以增加一点到屏幕边缘
 * 的距离"）
 * ==================================================================
 *
 * 用户说的是**选人的界面**（选角色 / 自由模式），但这两个按钮**只有这一份
 * 实现**（四个整屏界面各造一个 `ScreenChrome`，落位公式全是 `chromeBoxAt`）
 * —— 所以改这里会**同时**影响四个界面：**首页 / 选角色 / 自由模式 / 战斗**。
 * 这与用户一直要的"**不用看在哪一半，全局统一风格**"一致。
 *
 * ⚠️ **它只影响这一组边角控件**，不动 HUD 布局表：
 *
 * | 会动 | 不会动 |
 * |---|---|
 * | 左上返回箭头、右上齿轮的位置 | `LAYOUT.bossBar` / `bossHp` / `player` / `log` / `skillBar` |
 * | 战斗齿轮与**玩家面板**之间的间距（同一常量） | 上面那些仍按自己的 8px 安全区 |
 *
 * 后者是**另一件事**（HUD 分区的构图边距），用户没有要求动它；
 * 把它一起改会让 Boss 血条 / 玩家面板 / 日志集体挪位 ✗。
 *
 * ==================================================================
 * ⚠️ 这个值同时是 `HINT_RISE` / `HINT_SHIFT` 的**上限来源**
 * ==================================================================
 *
 * 角标的两个偏移都会把提示往画布外推，而"能推多少"正好等于**图标距边缘的
 * 距离** = 这个边距。所以：
 *
 *     偏移上限（基准 20px 图标）= CHROME_MARGIN
 *
 * 8 → 16 之后上限也从 **8 变成 16**（`iconHintPlacement` 的推导已同步更新）。
 */
const MARGIN = 16;

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
 * **战斗界面的齿轮落点**：**玩家面板右缘 + 间距**，与面板顶对齐。
 *
 * ==================================================================
 * ⚠️ 2026-10-13：从"画布左下角"改成"面板右边"（用户给的方向）
 * ==================================================================
 *
 * 用户原话："**战斗时，齿轮应该在人物面板的右边**"。
 *
 * 上一版锚的是**画布左下角**（`(MARGIN×scale, 540 − MARGIN×scale)`）——
 * 它确实"任何系数下都不出画布"，但代价是**压住了玩家面板 / 血条**：
 * 面板左下锚定（`UI_ANCHORS.playerPanel = 'bottom-left'`，`y 452..532`），
 * `scale ≥ ~1.4` 时它向上长到左下的那条带里，正是齿轮所在的位置 ✗
 * （上一版自己在注释里报过这个取舍）。
 *
 * ==================================================================
 * 现在的规则：**锚在"玩家面板"上**（不是"算完再夹"）
 * ==================================================================
 *
 * ```ts
 * 图标左上角 = ( 面板右缘 + MARGIN×scale , 面板上缘 )
 * ```
 *
 * 面板矩形由 `UiLayout.playerPanel` 给（锚点 `'bottom-left'`）—— 与它被
 * **真正画出来**用的是同一段缩放算术，所以齿轮跟着面板走，不会漂。
 *
 * ⚠️ **一条规则**，没有分支、没有夹取。各档的实测（`MARGIN = 16` 之后；
 * 几何对账见 `tests/unit/screenChrome.test.ts` 的六档循环）。
 * ⚠️ 提示现在是**角标**（往图标的左上各偏 `shift`/`rise`），所以表格里的
 * "提示角标 x..右缘"给的是它真正的左上角与右缘：
 *
 * | scale | 面板 x..右缘 | 齿轮图标 x.. | 提示角标 x..右缘 | 日志 x..右缘 | 技能栏 x.. | 在画布内 |
 * |---|---|---|---|---|---|---|
 * | 0.5 | 8..122 | 130..140 | 128..142 | 8..88 | 782 | ✅ |
 * | 0.8 | 8..190 | 203..219 | 200..214 | 8..136 | 677 | ✅ |
 * | 1   | 8..236 | 252..272 | 248..264 | 8..168 | 604 | ✅ |
 * | 1.4 | 8..327 | 349..377 | 343..364 | 8..232 | 459 | ✅ |
 * | 1.5 | 8..350 | 374..404 | 368..390 | 8..248 | 426 | ✅ |
 * | 2   | 8..464 | 496..536 | 488..515 | 8..328 | 248 | ✅ |
 *
 * ⚠️ 于是三条"不压谁"都是**算出来的**，不是碰巧：
 *   - **不压面板**：`x` 从面板**右缘** + `MARGIN×scale` 起算；提示角标还会
 *     往左偏 `shift`，但 `shift ≤ MARGIN×scale`（见 `iconHint.ts`）——
 *     所以角标左缘**最紧也只到面板右缘**（scale 1 时 `248 > 236`）✓
 *   - **不压日志**：日志右缘最远 `328`（scale 2），而齿轮左缘 `496` ✓
 *   - **不压技能栏**：技能栏左缘随缩放**往左长**，scale 2 时到 `248`
 *     （比齿轮的 `496` 还靠左）—— 但两者**纵向**分开：齿轮在面板顶那一行
 *     （`y 372..412`），技能栏 `y 452..532`。所以判据是"**矩形不相交**"，
 *     不是"x 上谁在左"（由单测的六档循环断言，不靠肉眼）✓
 *   - **在画布内**：最右是提示角标的右缘 `515`（scale 2）≪ 960；
 *     下缘 = 面板顶 + 图标 ≤ 532 ✓
 *
 * ⚠️ **提示现在是角标**（它压在图标**自己的**左上角上，不再往旁边长），
 * 所以"整块"只有**图标那么大**，不必再为提示留宽度 —— 这也是这一版能
 * 直接把图标钉在面板右缘的原因（上一版并排摆法时，提示会伸到面板上）。
 *
 * ⚠️ 缩放的读法与别处一致：边距与尺寸都乘系数，位置由**面板**反推。
 */
export function battleGearBoxAt(scale: number): ChromeBox {
  const panel = new UiLayout(scale).playerPanel;
  const gap = Math.round(MARGIN * scale);
  return {
    x: panel.x + panel.w + gap,
    y: panel.y,
    size: Math.max(1, Math.round(GEAR_SIZE * scale)),
  };
}

/**
 * **"一键过关"按钮的落点**：齿轮的**正右方**，同一行、同一尺寸。
 *
 * ⚠️ 为什么在右边：战斗里齿轮锚在**玩家面板右缘**（`battleGearBoxAt`），
 * 右边那块是空的；放左边会压到玩家面板 ✗（那张表在 `battleGearBoxAt`
 * 的注释里，六档缩放都算过）。
 *
 * ⚠️ 间距取 `MARGIN` 的一半：两个按钮属于**同一组**，比"贴边距"更近，
 * 但又不会挤成一块（读得出是两个可点目标）。
 */
export function devClearBoxOf(gear: ChromeBox): ChromeBox {
  const gap = Math.max(4, Math.round(gear.size / 4));
  return { x: gear.x + gear.size + gap, y: gear.y, size: gear.size };
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
   * **开发模式的那颗"一键过关"**（2026-10-22，用户："开发模式，再加一个功能，
   * 一键过关，放在设置旁边，快捷键f2"）。
   *
   * ⚠️ **不给就不画** —— 这是"只在开发模式存在"的**唯一**判据：生产里
   * 没人传它，于是按钮不构建、`hitTest` 也不会命中（不是"画了再藏"，
   * 那种一不留神就会露出来 ✗）。`F2` 那条在 `app/loopWiring` 里另有一道
   * `devMode()` 守卫。
   *
   * ⚠️ 它会在**齿轮右边**（见 `devClearBoxOf`）：齿轮在战斗里锚在玩家面板
   * 右缘，右边那块是空的；放在左边会压到面板 ✗。
   */
  readonly onDevClear?: (() => void) | undefined;
  /**
   * `F2` 的显示名（那颗按钮的键位提示）。
   *
   * ⚠️ 与 `f1Label` 同一条纪律：键名由调用方从键位表反查后拼，本组件
   * 不碰 i18n（AGENTS.md §3b）。只有给了 `onDevClear` 才会被读。
   */
  readonly f2Label?: (() => string) | undefined;
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
  /** 开发模式的"一键过关"（生产里根本不构建 —— 见 `onDevClear`）。 */
  private devClear: IconButton | undefined;
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
    /**
     * **"一键过关"**：只在开发模式存在（`devClear` 没构建就没有这一支）。
     * 排在齿轮之后、返回之前 —— 顺序即优先级（`canvasInput` 同一条纪律）。
     */
    if (this.devClear !== undefined && this.devClear.contains(px, py)) {
      this.options.onDevClear?.();
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

  /**
   * **"一键过关"的可点区域**（探针用）。
   *
   * ⚠️ 生产里是 `undefined`（没构建）—— 这正是"开发模式才有它"的可读证据，
   * 比"看它有没有画出来"可靠（画了但被别的节点盖住也会像没有）。
   */
  get devClearBounds(): { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | undefined {
    return this.devClear?.bounds;
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
   * ⚠️ 与 `backShortcutBounds` 同一个 `boundsOf` —— 曾经只有返回箭头有
   * 这个读数，于是"齿轮的提示有没有伸出画布"**没有可读的证据**，只能靠
   * 肉眼看截图（而画布下缘和背景一样黑，"被裁掉"和"画在那"分不出来）。
   * 现在战斗齿轮锚在**玩家面板右边**，同样需要一个数来对账：截图脚本读它
   * 证明"角标压在齿轮左上角上、且没被裁"。**每个按钮都要有这个读数。**
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
    this.devClear?.setShowShortcut(show);
    this.back?.setShowShortcut(show);
    /**
     * ⚠️ `update()` 也要转发：焦点环与图标颜色的切换收在那里面
     * （`IconButton.update` 只在 `lit` / 环的可见性真的变了才动节点）。
     */
    this.gear?.update();
    this.devClear?.update();
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
    this.devClear?.root.destroy({ children: true });
    this.back?.root.destroy({ children: true });
    this.gear = undefined;
    this.devClear = undefined;
    this.back = undefined;

    const f1 = this.options.f1Label();
    /**
     * ⚠️ 提示是**角标**（压在图标自己的左上角上），所以它**不占**整块宽度 ——
     * 落位只看**图标**的左上角，四个边角共用 `chromeBoxAt` 一条规则。
     *
     * ⚠️ 于是不再有"按整块反推图标位置"那一套（`chromeBlockBoxAt` 已删）：
     * 那是并排摆法的产物（提示会伸到图标外面，得先算整块多大）。
     *
     * `gearAt` 仍是可注入的（战斗界面传自己的落位函数），注入的那份由它
     * 自己保证不出界（见 `battleGearBoxAt`）。
     */
    const gearBox = this.options.gearAt === undefined
      ? chromeBoxAt({ right: true, bottom: false }, GEAR_SIZE, this.uiScale)
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
      /**
       * 锚点只用于**取尺寸**：真正的落位由 `place` 把**图标左上角**钉到
       * `box`（见 `place` 的说明）。`anchor` 居中的是内容盒，而内容盒是
       * 图标 + 可选文字标签 —— 齿轮没有标签，所以两者中心重合。
       */
      anchor: { x: gearBox.x + gearBox.size / 2, y: gearBox.y + gearBox.size / 2 },
      onClick: () => this.options.onGear(),
    });
    this.gear = place(gear, gearBox);

    /**
     * 返回箭头：**只有给了 `onBack` 才画**（首页 / 战斗没有返回动作）。
     *
     * ⚠️ 它和齿轮**同一个组件、同一套视觉语言、同一个落位公式**
     * （`chromeBoxAt`：图标左上角贴自己那条边），只是贴的是**另一条边**
     * （左上）—— 两条边角一条规则，没有"看在哪一半"的分支。
     *
     * ⚠️ 用户 2026-10-13："今天我让你把返回改得跟设置一样之后，就都不对了"
     * —— 现在"跟设置一样"就是"同一个组件 + 同一个角标"，唯一差别是贴哪条边。
     */
    /**
     * **开发模式的"一键过关"**：齿轮右边、同尺寸、同组件（`IconButton`），
     * 所以视觉上与齿轮是一组的 ✓。`onDevClear` 没给就**不构建** ✓。
     */
    if (this.options.onDevClear !== undefined) {
      const box = devClearBoxOf(gearBox);
      const f2 = this.options.f2Label?.() ?? '';
      const clear = new IconButton({
        pixi: this.pixi,
        icon: 'skip',
        size: box.size,
        color: PALETTE.textDim,
        brightColor: PALETTE.focus,
        /**
         * ⚠️ **不给 `focusRing`**：它不参与键盘焦点环（`↑` 只在齿轮 / 界面
         * 之间走），画一个永远不亮的环只会让人以为"它能被 Tab 到"。
         */
        shortcut: f2,
        anchor: { x: box.x + box.size / 2, y: box.y + box.size / 2 },
        onClick: () => this.options.onDevClear?.(),
      });
      this.devClear = place(clear, box);
    }

    if (this.options.onBack !== undefined) {
      const box = chromeBoxAt({ right: false, bottom: false }, ARROW_SIZE, this.uiScale);
      const arrow = new IconButton({
        pixi: this.pixi,
        icon: 'arrow-left',
        size: box.size,
        color: PALETTE.textDim,
        brightColor: PALETTE.focus,
        /** 返回不参与键盘焦点（`F1` 那条流程只管齿轮），所以不画永远不会亮的环。 */
        shortcut: ESC_SHORTCUT,
        anchor: { x: box.x + box.size / 2, y: box.y + box.size / 2 },
        onClick: () => this.options.onBack?.(),
      });
      this.back = place(arrow, box);
    }

    const nodes: Container[] = [];
    if (this.gear !== undefined) nodes.push(this.gear.root);
    if (this.devClear !== undefined) nodes.push(this.devClear.root);
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
 * 把按钮的**图标左上角**钉到 `box`。
 *
 * ==================================================================
 * 为什么是"图标左上角"这一件事，而不是"整块"
 * ==================================================================
 *
 * 提示是**角标**（压在图标自己的左上角上，见 `ui/iconHint.ts`），所以
 * "整块"就是**图标**本身 —— 三个调用点（整屏齿轮 / 返回箭头 / 战斗齿轮）
 * 给的都是"图标左上角该落在哪"，没有第二种输入，也没有需要按摆法分叉的翻译。
 *
 * ⚠️ 更早这里有 `kind: 'block' | 'icon'` 与 `rightEdgePad()`：那是**并排**
 * 摆法的产物（提示伸到图标外面，于是"贴边"贴的是提示那一头，图标得再让出
 * 一个提示宽）。角标没有这个问题，两者都已删。
 *
 * ⚠️ 为什么要挪 `root` 而不是只用 `anchor` 居中：`IconButton` 的 `anchor`
 * 走的是"内容盒居中"那条路，而内容盒**含文字标签**（高度取
 * `max(size, small+4, body+4)`）。想表达"图标的左上角落在哪"就得先知道
 * 盒有多大 —— 那正是落位函数（`chromeBoxAt`）不该知道的细节。
 * 所以这里反过来：照常按 `anchor` 居中构造（只借用它的**尺寸**信息），
 * 再把 `root` 平移 `box − 图标在盒内的位置`，让图标精确落在 `box`。
 *
 * ⚠️ 平移之后 `IconButton` 内部那套绝对坐标（可点区域 `rect`、命中测试、
 * `bounds`、提示包围盒）**自动跟着走** —— 因为它们都是相对 `root` 的。
 * 这正是它比"外面再套一层容器、命中测试手工减偏移"（旧 `SettingsButton`）
 * 干净的地方：画在哪与点在哪儿永远是同一段算术。
 */
function place(button: IconButton, box: ChromeBox): IconButton {
  button.root.x = Math.round(box.x) - button.bounds.x;
  button.root.y = Math.round(box.y) - button.bounds.y;
  return button;
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
