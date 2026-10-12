/**
 * 技能栏（右下角那排格子）。
 *
 * 抽成独立文件：它是**最复杂的单个可视组件**（331 行）—— 格子的
 * 几何、字号、冷却遮罩、资源代价、UI 缩放全在里面。原先内嵌在
 * `BattleScene.ts` 里，那个文件就同时是"场景编排"和"组件实现"。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT, LAYOUT, skillSlotLabels, skillSlotRect } from '../ui/layout';
import { HALF_PIXEL, Label, type PixiCtor } from '../ui/primitives';
import { PALETTE } from './theme';
import type { ResourceKeyName, SkillSlotView } from './viewModel';
/**
 * 状态 → 配色抽到了 `./slotLook`（**技能栏与触屏圆钮共用**，需求：
 * "触屏圆钮跟技能栏统一"）。这里只转发 `slotStateOf`，调用点不变。
 */
import { SLOT_LOOKS, slotStateOf } from './slotLook';
import type { FrameContext, FramePart, TranslateFn } from './sceneTypes';

/**
 * 技能格右上角"资源代价"的颜色。
 *
 * **与资源条用的是同一个 base 色** —— 玩家不用学第二套映射：
 * 格子右上角那个绿"10"就是左下面板的炁。
 */
export const RESOURCE_COLORS: Readonly<Record<ResourceKeyName, number>> = {
  hp: PALETTE.hp.base,
  energy: PALETTE.energy.base,
  douqi: PALETTE.douqi.base,
};

/** 冷却矮条的最大高度（取自布局表，避免两处写魔数）。 */
const SLOT_COOLDOWN_BAR_H = LAYOUT.skillBar.cooldownBarHeight;

export class SkillBarView implements FramePart {
  readonly name = 'skillBar';

  readonly root: Container;
  private readonly slots: Array<{
    gfx: Graphics;
    /** 技能字（楷体）。这是图标的占位 —— 正式美术接入后换成贴图。 */
    glyph: Label;
    key: Label;
    cd: Label;
    cost: Label;
    skillCd: Label;
    rect: { x: number; y: number; w: number; h: number };
    /**
     * 派生技专用：它**不占自己的槽位**，而是画在源技能的上方。
     *
     * 需求："键盘派生技能显示在**原技能的上方**。"
     * `undefined` = 正常槽位（按 index 排）。
     */
    overrideRect?: { x: number; y: number; w: number; h: number };
  }> = [];
  /**
   * UI 缩放系数（默认 1）。
   *
   * 缩放变化时**重建**整条栏（清空 slots + `slotCount = 0`，让 `ensure`
   * 重新算几何）—— 技能格的尺寸、间距、右对齐位置、字号都要跟着变，
   * 逐项改比重建更容易漏。重建只在用户拖 slider 时发生，不在热路径。
   */
  private uiScale = 1;
  private readonly pixi: PixiCtor;
  private slotCount = 0;

  constructor(
    pixi: PixiCtor,
    private readonly translate: TranslateFn,
  ) {
    this.pixi = pixi;
    this.root = new pixi.Container();
  }

  /**
   * 设定 UI 缩放。
   *
   * ⚠️ 必须把旧的 Graphics **从显示列表里移除**，而不只是清空数组：
   * `this.slots.length = 0` 只丢引用，那些 Graphics 仍然是 `root` 的
   * 子节点 —— 于是下一次 `ensure` 建的新格子会和旧的**叠在一起**
   * （实测：缩放后技能栏出现两层，一层原尺寸一层放大）。
   *
   * 用 `destroy({ children: true })` 一并释放纹理。
   */
  setUiScale(scale: number): void {
    if (scale === this.uiScale) return;
    this.uiScale = scale;
    /**
     * ⚠️ **每个格子里的东西都要销毁**，不只是底图 `gfx`。
     *
     * 踩过的坑：第一版只 `gfx.destroy()` —— 但 `glyph` / `key` / `cd` /
     * `cost` / `skillCd` 这些 Label 也是 `root` 的**直接子节点**，
     * 不会被 `gfx` 的销毁带走。于是缩放后新旧两层叠在一起
     * （实测「斩」出现两次：`699,494` 与 `575,484`）。
     */
    for (const slot of this.slots) {
      for (const node of [
        slot.gfx,
        slot.glyph.root,
        slot.key.root,
        slot.cd.root,
        slot.cost.root,
        slot.skillCd.root,
      ]) {
        node.destroy({ children: true });
      }
    }
    this.slots.length = 0;
    this.slotCount = 0;
  }

  /**
   * 技能格底色的**圆角半径**（跟着 UI 缩放走）。
   *
   * 取 3 与 `PANEL_STYLE.radius` 同一个值 —— 技能格不是面板，但它们
   * 出现在同一块画面里，"所有方块圆角一致"是这套 UI 看起来是一个东西的
   * 来源之一。下限 2 是给"缩到 100% 以下"留的：半径再小就和直角没区别，
   * 那还不如不画。
   */
  private cornerRadius(): number {
    return Math.max(2, Math.round(3 * this.uiScale));
  }

  /**
   * 描边宽度（跟着 UI 缩放走）。
   *
   * 不写死 1px 的理由：`uiScale` 是**在逻辑画布内**把技能栏放大的，
   * 100% 时 1px 的描边在 200% 的格子上会细得像没画。
   */
  private lineWidth(): number {
    return Math.max(1, Math.round(this.uiScale));
  }

  /**
   * @param count 要画的槽位总数
   * @param overlayCount 其中**派生技**的个数（它们不占正常槽位，
   *   而是画在源技能上方）—— 布局按 `count - overlayCount` 排，
   *   否则右对齐会整体错位。
   */
  private ensure(count: number, overlayCount = 0): void {
    const target = Math.min(count, LAYOUT.skillBar.max);
    /** 参与常规排布的槽位数（派生技不算）。 */
    const baseCount = Math.max(1, target - overlayCount);
    while (this.slots.length < target) {
      const i = this.slots.length;
      // 派生技的位置由 `overrideRect` 决定，这里给个占位矩形即可
      const rect = skillSlotRect(i, baseCount, this.uiScale);
      const pos = skillSlotLabels(rect);
      const gfx = new this.pixi.Graphics();

      /**
       * 图标 = 技能名那个字，用**楷体**。
       *
       * 为什么不用图形：目前没有美术素材，而"一个字"比任何几何图形
       * 都更能表达技能（攻/闪/防/破/轰/凝）。楷体在 30px 上下
       * 比黑体更易辨认（见 theme.ts 的说明）。
       */
      /**
       * 技能字用 `FONT.body`（15px）而不是 `FONT.big`（26px）。
       *
       * 26px 的楷体字高 28px，占掉了 44px 格子的 2/3，
       * 冷却秒数无论放哪都会与它相交。15px 的字高约 17px，
       * 加上下方 20px 的秒数位置才放得下 —— 这是算出来的，
       * 不是试出来的（见 `skillSlotLabels` 的说明）。
       */
      const glyph = new Label(this.pixi, {
        x: pos.glyph.x,
        y: pos.glyph.y,
        // 图标用专门的字号（32px），比 body 大得多 —— 见 FONT.skillIcon
        // 字号跟着 UI 缩放 —— 见 `Label.setSize` 的说明
        size: Math.max(1, Math.round(FONT.skillIcon * this.uiScale)),
        color: 0xffffff,
        // 双向居中 —— 需求指出技能字原先"位置也不是居中的"
        anchorX: 0.5,
        anchorY: 0.5,
        kai: true,
      });
      /**
       * 按键提示：格子内**右下角**。
       *
       * 踩过两次坑：
       *   1. 一开始放格子内右下角，被**冷却弧**压住（弧的半径几乎
       *      等于格子半宽）。
       *   2. 于是移到格子**外面**下方 —— 结果落到画布底边之外，
       *      被截断（技能栏底部就在 y=530，画布只有 540）。
       *
       * 3. 弧缩小后又放回右下角 → 与冷却数字挤在一起（被测试抓到）。
       *
       * 现在放**左上角**：冷却弧的内圈在那里留了空白，
       * 而技能字在正中、数字在正中下方，三者互不侵犯。
       */
      const key = new Label(this.pixi, {
        x: pos.key.x,
        y: pos.key.y,
        size: Math.max(1, Math.round(FONT.tiny * this.uiScale)),
        color: 0x9090a0,
      });
      /**
       * **实时**冷却秒数：格子正中（需求："实时 cd 还是保持在原来的中间"）。
       *
       * - 双向居中（anchor 0.5/0.5），所以 `pos.cooldown` 是中心点
       * - 描边保证压在图标上也读得清
       */
      const cd = new Label(this.pixi, {
        x: pos.cooldown.x,
        y: pos.cooldown.y,
        size: Math.max(1, Math.round(FONT.cd * this.uiScale)),
        color: 0xffffff,
        anchorX: 0.5,
        anchorY: 0.5,
        stroke: 0x000000,
        strokeWidth: 3,
        bold: true,
      });
      /**
       * **固有**冷却：左下角（需求："左下 我说的是技能的固有 cd 时间"）。
       *
       * 静态数字，带 `s` 单位（"30s"）—— 它是"这个技能多长 CD"的
       * 规格说明，不是"还剩多久"，有单位才不会被误读成实时值。
       */
      const skillCd = new Label(this.pixi, {
        x: pos.skillCd.x,
        // 与右侧的代价**同一行对齐**：两者锚点不同（这里底对齐、
        // 代价也是底对齐），但小字形的下伸不同，实测差 2px，补上
        y: pos.skillCd.y - Math.max(1, Math.round(2 * this.uiScale)),
        size: Math.max(1, Math.round(FONT.tiny * this.uiScale)),
        color: 0x8c8c9e,
        anchorY: 1,
      });
      /**
       * 资源代价：**右下角**。
       *
       * 只显示**数字**（+ 按住技的 `/s` 后缀），资源种类靠**颜色**区分
       * （炁绿 / 缠金 / 血红）—— 角落放不下"30炁"三个字。
       */
      const cost = new Label(this.pixi, {
        x: pos.cost.x,
        y: pos.cost.y,
        size: Math.max(1, Math.round(FONT.tiny * this.uiScale)),
        color: 0xffffff,
        anchorX: 1,
        anchorY: 1,
        stroke: 0x000000,
        strokeWidth: 2,
      });
      // 层叠：底 → 图标 → 按键 → 固有CD → 代价 → 实时CD（实时最上层）
      this.root.addChild(gfx, glyph.root, key.root, skillCd.root, cost.root, cd.root);
      this.slots.push({ gfx, glyph, key, cd, cost, skillCd, rect });
    }

    if (target !== this.slotCount) {
      this.slotCount = target;
      // 右对齐：槽位数变化时整条栏向左延展
      for (let i = 0; i < this.slots.length; i += 1) {
        // 同上：重排也只按核心槽位数，派生技走 overrideRect
        const rect = skillSlotRect(i, baseCount, this.uiScale);
        const pos = skillSlotLabels(rect);
        const s = this.slots[i];
        if (!s) continue;
        s.rect = rect;
        s.glyph.root.x = pos.glyph.x;
        s.glyph.root.y = pos.glyph.y;
        s.key.root.x = pos.key.x;
        s.key.root.y = pos.key.y;
        s.cd.root.x = pos.cooldown.x;
        s.cd.root.y = pos.cooldown.y;
        s.cost.root.x = pos.cost.x;
        s.cost.root.y = pos.cost.y;
        s.skillCd.root.x = pos.skillCd.x;
        s.skillCd.root.y = pos.skillCd.y;
      }
    }
  }

  /**
   * 帧部件入口：自己去 ctx 里取技能栏需要的字段。
   *
   * 形状从 `update(skills)` 改成 `render(ctx)` —— 由场景替它取字段，
   * 变成部件自己取。这一行就是"注册机制"与"场景逐个调用"的分界。
   */
  render(ctx: FrameContext): void {
    this.draw(ctx.view.skills, ctx.showKeyHints);
  }

  private draw(skills: readonly SkillSlotView[], showKeyHints: boolean): void {
    this.ensure(skills.length, skills.filter((s) => s.derivedFrom !== undefined).length);

    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i];
      const view = skills[i];
      if (!s) continue;

      if (!view) {
        s.gfx.clear();
        s.glyph.set('');
        s.key.set('');
        s.cd.set('');
        s.cost.set('');
        s.skillCd.set('');
        continue;
      }

      /**
       * 派生技画在**源技能的上方**（需求）。覆盖矩形只在有 `derivedFrom`
       * 时才算，所以普通槽位零开销、行为完全不变。
       */
      const rect = view.derivedFrom === undefined
        ? s.rect
        : derivedRect(s.rect, view.key, skills);
      const { x, y, w, h } = rect;
      const g = s.gfx;
      const look = SLOT_LOOKS[slotStateOf(view)];
      const radius = this.cornerRadius();
      const lineW = this.lineWidth();
      /**
       * 描边**内移半个线宽**：奇数宽度要落在半像素上（见 `HALF_PIXEL`
       * 的说明 —— 1px 的线画在整数坐标上会被反锯齿稀释成两行半像素，
       * 实测几乎看不见），偶数宽度正好压在像素边界上。
       */
      const inset = lineW % 2 === 1 ? HALF_PIXEL : lineW / 2;
      g.clear();

      /**
       * 底色 = 技能格的"按钮"本体，四档状态各一色（`PALETTE.slot`）。
       *
       * ------------------------------------------------------------------
       * 演进：这里曾经**没有底色**（需求原话："暂时不要按钮的大招边框、
       * 不同的背景色"）。那一版只用"字的明暗"表达状态，结果就是用户这次
       * 报的问题：**资源不够的技能几乎看不见** —— 深灰的字压在深色的
       * 战斗背景上，玩家连"这里有一格、它是哪个技能"都认不出来。
       *
       * 所以现在每一格都有底色，而且底色**跟着状态走**：
       *   可用 / 冷却中 → 亮石板（冷却另加白色遮罩 + 秒数）
       *   读条中等条件型 → 中间一档
       *   买不起         → 最暗的一档（"断电"）
       * 四档同色系、只差明暗，所以技能栏不会变成一盏红绿灯。
       *
       * ⚠️ 圆角与描边宽度**都按 `uiScale` 走**（`cornerRadius` / `lineWidth`）：
       * 缩放后格子会变大，写死的 1px / 3px 会显得"糊在格子里"。
       */
      g.roundRect(x, y, w, h, radius).fill(look.fill);

      if (view.cooldownRatio > 0.001) {
        /**
         * 冷却遮罩：**白色半透明，铺满整格**（底边对齐，向满高生长）。
         *
         * 需求："cd 的半透明遮罩就应该用白色"、"背景是暗色"、
         * "数字应该盖在按键 icon 上"。
         *
         * 演进（这条来回改过很多次，记下来）：
         *   1. **扇形/圆环** —— 把技能字盖住
         *   2. **红色弧线** —— 配色里太跳，而且逐帧重算起止角**会抖动**
         *   3. **半透明黑色矮条（18px）** —— 太暗，且"还剩多少"读不出来
         *   4. **白色铺满整格**（当前）—— 亮色在暗底格子上对比度高，
         *      剩余高度一眼可读；高度取整所以不抖
         *
         * 白色用**半透明**（0.55）：既压住技能字让数字跳出来，
         * 又不会糊成一块死白（还能看见底下的格子边界）。
         *
         * 数字（`s.cd`）在这个遮罩**之后** addChild，所以盖在最上面 ——
         * 这正是需求要的"数字盖在 icon 上"。
         *
         * ⚠️ 遮罩压在**底色**上（在描边之前）：于是"还剩多少"是在那块
         * 底板上长出来的，而不是浮在战斗背景上。
         */
        const barH = Math.max(1, Math.round(SLOT_COOLDOWN_BAR_H * view.cooldownRatio));
        g.roundRect(x, y + h - barH, w, barH, radius).fill({ color: 0xffffff, alpha: 0.55 });
      }
      /**
       * 描边**最后画**（盖在冷却遮罩之上）：否则冷却时格子的下半边
       * 会被白色遮罩吃掉边界，四格连成一片。
       *
       * 四档都有描边（只是颜色不同）—— 它的职责是"画出这一格的**存在**"，
       * 不再承担状态语义；状态由底色的明暗说。
       */
      g.roundRect(x + inset, y + inset, w - lineW, h - lineW, radius).stroke({
        color: look.line,
        width: lineW,
      });

      s.glyph.set(this.translate(view.nameKey));
      /**
       * 技能字的颜色跟着**同一档底色**走（`SLOT_LOOKS`）。
       *
       * ⚠️ 换底色时最容易被压坏的就是这个字 —— 玩家在"买不起"时**仍然
       * 要认出这是哪个技能**，所以 `blocked` 那一档的字不是"更暗"，
       * 而是换成一个压在暗底上仍读得出的中灰（见 `PALETTE.slot.blockedGlyph`）。
       */
      s.glyph.setColor(look.glyph);
      /**
       * 图标**不再因冷却而压暗**。
       *
       * 曾经用过 alpha 0.4：那时冷却数字居中压在图标上，两层重字会打架。
       * 现在数字移到了**左下角**（需求），不再与图标重叠，
       * 而 32px 的图标是格子的主角 —— 压暗它只会让整条技能栏显得脏。
       * 冷却状态由白色遮罩 + 左下角数字表达，足够了。
       */
      /**
       * 键位提示。**触屏设备不画** ——
       *
       * 需求："移动端就不用显示快捷键信息了，无论是技能按钮还是
       * 其他的功能按钮。"
       *
       * 触屏上那些技能由右下角的圆形按钮承担，画个 `Q` / `W` 在那里
       * 只会让人以为"要按键盘"。
       */
      s.key.set(showKeyHints ? view.key.toUpperCase() : '');
      /**
       * **键位提示也要跟着状态变。**
       *
       * 踩过的坑：`s.key` 的颜色只在构造时设了一次（`0x9090a0`），
       * 之后从没更新 —— 于是技能进冷却时**按键那一侧完全没有反馈**
       * （需求："现在技能 cd 时，按键那边没有反馈了"）。
       *
       * 现在它跟技能字用同一套明暗（`SLOT_LOOKS` 的 `key` 一列）：
       *   可用   → 亮（玩家一眼知道这个键现在能按）
       *   冷却中 → 偏灰
       *   不可用 → 更暗
       */
      s.key.setColor(look.key);
      // 剩余秒数：0.1 秒精度（逻辑步长就是 0.1 秒，再细没意义）
      /**
       * 冷却剩秒**取整**。
       *
       * 早期显示到 0.1 秒（`toFixed(1)`）：一是"还剩 4.3 秒"对玩家没有
       * 额外信息量，二是那个宽度会把技能字挤掉。取整后一位数字放得下。
       */
      /**
       * 冷却秒数：**盖在技能字上**，字号用 `FONT.big`(26px) 压过它。
       *
       * 需求："按键的 cd，数字应该盖在按键 icon 上。"
       * 加描边是为了在任何底色上都读得清（白色遮罩 / 深色格子都行）。
       */
      // 实时剩余：只给数字（格子太小，`4s` 会挤掉图标）
      s.cd.set(view.cooldownRatio > 0.001 ? Math.ceil(view.cooldownSec).toString() : '');
      /**
       * 固有冷却：**只给数字**（需求："cd的单位's'，不要显示出来"）。
       *
       * 我原先给它加了 `s`，理由是"它是规格说明而不是剩余量，有单位
       * 才不会被误读"。但用户要求去掉 —— 而且格子已经够挤了，
       * 少一个字母确实更干净。位置（左下）与字号（tiny）已经足够
       * 区分"这是固有 CD"和中间那个实时数字。
       */
      s.skillCd.set(view.skillCdSec > 0 ? String(Math.round(view.skillCdSec)) : '');
      /**
       * 资源代价：数字 + **资源色**。
       *
       * 需求："用相应的颜色代表那种资源"。颜色取自 `PALETTE` 里
       * 资源条用的**同一个 base 色**，于是格子右上角的"30"和
       * 左下面板的炁条是同一个绿 —— 玩家不需要学第二套映射。
       *
       * ⚠️ 例外：**买不起**的时候压成灰（`PALETTE.slot.blockedCost`）。
       * 改之前这里无论买不买得起都画成亮的资源色 —— 于是"买不起"的
       * 格子上顶着一个最醒目的金色 `50`，"底色说断电、数字说没问题"，
       * 同一个状态两套打架的表达。
       */
      if (view.cost) {
        // 按住技带 `/s` 后缀（"3/s" = 每秒 3 点，不是一共 3 点）
        s.cost.set(`${Math.round(view.cost.value)}${view.cost.suffix ?? ''}`);
        s.cost.setColor(
          look.costDimmed ? PALETTE.slot.blockedCost : RESOURCE_COLORS[view.cost.resource],
        );
      } else {
        s.cost.set('');
      }
    }
  }
}

/**
 * 派生技的显示矩形：**源技能格的正上方**，缩到 70%。
 *
 * 需求："键盘派生技能显示在原技能的上方。"
 *
 * ⚠️ 缩到 70% 是为了视觉上"挂在"源技能上（而不是像一个独立槽位）——
 * 玩家一眼能看出它是从下面那个技能派生出来的。
 *
 * ⚠️ 找不到源槽位时**退回原矩形**：宁可画在自己位置上，
 * 也不要画到画布外或跟别人重叠。
 */
function derivedRect(
  own: { x: number; y: number; w: number; h: number },
  sourceKey: string,
  skills: readonly SkillSlotView[],
): { x: number; y: number; w: number; h: number } {
  const sourceIndex = skills.findIndex(
    (s) => s.derivedFrom === undefined && s.key === sourceKey,
  );
  if (sourceIndex < 0) return own;
  const source = skillSlotRect(sourceIndex, Math.min(skills.length, LAYOUT.skillBar.max), 1);
  const size = Math.round(own.w * 0.7);
  return {
    x: source.x + Math.round((source.w - size) / 2),
    y: source.y - size - 4,
    w: size,
    h: size,
  };
}
