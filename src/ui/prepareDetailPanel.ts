/**
 * **备战屏右侧的详情区**：显示"当前选择框所在"的那一项（人物 / 炁机 / Boss）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把 `prepareDetail.detailModelOf()` 算出来的**清单**画成一块面板：
 * 标题 + 大头像（或图标占位）+ 若干行文字 / 技能说明。
 *
 * ==================================================================
 * ⚠️ 每帧只改字符串与可见性，**不重建** Text / Graphics
 * ==================================================================
 *
 * 这是 `SkillDetail` 立下的规矩（也是 AGENTS.md 的硬约束）：Pixi 的
 * `Text.text` setter 会重建内部 canvas 纹理，`new Text()` 更是每帧
 * 分配一个 GPU 纹理。所以：
 *
 *   - 面板底板 / 分隔线 = **一个** `Graphics`，每帧 `clear()` 重画（便宜）
 *   - 每一行 = 一对**预先建好的** `Label`（名字 + 说明），只在文字真变了
 *     时写进去（`Label.set` 自己会跳过同值）
 *   - 屏外的行 = `visible = false`（**不销毁**）
 *
 * 池子大小 `DETAIL_ROW_POOL` 是一个编译期常量：模型里的行数超过它就是
 * "详情区该改成可滚"的信号（今天最多：Boss 4 招 + 1 行标题 = 5）。
 *
 * ==================================================================
 * ⚠️ 溢出：先**整体上移**（`contentShift`），再退化成"不显示"
 * ==================================================================
 *
 * 内容比视口高时，本组件把行画进一个**可整体位移的子容器**里，并把
 * 第一行的 y 往上挪 `overflow`（"末尾优先"）—— 那是 `QijiSelectScreen`
 * 已有的做法，比在 jsdom 里跑遮罩可靠。
 *
 * ⚠️ **不做拖拽 / 滚轮滚动**（与选炁机屏一致）：详情区是**查看**用的，
 * 而它里面最长的内容是 Boss 的 4 条招式说明 —— 溢出时"末尾优先"已经
 * 保证**总能读到最后一招**（最早那一招被推到面板上缘之外）。
 * 真需要滚动时按 `scrollWindow` 那套加（`SkillDetail` 是范例）。
 */

import type { Container, Graphics } from 'pixi.js';
import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_SKIN } from './prepareRender';
import { detailRect, PREPARE_LAYOUT } from './prepareLayout';
import type { DetailModel, DetailRow } from './prepareDetail';
import { PORTRAITS, portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import type { TranslateFn } from '../i18n/translator';

/* ------------------------------------------------------------------ *
 * 度量
 * ------------------------------------------------------------------ */

/**
 * 行池大小。
 *
 * ⚠️ **不是一个"够用就好"的魔法数**，而是"这一屏最多会有几行"的上界：
 * Boss 详情是 `1 行标题 + 4 条招式 = 5`，炁机是 `3 行`，人物是
 * `1 + 技能数`（今天最多 5 招 → 6）。取 **12** 留一倍余量。
 * ⚠️ 超过它的模型会被**截断**（多出来的行不画）—— 那是有意的降级
 * （宁可少显示，也不每帧新建 Label）。
 */
const DETAIL_ROW_POOL = 12;

/** 详情区的行距 / 内边距（逻辑像素）。 */
const METRICS = {
  /** 标题字号（比正文大一号）。 */
  titleSize: 20,
  /** 说明字号。 */
  bodySize: FONT.small,
  /** 名字 / 标签字号。 */
  nameSize: FONT.body,
  /** 一行标题的行高。 */
  titleLine: 26,
  /** 一条技能：名字行 + 说明行。 */
  nameLine: 19,
  bodyLine: 17,
  /** 行与行之间的空。 */
  rowGap: 6,
  /** 标题下、正文上的分隔线离标题底的距离。 */
  ruleGap: 6,
} as const;

/**
 * 详情区里那张脸的显示边长（比卡片上的 `portraitBox` 大得多）。
 *
 * ⚠️ 只由**详情区的宽度**决定（与 `x` 无关）：`w` 是面板的内宽，
 * 而"脸多大"是那一块自己的比例。把 `x` 也拉进来算过一次，结果是
 * 面板一挪位、脸就跟着变大变小。
 */
function portraitBoxOf(innerW: number): number {
  return Math.max(48, Math.min(88, Math.floor(innerW * 0.42)));
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

/** 一行文字在池子里的两个 Label（名字 / 说明）。 */
interface RowLabels {
  readonly name: Label;
  readonly body: Label;
}

export class PrepareDetailPanel {
  readonly root: Container;

  private readonly gfx: Graphics;
  /** 可整体位移的内容层（见文件头"溢出"那段）。 */
  private readonly content: Container;

  private readonly title: Label;
  private readonly subtitle: Label;
  private readonly placeholder: Label;
  /** 大头像（人物 / Boss）。炁机没有素材，用图标占位块。 */
  private readonly portrait: PortraitSprite | undefined;
  private readonly iconBox: Graphics;
  private readonly iconGlyph: Label;

  private readonly rows: RowLabels[] = [];


  /**
   * 详情区当前显示的是**哪一项**（`kind:id`）。换了它就**把滚动归零**：
   * 停在「傲慢」第二招上时把光标移到「嫉妒」，不该继续显示第 200 行。
   */
  private lastTargetId: string | undefined;
  /**
   * 当前标题的 i18n key。
   *
   * ⚠️ 用途只有一个：判"某一行技能的名字**与标题重复**"（炁机的说明就是
   * 这种情况 —— 标题已经是「固本培元」，不该在下面再画一遍）。
   */
  private lastTitleKey: string | undefined;
  /** 当前滚动位置（逻辑像素；0 = 顶部）。 */
  private scroll = 0;
  /** 可滚动的最大值（内容底边 − 视口底边；0 = 不用滚）。 */
  private maxScroll = 0;
  /** 右侧那条滚动条（只有真能滚时才画）。 */
  private readonly scrollBar: Graphics;

  constructor(pixi: PixiCtor, private readonly translate: TranslateFn) {
    const rect = detailRect();
    this.root = new pixi.Container();

    this.gfx = new pixi.Graphics();
    this.content = new pixi.Container();
    this.scrollBar = new pixi.Graphics();
    this.root.addChild(this.gfx, this.content, this.scrollBar);

    const innerX = rect.x + PREPARE_LAYOUT.detailPad;
    const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;

    this.title = new Label(pixi, {
      x: innerX,
      y: rect.y + PREPARE_LAYOUT.detailPad,
      size: METRICS.titleSize,
      color: PALETTE.text,
      kai: true,
      wrap: { width: innerW },
    });
    this.subtitle = new Label(pixi, {
      x: innerX,
      y: rect.y + PREPARE_LAYOUT.detailPad + METRICS.titleLine,
      size: METRICS.bodySize,
      color: PALETTE.textDim,
      wrap: { width: innerW },
    });
    this.placeholder = new Label(pixi, {
      x: innerX,
      y: rect.y + rect.h / 2,
      size: FONT.body,
      color: PALETTE.textFaint,
      wrap: { width: innerW },
    });

    /** 人物 / Boss 的大头像（复用卡片上那颗的素材表）。 */
    const firstPlayer = PORTRAITS[0];
    this.portrait =
      firstPlayer === undefined
        ? undefined
        : new PortraitSprite(pixi, this.content, firstPlayer, portraitBoxOf(innerW));

    this.iconBox = new pixi.Graphics();
    this.iconGlyph = new Label(pixi, {
      x: 0,
      y: 0,
      size: METRICS.titleSize,
      color: PALETTE.text,
      anchorX: 0.5,
      anchorY: 0.5,
      kai: true,
    });
    this.content.addChild(this.iconBox, this.iconGlyph.root);

    for (let i = 0; i < DETAIL_ROW_POOL; i += 1) {
      const name = new Label(pixi, {
        x: innerX,
        y: 0,
        size: METRICS.nameSize,
        color: PALETTE.text,
        wrap: { width: innerW },
      });
      const body = new Label(pixi, {
        x: innerX,
        y: 0,
        size: METRICS.bodySize,
        color: PALETTE.textDim,
        wrap: { width: innerW },
      });
      this.rows.push({ name, body });
      this.content.addChild(name.root, body.root);
    }

    /**
     * ⚠️ **标题与副标题挂在 `content` 上**（它们跟着滚动条一起上移）；
     * 而占位那句挂在 `root` 上 —— "把光标移到卡片上"这句提示**不该跟着
     * 内容滚**。
     *
     * ⚠️⚠️ 这一句**曾经被我漏掉**（改占位那段时把 `addChild` 一起删了），
     * 而症状是**最难查的那一类**：画面照常出、招式列表照常出，
     * **只有标题与「生命上限 150」两行不见了** —— 因为没进显示列表的
     * `Label` 既不报错、也不占位。靠 `detailModel()` 探针比对"模型里有
     * 副标题"与"画面上没有"才把它揪出来（截图只看得出"少了一行"，
     * 看不出是数据没了还是没挂上去）。
     */
    this.content.addChild(this.title.root, this.subtitle.root);
    this.root.addChild(this.placeholder.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.content.visible = visible;
  }

  /**
   * 画一帧。
   *
   * @param model 当前该显示什么（`undefined` = 没有聚焦项 → 画占位）
   */
  update(model: DetailModel | undefined): void {
    /**
     * ⚠️ 这里**不做"模型没变就跳过"的短路**：`Label.set` 自己会跳过同值
     * （不重建纹理），而模型是**每帧新造的纯数据**（`detailModelOf`），
     * 按引用比较永远为假 —— 加一个永远不成立的短路只会让人以为它省了什么。
     */
    /**
     * ⚠️ **换了聚焦项就把滚动归零**（而不是保留）：玩家看的是"这一项"的
     * 详情，停在上一项的第三行上会让新那一项**从中间开始显示**。
     */
    const targetId = model === undefined ? undefined : `${model.kind}:${model.id}`;
    if (targetId !== this.lastTargetId) {
      this.lastTargetId = targetId;
      this.scroll = 0;
    }
    const rect = detailRect();
    const innerX = rect.x + PREPARE_LAYOUT.detailPad;
    const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;

    this.drawFrame(rect);

    if (model === undefined) {
      this.placeholder.set(this.translate('roster.ui.detail.empty'));
      this.placeholder.root.x = innerX;
      this.placeholder.root.y = rect.y + rect.h / 2 - 12;
      this.placeholder.root.visible = true;
      this.title.root.visible = false;
      this.subtitle.root.visible = false;
      this.setImage(undefined, innerX, innerW);
      for (const row of this.rows) {
        row.name.root.visible = false;
        row.body.root.visible = false;
      }
      this.scrollBar.clear();
      return;
    }

    this.placeholder.root.visible = false;
    this.title.root.visible = true;
    this.lastTitleKey = model.titleKey;
    this.title.set(this.translate(model.titleKey));
    this.title.setColor(PREPARE_SKIN.selectionText);

    const imageBox = this.setImage(model, innerX, innerW);
    let y = imageBox;

    if (model.subtitle === undefined) {
      this.subtitle.root.visible = false;
    } else {
      this.subtitle.root.visible = true;
      this.subtitle.set(this.textOf(model.subtitle));
      this.subtitle.setColor(PALETTE.textDim);
      this.subtitle.root.x = innerX;
      this.subtitle.root.y = y;
      y += METRICS.bodyLine + METRICS.rowGap;
    }

    /** 分隔线：标题区与正文之间的那道（画在 gfx 上，不新开对象）。 */
    this.gfx
      .moveTo(innerX, y - METRICS.rowGap / 2)
      .lineTo(innerX + innerW, y - METRICS.rowGap / 2)
      .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.6 });

    y = this.drawRows(model.rows, y, innerX, innerW);
    this.shiftContent(rect, y);
    this.drawScrollBar(rect);
  }

  /* ---------------------------------------------------------------- *
   * 内部：面板底板
   * ---------------------------------------------------------------- */

  private drawFrame(rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): void {
    this.gfx.clear();
    this.gfx
      .roundRect(rect.x, rect.y, rect.w, rect.h, 4)
      .fill({ color: PALETTE.panel, alpha: 0.7 });
    this.gfx
      .roundRect(rect.x, rect.y, rect.w, rect.h, 4)
      .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.8 });
    /**
     * ⚠️ 这块区域**不接收指针**：它是纯展示，而鼠标划过它时不该把
     * 卡片的光标 / 悬停状态弄丢（`PrepareScreen.hitTest` 也不会命中它，
     * 因为命中区只有卡片与开始键）。
     */
    this.gfx.eventMode = 'none';
  }

  /* ---------------------------------------------------------------- *
   * 内部：头像 / 图标
   * ---------------------------------------------------------------- */

  /**
   * 画头像（或炁机的图标占位），返回**图片区底边的 y**。
   *
   * ⚠️ 人物的头像素材来自 `render/portraitAssets.ts`；**没配对的人**
   * （将来新加的角色）与**所有炁机**都走程序化占位 —— 炁机的 `icon`
   * 名（`char_dodge` 那些）今天**不在 `render/icons.ts` 的 SVG 表里**，
   * 所以不能假装画得出来（那会静默显示成空）。
   */
  private setImage(model: DetailModel | undefined, innerX: number, innerW: number): number {
    const rect = detailRect();
    const box = portraitBoxOf(innerW);
    const top = rect.y + PREPARE_LAYOUT.detailPad + METRICS.titleLine + METRICS.bodyLine + METRICS.rowGap * 2;
    /** 占位方块：与头像同尺寸的一圈虚线感描边（画在 `content` 里）。 */
    this.iconBox.clear();

    if (model === undefined) {
      this.portrait?.setVisible(false);
      this.iconGlyph.root.visible = false;
      return top;
    }

    const asset = model.portraitId === undefined ? undefined : portraitFor(model.portraitId);
    if (asset !== undefined && this.portrait !== undefined) {
      /**
       * ⚠️ **换脸**（光标从一个人移到另一个人）：`setAsset` 自己会判"同一张
       * 就不重载"，所以这里无条件调它 —— 让"该不该重载"只留一处判据。
       */
      this.portrait.setAsset(asset);
      this.portrait.setVisible(true);
      this.portrait.root.x = innerX + box / 2;
      this.portrait.root.y = top + box / 2;
      this.iconBox.visible = false;
      this.iconGlyph.root.visible = false;
      return top + box + METRICS.rowGap * 2;
    }

    this.portrait?.setVisible(false);
    /**
     * 炁机 / 无名角色的图标位：一块描边方块 + **名字的第一个字**。
     * ⚠️ 用名字首字而不是空方块：空方块读起来像"图片挂了"。
     */
    this.iconBox.visible = true;
    this.iconBox
      .roundRect(innerX, top, box, box, 4)
      .fill({ color: PALETTE.bgTop, alpha: 0.6 });
    this.iconBox
      .roundRect(innerX, top, box, box, 4)
      .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.9 });
    this.iconGlyph.root.visible = true;
    this.iconGlyph.set(this.translate(model.titleKey).slice(0, 1));
    this.iconGlyph.root.x = innerX + box / 2;
    this.iconGlyph.root.y = top + box / 2;
    return top + box + METRICS.rowGap * 2;
  }

  /* ---------------------------------------------------------------- *
   * 内部：正文行
   * ---------------------------------------------------------------- */

  /** 画正文行，返回内容底边的 y。 */
  private drawRows(rows: readonly DetailRow[], startY: number, innerX: number, _innerW: number): number {
    let y = startY;
    this.rows.forEach((slot, i) => {
      const row = rows[i];
      if (row === undefined) {
        slot.name.root.visible = false;
        slot.body.root.visible = false;
        return;
      }
      if (row.kind === 'skill') {
        /**
         * ⚠️ **名字与面板标题重复时不画名字**（炁机的说明就是这种情况：
         * 标题已经是「固本培元」，再画一行「固本培元」再接说明会让同一屏
         * 出现两次同一个词 —— 截图上实测很刺眼）。
         */
        const repeated = row.nameKey === this.lastTitleKey;
        slot.name.root.visible = !repeated;
        if (!repeated) {
          slot.name.set(this.translate(row.nameKey));
          slot.name.setColor(PALETTE.text);
          slot.name.root.x = innerX;
          slot.name.root.y = y;
          y += METRICS.nameLine;
        }
        /**
         * ⚠️ 说明文字**必须**带参数（`descParams`）：Boss 的说明里有
         * `{cast}` / `{damage}` 这些占位符，漏了就会把它们原样显示
         * （本仓库为这个形状专门收窄过 `TranslateFn`）。
         */
        if (row.descKey === undefined) {
          slot.body.root.visible = false;
        } else {
          slot.body.root.visible = true;
          slot.body.set(this.translate(row.descKey, row.descParams));
          slot.body.setColor(PALETTE.textDim);
          slot.body.root.x = innerX;
          slot.body.root.y = y;
          y += this.estimateLines(slot.body) * METRICS.bodyLine;
        }
      } else if (row.kind === 'kv') {
        slot.name.root.visible = true;
        slot.name.set(this.translate(row.labelKey));
        slot.name.setColor(PALETTE.textDim);
        slot.name.root.x = innerX;
        slot.name.root.y = y;
        slot.body.root.visible = true;
        slot.body.set(row.value);
        slot.body.setColor(PALETTE.text);
        slot.body.root.x = innerX;
        slot.body.root.y = y + METRICS.nameLine;
        y += METRICS.nameLine + METRICS.bodyLine;
      } else {
        slot.name.root.visible = true;
        slot.name.set(this.textOf(row));
        slot.name.setColor(row.dim === true ? PALETTE.textDim : PALETTE.text);
        slot.name.root.x = innerX;
        slot.name.root.y = y;
        slot.body.root.visible = false;
        y += this.estimateLines(slot.name) * METRICS.bodyLine;
      }
      y += METRICS.rowGap;
    });
    return y;
  }

  private textOf(row: DetailRow): string {
    if (row.kind === 'text') return this.translate(row.key, row.params);
    if (row.kind === 'kv') return row.value;
    return this.translate(row.nameKey);
  }

  /**
   * 折了几行（**估算**）。
   *
   * ⚠️ 为什么估算而不是 `getBounds()`：Pixi 的测量在 jsdom 里跑不动
   * （`PrepareScreen` 与 `prepareRender` 都因为同一条纪律把逻辑抽出去
   * 了）。这里要的只是**行高**，而中文是方块字 —— `字数 / 每行字数`
   * 对它是够准的下界。用 `ceil` 而不是 `round`：宁可多留一行空，
   * 也不让两行文字叠在一起。
   */
  private estimateLines(label: Label): number {
    const text = label.root.text;
    if (text.length === 0) return 0;
    const width = label.root.style.wordWrapWidth;
    const perLine = Math.max(1, Math.floor(width / METRICS.bodySize));
    return Math.max(1, Math.ceil(text.length / perLine));
  }

  /* ---------------------------------------------------------------- *
   * 内部：溢出
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * 内部：滚动
   * ---------------------------------------------------------------- */

  /**
   * 滚轮 / 拖拽滚 **delta 像素**（触屏没有滚轮，拖拽那条路见 `pointerDrag`）。
   *
   * @returns 有没有真的动（调用方据此决定要不要重画）。
   */
  scrollBy(delta: number): boolean {
    if (this.maxScroll <= 0) return false;
    const next = Math.max(0, Math.min(this.scroll + delta, this.maxScroll));
    if (next === this.scroll) return false;
    this.scroll = next;
    return true;
  }

  /**
   * 这个逻辑点是不是落在**内容视口**里（拖拽要在里面才算"滚详情"）。
   */
  isOnDetail(px: number, py: number): boolean {
    const rect = detailRect();
    return (
      this.maxScroll > 0 &&
      px >= rect.x &&
      px <= rect.x + rect.w &&
      py >= rect.y &&
      py <= rect.y + rect.h
    );
  }

  /** 右侧那条滚动条（只有真能滚时才画）。 */
  private drawScrollBar(rect: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }): void {
    this.scrollBar.clear();
    if (this.maxScroll <= 0) return;
    const trackX = rect.x + rect.w - 5;
    const trackTop = rect.y + PREPARE_LAYOUT.detailPad;
    const trackH = rect.h - PREPARE_LAYOUT.detailPad * 2;
    const viewH = trackH;
    const total = trackH + this.maxScroll;
    const thumbH = Math.max(24, Math.round((viewH / total) * trackH));
    const progress = this.maxScroll === 0 ? 0 : this.scroll / this.maxScroll;
    const thumbY = trackTop + Math.round((trackH - thumbH) * progress);
    this.scrollBar
      .roundRect(trackX, trackTop, 3, trackH, 1.5)
      .fill({ color: PALETTE.panelLine, alpha: 0.35 });
    this.scrollBar
      .roundRect(trackX, thumbY, 3, thumbH, 1.5)
      .fill({ color: PALETTE.textDim, alpha: 0.9 });
  }

  /**
   * 内容比视口高时，按 `scroll` 把**整层上移**（而不是"末尾优先"）。
   *
   * ==================================================================
   * ⚠️ 为什么从"末尾优先"改成"可滚"（实测逼出来的）
   * ==================================================================
   *
   * 第一版是"溢出就把整层顶到末尾"（`QijiSelectScreen` 的做法）：
   * 内容底边对齐视口底边。可是**详情区的头两行（标题 / 生命上限）会被
   * 顶出面板**——实测「色欲」那四条招式说明一进来，**「生命上限 420」
   * 就看不见了**，而那一行是"这个 Boss 多硬"的唯一线索。
   *
   * 现在的窗口是 `[scroll, scroll + viewH]`，`scroll` 由四种输入改：
   * 滚轮 / 拖拽 / ↑↓ 之外的**翻页键**（`PageUp` / `PageDown`）/
   * 以及"换了聚焦项 → 归零"（见 `update`）。
   *
   * ⚠️ 触屏没有滚轮（AGENTS.md §3b）：拖拽那条路是**必须**的，不是补充。
   * 它走 `SettingsPanel` 已有的入口模式（`canvasInput` 在 `pointermove`
   * 时转发）—— 不自己挂 `window` 监听器。
   */
  private shiftContent(rect: { readonly y: number; readonly h: number }, contentBottom: number): void {
    const viewH = rect.h - PREPARE_LAYOUT.detailPad * 2;
    const maxScroll = Math.max(0, contentBottom - rect.y - PREPARE_LAYOUT.detailPad - viewH);
    this.maxScroll = maxScroll;
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    this.content.y = -this.scroll;
  }
}
