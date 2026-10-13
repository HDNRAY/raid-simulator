/**
 * **备战屏右侧的详情区**：显示"当前选择框所在"的那一项（人物 / 炁机 / Boss）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把 `prepareDetail.detailModelOf()` 算出来的**清单**画成一块面板：
 * **顶部一条**（名字 + 关键数值 + 头像位）+ 若干行文字 / 技能说明。
 *
 * ==================================================================
 * ⚠️ 2026-10-13：顶部改成**一条**（用户："详情页右上角是空的"）
 * ==================================================================
 *
 * 旧版是"标题在左上、头像在它下面、生命上限夹在中间"—— 于是**右上角整块
 * 是空的**，而"这个 Boss 多硬"那一行（生命上限）被埋在头像下面。
 *
 * 现在三类共用**同一条顶栏**：左边一列文字（名字 + 关键数值），右边一个
 * **方框**（人物 = 对话头像，炁机 / Boss = 名字首字的程序化占位）。
 * 于是"右上角"由那个方框占住，而**生命上限就在名字正下方、亮色加粗**
 * （用户："血量要显眼"）。
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
import { PREPARE_LAYOUT } from './prepareLayout';
import { detailRect } from './prepareGeometry';
import type { DetailModel, DetailRow } from './prepareDetail';
import { PORTRAITS, portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import { pixelViewport, scrollThumbRatio, visibleWindow } from './scrollWindow';
import {
  DETAIL_ROW_POOL,
  METRICS,
  bodyTopOf,
  headerBandOf,
  inlineSpan,
  portraitBoxOf,
  textSpanOf,
} from './prepareDetailMetrics';
import type { TextSpan } from './prepareDetailMetrics';
import type { TranslateFn } from '../i18n/translator';

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
  /**
   * **正文行**那一层（只有它跟着滚动走）。
   *
   * ⚠️ 顶栏（标题 + 关键数值）**不在这里** —— 用户 2026-10-13 报过
   * "详情区顶栏随内容滚动会滚出面板"，修法就是把顶栏**钉在面板顶部**、
   * 只让正文滚（见 `update` 里那段说明）。
   */
  private readonly rowsLayer: Container;

  private readonly title: Label;
  private readonly subtitle: Label;
  private readonly placeholder: Label;
  /** 大头像（人物 / Boss）。 */
  private readonly portrait: PortraitSprite | undefined;

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
  /**
   * **正文视口**的顶边与该滚多少 —— 它从**顶栏下缘**开始（顶栏钉在面板
   * 顶部，不参与滚动，见 `update`）。
   *
   * ⚠️ 这几个数由 `update` 每帧写一次（顶栏高度取决于当前这一项的方框
   * 大小，所以必须每帧算，不能在构造时定死）。
   */
  private bodyTop = 0;
  /** 正文视口的高。 */
  private bodyViewH = 0;
  /** 正文的**行距上界**（估算用：一条 `skill` 最多名 19 + 说明 17 + 空 6）。 */
  private readonly rowStep = METRICS.nameLine + METRICS.bodyLine + METRICS.rowGap;
  /** 右侧那条滚动条（只有真能滚时才画）。 */
  private readonly scrollBar: Graphics;

  constructor(pixi: PixiCtor, private readonly translate: TranslateFn) {
    const rect = detailRect();
    this.root = new pixi.Container();

    this.gfx = new pixi.Graphics();
    this.rowsLayer = new pixi.Container();
    this.scrollBar = new pixi.Graphics();
    this.root.addChild(this.gfx, this.rowsLayer, this.scrollBar);

    const innerX = rect.x + PREPARE_LAYOUT.detailPad;
    const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;
    /**
     * ⚠️ 顶栏的标签按**最宽的那一类**建（人物 / Boss 要给方框让位），
     * 而"这一帧要不要占那么宽"由 `textSpanOf` 每帧给 —— 所以 `wrap`
     * 的宽度取**不让位**的那一份（整条内宽）。
     *
     * ⚠️ 为什么不让位的那一份也能用于"让位"的情形：让位只影响**折行
     * 位置**，而顶栏的名字 / 数值都是**短句**（「林晚风」「生命上限
     * 420」「固本培元」「层数 2 / 3」）—— 它们一行就完，折行宽度取宽
     * 的那一份不会把让位那一类的标题挤到方框上（≤ 8 个字 × 20px = 160
     * < 内宽 − 方框 − 间距）。
     */
    this.title = new Label(pixi, {
      x: innerX,
      y: 0,
      size: METRICS.titleSize,
      color: PALETTE.text,
      kai: true,
      wrap: { width: innerW },
    });
    this.subtitle = new Label(pixi, {
      x: innerX,
      y: 0,
      size: METRICS.valueSize,
      color: PALETTE.text,
      /**
       * ⚠️ **加粗**：这一行是"玩家最想看的那个数"（用户："血量要显眼"）。
       * 字号已经比正文大一档，再加粗与正文拉开层级。
       */
      bold: true,
      wrap: { width: innerW },
    });
    this.placeholder = new Label(pixi, {
      x: innerX,
      y: rect.y + rect.h / 2,
      size: FONT.body,
      color: PALETTE.textFaint,
      wrap: { width: innerW },
    });

    /** 人物 / Boss 的大头像（复用卡片上那颗的素材表），摆在顶栏**右端**。 */
    const firstPlayer = PORTRAITS[0];
    this.portrait =
      firstPlayer === undefined
        ? undefined
        : new PortraitSprite(pixi, this.rowsLayer, firstPlayer, portraitBoxOf(innerW));

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
      this.rowsLayer.addChild(name.root, body.root);
    }

    /**
     * ⚠️⚠️ **顶栏挂在 `root` 上、正文挂在 `rowsLayer` 上** —— 这是
     * "顶栏固定在面板顶部，只让内容滚"那个修法的全部内容。
     *
     * 这一句**曾经被漏掉过一次**（改占位那段时把 `addChild` 一起删了），
     * 而症状是**最难查的那一类**：画面照常出、招式列表照常出，
     * **只有标题与「生命上限 150」两行不见了** —— 因为没进显示列表的
     * `Label` 既不报错、也不占位。靠 `detailModel()` 探针比对"模型里有
     * 副标题"与"画面上没有"才把它揪出来（截图只看得出"少了一行"，
     * 看不出是数据没了还是没挂上去）。
     */
    this.root.addChild(this.title.root, this.subtitle.root, this.placeholder.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.rowsLayer.visible = visible;
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
      this.portrait?.setVisible(false);
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
    /**
     * ⚠️ 标题 / 关键数值 / 头像位**都摆在顶栏那一条里**（三类共用这一条，
     * 但**有没有右边的方框**按类分，见 `headerBoxOf`）：文字块垂直居中、
     * 方框贴右端。
     *
     * ⚠️⚠️ 它们**钉在 `rect` 上**（不跟着 `scroll` 走）：修的就是用户报的
     * "详情区顶栏随内容滚动会滚出面板"—— 旧版把标题 / 副标题塞进那个会
     * 整体上移的内容层里，于是招式一多，"生命上限"这一行就被顶出去了。
     */
    const span = textSpanOf(model.kind, rect);
    const band = headerBandOf(model.kind, rect);
    this.title.root.x = span.x;
    this.title.root.y = Math.round(band.top + (band.h - band.textH) / 2);
    this.subtitle.root.x = span.x;
    this.subtitle.root.y = this.title.root.y + METRICS.titleLine;
    this.placeImage(model, span, band);

    /** 正文从**顶栏下缘**开始 —— 分隔线画在那条分界上（见 `bodyTopOf`）。 */
    const bodyTop = bodyTopOf(model.kind, rect);

    if (model.subtitle === undefined) {
      this.subtitle.root.visible = false;
    } else {
      this.subtitle.root.visible = true;
      this.subtitle.set(this.textOf(model.subtitle));
      /**
       * ⚠️ **亮色**（旧版是 `textDim`）：这一行是"血量 / 层数"这类关键
       * 数值，压暗之后它在一条里读不出重点（用户："血量要显眼"）。
       */
      this.subtitle.setColor(PALETTE.text);
    }

    /** 分隔线：顶栏与正文之间的那道（画在 gfx 上，不新开对象）。 */
    this.gfx
      .moveTo(innerX, bodyTop - METRICS.rowGap / 2)
      .lineTo(innerX + innerW, bodyTop - METRICS.rowGap / 2)
      .stroke({ color: PALETTE.panelLine, width: 1, alpha: 0.6 });

    const contentBottom = this.drawRows(model.rows, bodyTop, inlineSpan(innerX, innerW));
    this.shiftContent(rect, bodyTop, contentBottom);
    this.drawScrollBar(rect, bodyTop);
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
   * 把**头像**摆到顶栏的右端（只有人物 / Boss 有素材）。
   *
   * ⚠️ 人物的头像素材来自 `render/portraitAssets.ts`；**没配对的人**
   * （将来新加的角色）与**所有炁机 / Boss** 没有素材。
   *
   * ==================================================================
   * ⚠️ 2026-10-13 第三轮：炁机的**图标占位块整块删掉**
   * ==================================================================
   *
   * 用户原话："**炁机暂时不要 icon**"。
   *
   * 旧版给"没有素材"的那两类画一块 88×88 的描边方块 + 名字首字 —— 那
   * **就是**一个图标槽（`headerBoxOf` 现在让它等于 0，所以 `box === 0`
   * 这一条分支同时覆盖"炁机"与"**任何宽度为 0 的方框**"）。
   *
   * ⚠️ 为什么连 Boss 的占位块也一起收掉了：用户要的是"不要 icon"，
   * 而 Boss 今天**同样没有素材** —— 于是它也走这一条。Boss 那 88px 的
   * 空洞（一个孤零零的"傲"字）换成了整条宽度的标题 + 关键数值，
   * 这正是"收掉 icon 槽、别留空洞"。
   *
   * 🚧 将来给某个 Boss 配了头像素材，它会自动走上面的"真头像"分支
   * （`portraitFor(portraitId)` 有值）。
   */
  private placeImage(
    model: DetailModel | undefined,
    span: TextSpan,
    band: { readonly top: number; readonly h: number; readonly box: number },
  ): void {
    const box = band.box;
    const asset =
      model === undefined || model.portraitId === undefined
        ? undefined
        : portraitFor(model.portraitId);
    if (box <= 0 || asset === undefined || this.portrait === undefined) {
      this.portrait?.setVisible(false);
      return;
    }
    /**
     * ⚠️ 方框**贴内区右端**：`span.x + span.w` 是**文字**的右边界，
     * 而文字在"有方框"的那一类里已经缩到 `内宽 − 方框 − 间距`，
     * 所以右端 = `span.x + span.w + 间距 + 方框`（见 `textSpanOf`）。
     */
    const boxX = span.x + span.w + METRICS.rowGap;
    const centerY = band.top + band.h / 2;
    /**
     * ⚠️ **换脸**（光标从一个人移到另一个人）：`setAsset` 自己会判"同一张
     * 就不重载"，所以这里无条件调它 —— 让"该不该重载"只留一处判据。
     */
    this.portrait.setAsset(asset);
    this.portrait.setVisible(true);
    this.portrait.root.x = boxX + box / 2;
    this.portrait.root.y = centerY;
  }

  /* ---------------------------------------------------------------- *
   * 内部：正文行
   * ---------------------------------------------------------------- */

  /**
   * 画正文行，返回**摊开来**的内容底边 y（不含 `rowGap`）。
   *
   * ==================================================================
   * ⚠️ 分两步：先算"每一行在内容坐标里的位置"，再**只摆可见的那些**
   * ==================================================================
   *
   * 第一步与滚动无关（行的位置由内容决定），第二步读 `scroll` —— 于是
   * "内容有多高"与"现在看得见哪一段"是两件事，不会互相污染（这正是
   * `scrollWindow` 把 `count` 与 `offset` 分开的理由）。
   *
   * ⚠️ 只有**落在视口里**的行会被摆出来：第一行只在 `scroll === 0` 时
   * 显示，而最后一行只在滚到底时显示 —— 与复盘 / 设置页技能详情**同一份
   * 边界规则**（`scrollWindow.visibleWindow`）。
   */
  private drawRows(rows: readonly DetailRow[], startY: number, span: TextSpan): number {
    let y = startY;
    const placed: {
      readonly slot: RowLabels;
      readonly nameTop: number;
      readonly bodyTop: number;
    }[] = [];
    this.rows.forEach((slot, i) => {
      const row = rows[i];
      if (row === undefined) {
        slot.name.root.visible = false;
        slot.body.root.visible = false;
        return;
      }
      /** ⚠️ 这一行**在内容坐标里**的 y（`placeRows` 之后就不能再读了）。 */
      const nameTop = y;
      let bodyContentTop = y;
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
          slot.name.root.x = span.x;
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
          slot.body.root.x = span.x;
          bodyContentTop = y;
          slot.body.root.y = y;
          y += this.estimateLines(slot.body) * METRICS.bodyLine;
        }
      } else if (row.kind === 'kv') {
        slot.name.root.visible = true;
        slot.name.set(this.translate(row.labelKey));
        slot.name.setColor(PALETTE.textDim);
        slot.name.root.x = span.x;
        slot.name.root.y = y;
        slot.body.root.visible = true;
        slot.body.set(row.value);
        slot.body.setColor(PALETTE.text);
        slot.body.root.x = span.x;
        bodyContentTop = y + METRICS.nameLine;
        slot.body.root.y = bodyContentTop;
        y += METRICS.nameLine + METRICS.bodyLine;
      } else {
        slot.name.root.visible = true;
        slot.name.set(this.textOf(row));
        slot.name.setColor(row.dim === true ? PALETTE.textDim : PALETTE.text);
        slot.name.root.x = span.x;
        slot.name.root.y = y;
        slot.body.root.visible = false;
        y += this.estimateLines(slot.name) * METRICS.bodyLine;
      }
      y += METRICS.rowGap;
      placed.push({ slot, nameTop, bodyTop: bodyContentTop });
    });
    this.placeRows(placed);
    return y - METRICS.rowGap;
  }

  /**
   * 按 `scroll` 把**可见的那些行**摆到面板上（顶栏那一条**不动**）。
   *
   * ⚠️ 行是**按绝对内容坐标算好**再平移的（`top − scroll + 视口顶`）：
   * 于是"滚到一半"时某一行停在半途，而不是跳一整行 —— 手指 / 滚轮给的是
   * 连续位移，跳行会让它看起来卡顿。
   *
   * ⚠️ 每个槽位的**显隐**由"内容说它该不该画"（`visible`，见上）与
   * "它在不在视口里"两个条件**一起**决定：只看后者的话，被裁掉的那几行
   * （`rows` 数组短于槽位数）会带着上一帧的字重新出现。
   */
  private placeRows(
    placed: readonly {
      readonly slot: RowLabels;
      /** 内容坐标：名字那一行的 y。 */
      readonly nameTop: number;
      /** 内容坐标：说明 / 值那一行的 y（没有第二行时 = `nameTop`）。 */
      readonly bodyTop: number;
    }[],
  ): void {
    const viewRows = Math.max(1, Math.ceil(this.bodyViewH / this.rowStep));
    const shown = new Set(visibleWindow(placed, this.scroll, viewRows));
    /**
     * ⚠️ **绝对赋值**（`= 内容 y − scroll + 视口顶`）而不是 `+= dy`：
     * `drawRows` 每帧都会把内容 y 重新算进 `root.y`，再累加就会每帧漂
     * 一个 `dy`（画面上的表现是"越滚越快"）。
     */
    const dy = this.bodyTop - this.scroll;
    for (const line of placed) {
      const on = shown.has(line);
      /** ⚠️ 两个条件**一起**成立才画：内容说该画 + 这一行在视口里。 */
      line.slot.name.root.visible = on && line.slot.name.root.visible;
      line.slot.body.root.visible = on && line.slot.body.root.visible;
      if (on) {
        line.slot.name.root.y = line.nameTop + dy;
        line.slot.body.root.y = line.bodyTop + dy;
      }
    }
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
   * 内部：滚动
   * ---------------------------------------------------------------- */

  /**
   * 滚轮 / 拖拽滚 **delta 像素**（触屏没有滚轮，拖拽那条路见 `PrepareScreen.dragDetail`）。
   *
   * ⚠️ 钳位走 `scrollWindow.clampOffset`（**复用**那一份边界规则）：
   * 滚到尽头 / 内容不足一屏 / 空内容三种边界只有一处实现。
   *
   * @returns 有没有真的动（调用方据此决定要不要重画）。
   */
  scrollBy(delta: number): boolean {
    if (this.maxScroll <= 0) return false;
    /**
     * ⚠️ 钳位走 `pixelViewport`（**像素**那一套）。曾经写成
     * `clampOffset(this.scroll + delta, this.maxScroll, 1)` —— 而
     * `clampOffset` 是**行**那一套（第三个数是"一屏几行"），拿它钳像素会
     * 让上界差 1（滚到底时最后一行差一点点才露全）。
     */
    const next = pixelViewport(this.bodyViewH + this.maxScroll, this.bodyViewH, this.scroll + delta).offsetPx;
    if (next === this.scroll) return false;
    this.scroll = next;
    return true;
  }

  /**
   * 这个逻辑点是不是落在**正文视口**里（拖拽要在里面才算"滚详情"）。
   *
   * ⚠️ 上界是 `bodyTop`（**顶栏下缘**）而不是面板顶边：顶栏是钉住的，
   * 在它上面拖动不该滚正文 —— 那会让玩家"想点标题却把内容滚走了"。
   */
  isOnDetail(px: number, py: number): boolean {
    const rect = detailRect();
    const top = this.bodyTop === 0 ? rect.y + PREPARE_LAYOUT.detailPad : this.bodyTop;
    return (
      this.maxScroll > 0 &&
      px >= rect.x &&
      px <= rect.x + rect.w &&
      py >= top &&
      py <= rect.y + rect.h
    );
  }

  /** 右侧那条滚动条（只有真能滚时才画；轨道只在**正文视口**那一段）。 */
  private drawScrollBar(
    rect: {
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    },
    bodyTop: number,
  ): void {
    this.scrollBar.clear();
    if (this.maxScroll <= 0) return;
    const trackX = rect.x + rect.w - 5;
    const trackTop = bodyTop;
    const trackH = Math.max(0, rect.y + rect.h - PREPARE_LAYOUT.detailPad - bodyTop);
    const thumbRatio = scrollThumbRatio(this.bodyViewH, this.maxScroll + this.bodyViewH);
    const thumbH = Math.max(24, Math.round(thumbRatio * trackH));
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
   * 正文比视口高时，按 `scroll` 决定**看得见哪一段**（而不是"末尾优先"）。
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
   * ==================================================================
   * ⚠️⚠️ 2026-10-13 第三轮：顶栏**钉住**，只让正文滚
   * ==================================================================
   *
   * 上一版把标题 / 副标题塞进那个"整体上移"的内容层里 —— 于是**滚到底**
   * 时"生命上限 420"仍然会被滚出面板（那正是用户报的"详情区顶栏随内容
   * 滚动会滚出面板"）。现在：
   *
   * ```
   *   顶栏（标题 + 关键数值 + 头像）→ 钉在面板顶部，不参与滚动
   *   正文（招式 / 说明 / 键值行）  → 在 [bodyTop, 面板底 − 内边距] 里滚
   * ```
   *
   * ⚠️ 视口顶边是**顶栏下缘**（`bodyTop`）而不是面板顶边：正文滚到顶栏
   * 底下就停住，不会与标题叠在一起。
   *
   * ⚠️ 触屏没有滚轮（AGENTS.md §3b）：拖拽那条路是**必须**的，不是补充。
   * 它走 `canvasInput` 已有的入口模式（`pointermove` 时转发）——
   * 不自己挂 `window` 监听器。
   */
  private shiftContent(
    rect: { readonly y: number; readonly h: number },
    bodyTop: number,
    contentBottom: number,
  ): void {
    this.bodyViewH = Math.max(0, rect.y + rect.h - PREPARE_LAYOUT.detailPad - bodyTop);
    this.maxScroll = pixelViewport(contentBottom - bodyTop, this.bodyViewH, 0).maxPx;
    this.scroll = pixelViewport(contentBottom - bodyTop, this.bodyViewH, this.scroll).offsetPx;
  }
}
