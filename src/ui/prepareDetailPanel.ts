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
 * ⚠️⚠️ 2026-10-13 第四轮：正文**画到面板外面**去了 —— 裁剪是这次修的
 * ==================================================================
 *
 * 用户原话："**boss 详情的内容 出了区域 还是能显示···· 虽然可以滚动**"。
 *
 * 实测（截图 + 逐字坐标，见提交说明）：聚焦「傲慢」、滚到顶时，最后一招
 * 「碾压」的名字与说明被画到 **y ≈ 490~520**，而面板底边是 **459** ——
 * 那几行压在下面的素材声明上。
 *
 * ==================================================================
 * 根因：**裁剪那一行从来没生效过**（单位对不上）
 * ==================================================================
 *
 * 旧版 `placeRows` 写的是 `visibleWindow(placed, this.scroll, viewRows)`：
 * `visibleWindow` 的第二个参数是**条目下标**（"第几条开始"），而这里传的
 * `this.scroll` 是**像素**。于是 `clampOffset(像素, 行数, 一屏行数)` 对
 * 5 行的内容恒等于 0（`maxOffset(5, 13) = 0`）—— **永远返回全部行**，
 * 一行都没裁掉。而"看得见哪一段"就只剩下那个 `dy` 平移：内容整体上移，
 * 下面自然就伸出去了。
 *
 * ==================================================================
 * 修法（2026-10-22 第二轮）：**遮罩按像素裁**，不再"整行可见"
 * ==================================================================
 *
 * 第一轮修的是"内容画到面板外"，做法是**整行落在视口里才画**；它确实
 * 不再溢出，但用户 2026-10-22 明确否掉了那种观感：
 *
 * > "一段话要么完全显示、要么完全不显示" 这不是我要的，是现在的情况，
 * > 我要的是类似 html 那种滚动效果，如果 pixi 做不到咱们就换引擎！
 *
 * 所以现在：
 *
 * ```
 *   正文层（`rowsLayer`）  整层被一块矩形 `mask` 裁到 [bodyTop, 面板底 − 内边距)
 *   每一行                 按**内容坐标 + 像素偏移**摆（跨边界的照画）
 *   完全在视口外的行       不画（**性能**判据，省掉文字重建）
 * ```
 *
 * ⚠️ 那条"遮罩在 headless 里不生效"的旧结论（见 `ui/settings/wrapText.ts`
 * 与 AGENTS §3e）**仍然记着**，但它的前提是"截图验收"；用户已经接受
 * "截图里可能看不到裁切"这个代价，并要求以真机行为为准 ⇒ 这是**按用户
 * 的明确要求改的口径**，不是忘掉了那条教训。详细取舍见 `ui/viewportMask`。
 *
 * ⚠️ 因此**不再吸附行顶**（`snapScroll` 已删）：吸附会让滚动一格一格跳，
 * 那正是 HTML 式滚动要避免的东西。
 *
 * ⚠️ 行高改成**实测**（`Label.root.height`）而不是估算的行数：`maxScroll`
 * 与"整行是否放得下"都依赖内容底边，估算偏一行就会让最后一行**永远**
 * 差一点放不下（于是"滚到底也看不到最后一招"）。估算仍是兜底（jsdom /
 * 纹理还没量出来时 `height` 可能是 0）。
 */

import { DetailStatsLine } from './detailStatsLine';
import type { Container, Graphics } from 'pixi.js';
import { FONT } from './layout';
import { Label, type PixiCtor } from './primitives';
import { PALETTE } from '../render/theme';
import { PREPARE_SKIN, centeredTextTopY } from './prepareRender';
import { PREPARE_LAYOUT } from './prepareLayout';
import { detailRect } from './prepareGeometry';
import type { DetailModel, DetailRow } from './prepareDetail';
import { PORTRAITS, portraitFor } from '../render/portraitAssets';
import { PortraitSprite } from '../render/portraitSprite';
import { DetailViewport } from './prepareDetailViewport';
import { attachViewportMask, drawViewportClip, fullyOutside } from './viewportMask';
import { stripEmphasis } from './emphasis';
import { detailRowText, estimatedHeightOf, measuredHeightOf } from './detailText';
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
  /** 结构化数值那一行（前摇 / 冷却 / 代价；2026-10-22）。 */
  readonly stats: DetailStatsLine;
}

/**
 * 一行在**内容坐标**里的三段位置。
 *
 * ⚠️ `endTop` 是这次修裁剪补上的：旧版只记 `nameTop` / `bodyTop`，于是
 * "这一行到底占多高"没人知道 —— 而"整行落在视口里"这条判据正需要它
 * （见文件头）。
 */
interface PlacedRow {
  readonly slot: RowLabels;
  /** 名字那一行的顶边（也是这一行的顶边）。 */
  readonly nameTop: number;
  /** 说明 / 值那一行的顶边（没有第二行时 = `nameTop`）。 */
  readonly bodyTop: number;
  /** **结构化数值那一行**的顶边（⚠️ 不能拿 `bodyTop` 顶替：差一行，会糊成一团）。 */
  readonly statsTop: number;
  /** 这一行的**底边**（不含 `rowGap`）—— 裁剪判据读它。 */
  readonly endTop: number;
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
  /**
   * **正文层的遮罩**（2026-10-22）：把正文按像素裁在 `[bodyTop, 面板底)` 里。
   * `attachViewportMask` 把它加进 `rowsLayer` 并赋给 `mask`；每帧只重画几何。
   */
  private readonly maskGfx: Graphics;

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
  /**
   * **正文的滚动视口**（滚到哪 / 还能滚多少 / 哪一行整行看得见 / 滚动条）——
   * 几何那一半在 `prepareDetailViewport`（AGENTS.md §3 的横向切割：本文件
   * 只负责"画"）。
   */
  private readonly view = new DetailViewport();
  /**
   * 这一帧每一行在**内容坐标**里的区间（`layoutRows` 算，`placeRows` 读）。
   */
  private placed: readonly PlacedRow[] = [];
  /** 右侧那条滚动条（只有真能滚时才画）。 */
  private readonly scrollBar: Graphics;

  constructor(pixi: PixiCtor, private readonly translate: TranslateFn) {
    const rect = detailRect();
    this.root = new pixi.Container();

    this.gfx = new pixi.Graphics();
    this.rowsLayer = new pixi.Container();
    this.maskGfx = new pixi.Graphics();
    attachViewportMask(this.maskGfx, this.rowsLayer);
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
        : /**
           * ⚠️ 头像挂在 **root** 上（2026-10-22）：它在**钉住的顶栏**里，
           * 而 `rowsLayer` 现在被正文遮罩裁着 —— 挂进去会被一起裁掉
           * （表现是"头像只在正文视口那一段里出现"）。
           */
          new PortraitSprite(pixi, this.root, firstPlayer, portraitBoxOf(innerW));

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
      const stats = new DetailStatsLine(pixi);
      stats.attach((child) => this.rowsLayer.addChild(child));
      this.rows.push({ name, body, stats });
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
      this.view.reset();
    }
    const rect = detailRect();
    const innerX = rect.x + PREPARE_LAYOUT.detailPad;
    const innerW = rect.w - PREPARE_LAYOUT.detailPad * 2;

    this.drawFrame(rect);

    if (model === undefined) {
      this.placeholder.set(this.translate('roster.ui.detail.empty'));
      this.placeholder.root.x = innerX;
      /**
       * ⚠️ 原来这里是一个手调的 `- 12`（"半个行框"），而占位那行字号是
       * `FONT.body`(17) → 实测盒高 18.19，于是它比面板中心高约 3px。
       * 顶栏标题一直是用实测盒高算的（见 `update` 里的 `band.textH`），
       * 这里统一到同一条（`centeredTextTopY`）。
       */
      this.placeholder.root.y = centeredTextTopY(rect.y, rect.h, this.placeholder.root.height);
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

    /**
     * ⚠️ 顺序：**先摆行（量出内容底边）→ 再让视口按这一帧的底边算** →
     * 最后按视口裁 / 平移。反过来的话 `maxScroll` 用的是上一帧的底边，
     * "滚到底"那一档会差一帧才对（表现出来就是最后一行闪一下）。
     */
    const contentBottom = this.layoutRows(model.rows, bodyTop, inlineSpan(innerX, innerW));
    this.view.measure(rect, bodyTop, contentBottom);
    this.placeRows();
    this.view.drawScrollBar(this.scrollBar, rect);
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
   * **摊开正文行**（写文字 + 量高 + 记下每一行的内容区间），返回内容的底边 y。
   *
   * ==================================================================
   * ⚠️ 它**不摆放**：位置要等 `view.measure()` 把这一帧的视口算出来
   * ==================================================================
   *
   * 旧版把"摊开"与"摆放"挤在一个方法里，于是摆放时读到的 `maxScroll`
   * 是**上一帧**的（顺序上只能那样）。拆成 `layoutRows` → `view.measure`
   * → `placeRows` 之后，"这一帧的内容底边"与"这一帧可见哪一段"是同一次
   * 计算里的东西。
   *
   * ⚠️ 行高是**实测**的（`measuredHeight`），因为 `maxScroll` 与"整行放得下
   * 吗"都依赖内容底边 —— 估算偏一行会让最后一行**永远**差一点，于是
   * "滚到底也看不到最后一招"（见文件头）。
   */
  private layoutRows(rows: readonly DetailRow[], startY: number, span: TextSpan): number {
    let y = startY;
    const placed: PlacedRow[] = [];
    this.rows.forEach((slot, i) => {
      const row = rows[i];
      if (row === undefined) {
        slot.name.root.visible = false;
        slot.body.root.visible = false;
        slot.stats.clear();
        return;
      }
      /** ⚠️ 这一行**在内容坐标里**的 y（`placeRows` 之后就不能再读了）。 */
      const nameTop = y;
      let bodyContentTop = y;
      let statsTop = y;
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
          y += this.measuredHeight(slot.name, METRICS.nameLine);
        }
        /**
         * ⚠️ 说明文字**必须**带参数（`descParams`）：Boss 的说明里有
         * `{cast}` / `{damage}` 这些占位符，漏了就会把它们原样显示
         * （本仓库为这个形状专门收窄过 `TranslateFn`）。
         */
        /**
         * **结构化数值那一行**（2026-10-22）：名字下面、说明上面；三种槽位
         * 各自一个颜色（见 `ui/detailStats` 的文件头）。
         */
        statsTop = y;
        y = slot.stats.render(y, span.x, row.stats ?? [], this.translate);
        if (row.descKey === undefined) {
          slot.body.root.visible = false;
        } else {
          slot.body.root.visible = true;
          slot.body.set(stripEmphasis(this.translate(row.descKey, row.descParams)));
          slot.body.setColor(PALETTE.textDim);
          slot.body.root.x = span.x;
          bodyContentTop = y;
          slot.body.root.y = y;
          y += this.measuredHeight(slot.body, this.estimatedHeight(slot.body));
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
        const nameH = this.measuredHeight(slot.name, METRICS.nameLine);
        bodyContentTop = y + nameH;
        slot.body.root.y = bodyContentTop;
        y += nameH + this.measuredHeight(slot.body, this.estimatedHeight(slot.body));
      } else {
        slot.name.root.visible = true;
        slot.name.set(this.textOf(row));
        slot.name.setColor(row.dim === true ? PALETTE.textDim : PALETTE.text);
        slot.name.root.x = span.x;
        slot.name.root.y = y;
        slot.body.root.visible = false;
        y += this.measuredHeight(slot.name, this.estimatedHeight(slot.name));
      }
      /** ⚠️ 这一行的**内容底边**（不含 `rowGap`）—— 裁剪判据读它。 */
      const endTop = y;
      y += METRICS.rowGap;
      placed.push({ slot, nameTop, endTop, bodyTop: bodyContentTop, statsTop });
    });
    this.placed = placed;
    return y - METRICS.rowGap;
  }

  /**
   * 按视口把**可见的那些行**摆到面板上（顶栏那一条**不动**）。
   *
   * ⚠️ 判据（"整行落在视口里" / 吸附行顶 / 滚到底例外）**全部**在
   * `prepareDetailViewport`（那是 §3 横向切割出去的一半，见那个文件的
   * 文件头）—— 这里只做两件事：问视口"画出来的视口顶边在哪"，然后按
   * 它裁剪 + 平移。
   *
   * ⚠️ **绝对赋值**（`= 内容 y − 画出来的偏移`）而不是 `+= dy`：
   * `layoutRows` 每帧都会把内容 y 重新算进 `root.y`，再累加就会每帧漂
   * 一个 `dy`（画面上的表现是"越滚越快"）。
   *
   * ⚠️ 每个槽位的**显隐**由"内容说它该不该画"（`visible`，见上）与
   * "它在不在视口里"两个条件**一起**决定：只看后者的话，被裁掉的那几行
   * （`rows` 数组短于槽位数）会带着上一帧的字重新出现。
   */
  private placeRows(): void {
    const rect = detailRect();
    /**
     * **正文视口**（逻辑坐标）：从钉住的顶栏下缘，到面板底减内边距。
     *
     * ⚠️ 它是**遮罩的矩形**，也是"完全在外就不画"的判据 —— 两件事共用
     * 这一份几何，所以不会出现"画的地方不是裁的地方"。
     */
    const viewport = {
      x: rect.x,
      y: this.view.bodyTop,
      w: rect.w,
      h: Math.max(1, rect.y + rect.h - PREPARE_LAYOUT.detailPad - this.view.bodyTop),
    };
    drawViewportClip(this.maskGfx, viewport);

    /**
     * 画出来的偏移 = **像素**（不再吸附行顶，见文件头）：正文层整体上移
     * `scroll` 像素，越界的像素由遮罩切掉 ⇒ 与 HTML 的滚动一致 ✓
     */
    const dy = -this.view.scrollOffset();

    for (const line of this.placed) {
      /** 这一行在**画布坐标**里的区间（内容坐标 + 偏移）。 */
      const band = {
        x: viewport.x,
        y: line.nameTop + dy,
        w: viewport.w,
        h: Math.max(0, line.endTop - line.nameTop),
      };
      /**
       * ⚠️ **两个条件一起**成立才画：
       *   ① 内容说它该出现在这一段（`layoutRows` 里写的 `visible`）
       *   ② 它没有**完全**滑出视口（`fullyOutside` = 性能判据）
       * 部分露出的行**照画** —— 遮罩会把越界的那半截切掉（HTML 式）✓
       */
      const outside = fullyOutside(band, viewport);
      if (outside) {
        line.slot.name.root.visible = false;
        line.slot.body.root.visible = false;
        line.slot.stats.setVisible(false);
        continue;
      }
      if (line.slot.name.root.visible) line.slot.name.root.y = line.nameTop + dy;
      if (line.slot.body.root.visible) line.slot.body.root.y = line.bodyTop + dy;
      line.slot.stats.setY(line.statsTop + dy);
    }
  }

  /** 见 `./detailText`（那一半是"这一行显示什么字、多高"，与摆位无关）。 */
  private textOf(row: DetailRow): string {
    return detailRowText(row, this.translate);
  }

  private measuredHeight(label: Label, fallback: number): number {
    return measuredHeightOf(label.root, fallback);
  }

  private estimatedHeight(label: Label): number {
    return estimatedHeightOf(label.root, METRICS.bodySize, METRICS.bodyLine);
  }

  /* ---------------------------------------------------------------- *
   * 内部：滚动
   * ---------------------------------------------------------------- */

  /**
   * 滚轮 / 拖拽滚 **delta 像素**（触屏没有滚轮，拖拽那条路见
   * `PrepareScreen.dragDetail`）。
   *
   * ⚠️ 钳位与边界规则**全在** `prepareDetailViewport.scrollBy`（搬走的那
   * 一半，含"曾经拿 `clampOffset` 钳像素、上界差 1"那条坑的记录）。
   *
   * @returns 有没有真的动（调用方据此决定要不要重画）。
   */
  scrollBy(delta: number): boolean {
    return this.view.scrollBy(delta);
  }

  /**
   * 这个逻辑点是不是落在**正文视口**里（拖拽要在里面才算"滚详情"）。
   *
   * ⚠️ 判据在 `prepareDetailViewport.isOnDetail`（上界是**顶栏下缘**而不是
   * 面板顶边 —— 在标题上拖动不该把内容滚走）。
   */
  isOnDetail(px: number, py: number): boolean {
    return this.view.isOnDetail(detailRect(), px, py);
  }
}
