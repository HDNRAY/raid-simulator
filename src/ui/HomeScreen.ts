/**
 * **首页**：选「肉鸽模式」还是「自由模式」。
 *
 * ==================================================================
 * 需求（用户 2026-10-12 定稿的流程）
 * ==================================================================
 *
 * 用户原话："有一个**新的首页**，首页可以**选进入肉鸽模式，或者自由**，
 * 自由就回到我们现在的备战……
 *
 * ```
 * 首页（默认入口）
 *   ├─ 「肉鸽模式」 → 选角色屏 → 一局肉鸽
 *   └─ 「自由模式」 → 备战界面（`PrepareScreen`，开发 / 测试入口）
 * ```
 *
 * 标题「炼炁师大战七宗罪」是**临时**的（用户原话："先随便整个标题，
 * '炼炁师大战七宗罪' 以后再改"）—— 所以它写在 i18n 里
 * （`screen.home.title`），改文案只需要动语言包。
 *
 * ==================================================================
 * 交互：一个线性光标 + Enter 执行（键盘与触屏**对等**）
 * ==================================================================
 *
 *   - 键盘：↑ ↓ 移动光标（两端停住）；Tab / Shift+Tab 环绕；Enter 执行
 *   - 触屏 / 鼠标：**点按钮 = 执行**（一步到位，与「开始战斗」同一种动作）
 *
 * 两者对等：键盘能到的两个状态，触屏都能一步到达（AGENTS.md §3b）。
 * 与备战界面不同的是，这里**不需要"再确定一次"** —— 两个按钮是动作
 * 而不是选项（见 `homeLogic` 文件头的说明）。
 *
 * ⚠️ 这个界面**不碰引擎、不碰 `RunState`**：它只把"选了哪条路"告诉
 * 调用方（`onPick`）。首页之所以能当默认入口，正是因为它只是路由。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LOGICAL } from './layout';
import { Label, type PixiCtor } from './primitives';
import { ScreenChrome } from './ScreenChrome';
import { PALETTE } from '../render/theme';
import { CARD_RADIUS, cardSkin } from './prepareRender';
import {
  HOME_LAYOUT,
  createHomeState,
  homeActionAt,
  homeActionAtPoint,
  homeHitAreas,
  moveHomeCursor,
  type HomeAction,
  type HomeState,
} from './homeLogic';
import type { TranslateFn } from '../i18n/translator';

/**
 * 每个入口的文案 key（表而不是三元 —— 加第三个入口时三元已经写不下了）。
 */
const HOME_LABEL_KEYS: Readonly<Record<HomeAction, string>> = {
  roguelike: 'screen.home.roguelike',
  free: 'screen.home.free',
  codex: 'screen.home.codex',
};

export interface HomeScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  /**
   * 是否显示键位提示（触屏为假）。
   *
   * ⚠️ 传**取值函数**而不是布尔：触屏能力值由 `app/touchSetup.ts` 在
   * 本屏构造**之后**才探测出来（装配顺序使然），而每帧的 `redraw` 会现读它。
   */
  readonly showKeyHints: () => boolean;
  /**
   * 点右上角的**齿轮**（打开设置）。
   *
   * ⚠️ 每个全屏界面**自己持有**齿轮（用户 2026-10-12："多个页面的齿轮，
   * 应该分别定义"、"stage 上理论上不挂任何小组件"），所以这个回调由
   * `app/screenSetup.ts` 接通、由本屏自己的 `chrome` 负责命中。
   * 同一时刻只有一个整屏界面在台上（`applyPhase` 是显隐的唯一写入点），
   * 所以指针路由不会问错人。
   */
  readonly onGear: () => void;
  /** `F1` 的显示名（齿轮的键位提示；键名不进 i18n，AGENTS.md §3b）。 */
  readonly f1Label: () => string;
  /** 选了某条路（Enter / 点击）。 */
  readonly onPick: (action: HomeAction) => void;
}

/**
 * 首页要拼上去的**键名**。
 *
 * ⚠️ 键名**不进 i18n**（AGENTS.md §3b）：这里是渲染层，"哪几个键"属于
 * 键位而不是文案。文案只有 `screen.home.hint`（标签）与 `screen.keyHint`
 * （外面那对括号），所以触屏只要**不拼**这一段就藏掉了。
 */
const HOME_KEY_HINT = '↑↓ · Enter';

/** 一个入口按钮的显示对象（底板 + 标签 + 文案 key）。 */
interface HomeButtonRefs {
  readonly action: HomeAction;
  readonly gfx: Graphics;
  readonly label: Label;
  /**
   * 这个按钮的文案 key。
   *
   * ⚠️ key 在**构造时**按 `action` 定下来，不在每帧的 `redraw` 里现推：
   * 渲染层不许硬编码可显示文案（i18n I1），而"哪个 action 对应哪个 key"
   * 属于界面结构、不属于每帧状态。
   */
  readonly nameKey: string;
}

export class HomeScreen {
  readonly root: Container;

  private readonly bg: Graphics;
  private readonly title: Label;
  private readonly hint: Label;
  /**
   * 页脚的**第三方素材声明**。
   *
   * ⚠️ 它是**权利归属的标示**，不是装饰（本项目的角色素材取自
   * 《炎龍騎士團2》）。首页现在是**默认入口**，绝大多数玩家从这里进入 ——
   * 声明只留在「自由模式」那一屏（原来在备战界面）会让它实际上被埋掉，
   * 所以首页也显示一次。文案与备战界面**共用同一个 key**
   * （`roster.ui.notice`），不另写一份。
   */
  private readonly notice: Label;
  private readonly buttons: readonly HomeButtonRefs[];
  /**
   * **本屏自己的边角控件**（右上角的齿轮）。
   *
   * ⚠️ 首页没有返回箭头（它就是返回的目标本身，见 `phaseLogic.backVisibleIn`），
   * 所以这里只传 `onGear`、不传 `onBack`。
   *
   * ⚠️ 它在**本屏的 root 里**（不是 stage 上）：所以 `setVisible` 自动带上它，
   * 缩放也由本屏的 `setUiScale` 一并转发 —— 这正是"组件归它所在的界面所有"。
   */
  readonly chrome: ScreenChrome;
  private readonly options: HomeScreenOptions;

  private state: HomeState = createHomeState();

  constructor(options: HomeScreenOptions) {
    this.options = options;
    const { pixi } = options;

    this.root = new pixi.Container();
    this.root.visible = false;

    this.bg = new pixi.Graphics();
    this.bg.rect(0, 0, LOGICAL.width, LOGICAL.height).fill({ color: PALETTE.bgTop });
    this.root.addChild(this.bg);

    this.title = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: HOME_LAYOUT.titleY,
      size: 36,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.root.addChild(this.title.root);

    /**
     * 按钮底板各一块 Graphics、标签各一个 Label。
     *
     * ⚠️ 这里**不给按钮画图标**：`IconButton` 需要 `IconName`（`render/icons`），
     * 而首页的两个入口没有合适的既有图标；硬塞一个齿轮/箭头会误导。
     * 用户只要求"标题 + 两个按钮"，所以是纯文字按钮。
     */
    const areas = homeHitAreas();
    this.buttons = areas.map((area) => {
      const gfx = new pixi.Graphics();
      const label = new Label(pixi, {
        x: area.x + area.w / 2,
        y: area.y + area.h / 2,
        size: FONT.warn,
        color: PALETTE.text,
        anchorX: 0.5,
        anchorY: 0.5,
      });
      this.root.addChild(gfx, label.root);
      return {
        action: area.action,
        gfx,
        label,
        nameKey: HOME_LABEL_KEYS[area.action],
      };
    });

    this.hint = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: HOME_LAYOUT.hintY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.notice = new Label(pixi, {
      x: LOGICAL.width / 2,
      y: HOME_LAYOUT.noticeY,
      size: FONT.small,
      color: PALETTE.textDim,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    this.root.addChild(this.hint.root, this.notice.root);

    /**
     * 齿轮**最后加**（同一层里后加的盖在上面）：它与两个入口按钮不重叠，
     * 但"边角控件在最上层"是这一层的通用约定，别让它哪天被卡片压住。
     */
    this.chrome = new ScreenChrome({
      pixi,
      showKeyHints: options.showKeyHints,
      f1Label: options.f1Label,
      onGear: options.onGear,
    });
    this.root.addChild(this.chrome.root);

    this.redraw();
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    /** 与 `PrepareScreen.setVisible` 同一条理由：切回来时补一次重画。 */
    if (visible) this.redraw();
  }

  /** 当前光标停在哪一个入口（调试入口与截图脚本读它）。 */
  get current(): HomeState {
    return this.state;
  }

  /** 键盘：上下移动光标（`wrap` = Tab / Shift+Tab）。 */
  moveFocus(delta: number, wrap = false): void {
    const next = moveHomeCursor(this.state, delta, wrap);
    if (next === this.state) return;
    this.state = next;
    this.redraw();
  }

  /**
   * Enter：执行光标处的入口。
   *
   * ⚠️ 光标在第一个按钮上时**不特殊处理**（首页没有"确定 / 开战"两段：
   * 两个按钮都是动作）。见 `homeLogic` 文件头的说明。
   */
  confirm(): void {
    this.options.onPick(homeActionAt(this.state));
  }

  /** 点一下（逻辑坐标）。 */
  hitTest(px: number, py: number): boolean {
    /**
     * ⚠️ **齿轮先于卡片**：它是这一屏上浮在界面之上的可点元素
     * （右上角，与两个入口按钮不重叠）。`ScreenChrome.hitTest` 里
     * 齿轮又排在返回箭头之前 —— 顺序就是优先级（`canvasInput` 的纪律）。
     */
    if (this.chrome.hitTest(px, py)) return true;
    const action = homeActionAtPoint(px, py);
    if (action === undefined) return false;
    /**
     * 点击 = **把光标移过去 + 执行**（与备战界面"点击 = 移光标 + 确定"
     * 同一条规则）：这样触屏点完之后画面上的光标也在那里，
     * 不会出现"我已经点了，但焦点还停在另一个按钮上"的错位。
     */
    const index = homeHitAreas().findIndex((a) => a.action === action);
    if (index >= 0) this.state = { cursor: index };
    this.redraw();
    this.options.onPick(action);
    return true;
  }

  /** 每帧：只在可见时保证画面与光标一致（状态是离散的，很便宜）。 */
  frame(): void {
    if (this.root.visible) {
      this.redraw();
      /** 键位提示跟着"键盘 / 触屏"这个唯一 flag 走（见 `ScreenChrome.update`）。 */
      this.chrome.update();
    }
  }

  /**
   * **UI 缩放**：本屏只转发给**它自己的**边角控件。
   *
   * ⚠️ 缩放不作用于首页的标题 / 卡片（现状如此：这一屏整体是一个满屏
   * 布局，缩放它等于缩放整屏）。齿轮在这一屏是**浮在界面之上**的控件，
   * 它要跟其它界面的齿轮长得一样大 —— 所以必须有这一条。
   */
  setUiScale(scale: number): void {
    this.chrome.setUiScale(scale);
  }

  private redraw(): void {
    const t = this.options.translate;
    this.title.set(t('screen.home.title'));
    /**
     * 提示 = 标签 + （键名）。触屏不拼后半段（键名不是文案，
     * 见 `HOME_KEY_HINT` 的说明）。
     */
    const keys = this.options.showKeyHints() ? t('screen.keyHint', { keys: HOME_KEY_HINT }) : '';
    this.hint.set(`${t('screen.home.hint')}${keys}`);
    this.notice.set(t('roster.ui.notice'));

    const areas = homeHitAreas();
    this.buttons.forEach((button, i) => {
      const area = areas[i];
      if (area === undefined) return;
      /**
       * 皮肤复用备战界面的 `cardSkin()`（纯函数、有单测）：
       * **冷白 = 光标**、暗灰 = 没被碰到。首页没有"已选中"这种东西，
       * 所以 `selected` 恒为假 —— 也就不可能出现"两个按钮都是金色"。
       */
      const skin = cardSkin({
        developing: false,
        cursored: this.state.cursor === i,
        selected: false,
      });
      button.gfx.clear();
      button.gfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .fill({ color: skin.fillColor, alpha: skin.fillAlpha });
      button.gfx
        .roundRect(area.x, area.y, area.w, area.h, CARD_RADIUS)
        .stroke({ color: skin.strokeColor, width: skin.strokeWidth });
      button.label.set(t(button.nameKey));
      button.label.setColor(skin.nameColor);
    });
  }
}
