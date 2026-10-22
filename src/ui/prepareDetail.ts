/**
 * **自由模式右侧那块详情区要显示什么**（纯函数：聚焦项 → 若干行）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它把"当前选择框在哪一项上"翻译成**一张可画的清单**（标题 / 头像 / 一
 * 行行文字 / 一条条技能）。它不知道 Pixi，也不知道 i18n —— 所以能在 node
 * 里精确测"hover 人物时出来的是不是那个人"。
 *
 * ==================================================================
 * ⚠️ 驱动源只有一条：`focusedTarget()`
 * ==================================================================
 *
 * 需求："右边或者左边 切出一部分区域，显示**当前选择框**（hover 或者
 * 键盘）所在的人物 or 炁机 or boss 的详情"。
 *
 * 于是"显示谁的详情"这件事**只有一个输入**：调用方（`PrepareScreen`）
 * 把 hover 与键盘焦点合成一个 `PrepareTarget` 再传进来。合成规则也写在
 * 这里，不散到渲染层 —— 两份合成规则必然漂，而漂的表现是"鼠标停在 A 上、
 * 面板却显示 B"。
 *
 * ⚠️ **hover 优先于键盘焦点**（两者同时存在时）：鼠标指着的东西是玩家
 * 此刻**真的在看**的那个；而触屏没有 hover（AGENTS.md §3b），那时
 * `hover` 恒为 undefined，于是自动退化成"跟着焦点走" —— **同一段代码**
 * 服务两种输入，不存在"只有鼠标能用"的那条路。
 *
 * ⚠️ hover 在 `PrepareScreen` 那边**不进光标状态**（只影响这块面板）：
 * 若 hover 也移光标，就会造出"光标在人身上、焦点槽位在炁机行"这种
 * 键盘一按就跳的状态。所以悬停是**纯查看**，键盘的"焦点 → 光标"那条
 * 路一个字不改。
 *
 * ==================================================================
 * ⚠️ 数据来自哪里（不许编内容）
 * ==================================================================
 *
 * | 类 | 取什么 | 从哪取 |
 * |---|---|---|
 * | 人物 | 名字 | `data/roster.PLAYER_ROSTER` 的 `nameKey` |
 * | 人物 | 生命上限 | `data/units.playerHpFor(id)` |
 * | 人物 | 头像 | `render/portraitAssets` 的配对（索爾 / 凱麗 / 索菲亞） |
 * | 人物 | 技能名 + 说明 | `data/units.playerSkillsFor(id)` |
 * | 炁机 | 名字 / 说明 | 内容实体的 `nameKey` / `descKey`（i18n 里已有） |
 * | 炁机 | 已激活没有 | 激活集合（`ui/freeQiji.ts`：开关，没有层数） |
 * | Boss | 名字 | `data/roster.BOSS_ROSTER` 的 `nameKey` |
 * | Boss | 生命上限 | `bossHpFor(id)`（`data/bossDefs.ts`） |
 * | Boss | 招式 | `data/units.behaviorsFor(id)` → `ALL_SKILLS` |
 * | Boss | 招式说明 | `descKey` + `app/descParams.descParamsOf()`（模板参数） |
 *
 * ⚠️ **Boss 的详情今天只能取到这些**，而它是**真的数据**（不是编的）。
 * 仓库里**没有** Boss 的"称号 / 简介"：`RosterEntry` 的形状被单测钉死为
 * `{ id, nameKey }`（`tests/unit/prepareLogic.test.ts` 有一条断言），
 * 所以本文件不假装有一段简介可显示。
 *
 * ⚠️ 未实现的 Boss（嫉妒 / 暴食 / …）今天共用傲慢的行为表
 * （`data/units.behaviorsFor` 的兜底），所以**它们的招式列表会被显示成
 * 傲慢的招式** —— 那是假信息。所以 `developing` 的 Boss **只显示状态行，
 * 不列招式**：宁可少显示，也不显示一份错的。
 *
 * ⚠️ **对话头像只给人物**（这一轮的需求是"**我们 3 个角色**名字右边的
 * 说话头像"）：Boss 没有配对的头像，所以 `bossDetail` **不设
 * `portraitId`** —— 它走程序化占位（见渲染层）。
 *
 * ==================================================================
 * ⚠️ 2026-10-13：三类详情都走**同一条顶栏**（标题 + 关键数值 + 头像位）
 * ==================================================================
 *
 * 用户原话："详情页右上角是空的，名字 头像 血量啥的，优化一下布局" +
 * "三类的顶部结构要一致 ✗（人物 / 炁机 / 对手 —— 别三类三个样子）" +
 * "血量要显眼"。
 *
 * 于是模型这一层保证**三类的 `subtitle` 都有值**（人物 / Boss = 生命上限，
 * 炁机 = 开没开），渲染层负责把"标题 + 这一行 + 头像位"摆成
 * 同一条（见 `ui/prepareDetailPanel.ts`）。**炁机没有头像、Boss 也没有**
 * —— 它们用**同一个位置**的程序化占位方块，所以顶栏不会留洞
 * （用户："炁机没有头像 → 那一条怎么排，你判断；别留一个空洞"）。
 */

import type { PrepareTarget } from './prepareLogic';
import type { DetailKind } from './prepareDetailMetrics';
import type { RunConfirmBlock } from './runConfirmLayout';

/* ================================================================== *
 * 形状
 * ================================================================== */

/** 详情区里的一条**招式 / 说明**。 */
export interface DetailSkillRow {
  readonly kind: 'skill';
  /** 名字的 i18n key。 */
  readonly nameKey: string;
  readonly descKey?: string;
  /**
   * 说明模板里的**数值参数**。
   *
   * ⚠️ 它是**必需的**（可以是空对象）：Boss 的说明里有 `{cast}` /
   * `{damage}` / `{cooldown}` 这些占位符，漏了参数就会把占位符原样显示
   * 给玩家 —— 本仓库为这个形状专门收窄过 `TranslateFn`（见
   * `i18n/translator.ts`）。
   */
  readonly descParams: Readonly<Record<string, string | number>>;
  /**
   * **结构化数值**（前摇 / 冷却 / 代价）：画在名字下面、说明上面，
   * 每一种一个颜色（2026-10-22）。空数组 / 缺省 ⇒ 这一行不画。
   */
  readonly stats?: readonly DetailStat[];
}

/** 详情区里的一行**结构化数值**（前摇 / 冷却 / 代价）。 */
export type DetailStatKind = 'cast' | 'cooldown' | 'cost';

export interface DetailStat {
  readonly kind: DetailStatKind;
  /** `cast` / `cooldown` 用：秒数。 */
  readonly seconds?: number;
  /** `cost` 用：资源名（`energy` / `douqi`）。 */
  readonly resourceKey?: string;
  /** `cost` 用：数量。 */
  readonly amount?: number;
}

/** 详情区里的一行**文字**。 */
export interface DetailTextRow {
  readonly kind: 'text';
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
  /** 次要信息（画暗一档）。 */
  readonly dim?: boolean;
}

/** 详情区里的一行**标签对**（左标签 + 右值），值已本地化。 */
export interface DetailKVRow {
  readonly kind: 'kv';
  readonly labelKey: string;
  readonly value: string;
}

export type DetailRow = DetailSkillRow | DetailTextRow | DetailKVRow;

/** 详情区当前该画的东西。 */
export interface DetailModel {
  readonly kind: DetailKind;
  readonly id: string;
  /** 标题（人物 / Boss 就是它的名字）。 */
  readonly titleKey: string;
  /**
   * 标题下面那一行**关键数值**（与标题、头像一起占详情区**顶部那一条**）。
   *
   * ⚠️ 三类**都**要给这一行（用户 2026-10-13："三类的顶部结构要一致"）：
   *
   * | 类 | 这一行 |
   * |---|---|
   * | 人物 / Boss | 生命上限（玩家最想看的那个数） |
   * | 炁机 | 已激活 / 未激活（它没有"血量"，这一行就是它的关键状态） |
   *
   * ⚠️ 它是**关键数值**，不是"次要信息"：渲染层用**亮色 + 大一号**画它
   * （不再是旧的 13px 暗灰）。所以这里**不设 `dim`**。
   */
  readonly subtitle?: DetailTextRow;
  /**
   * **对话头像**的素材 id（`render/portraitAssets` 的配对键）。
   * 只有人物有 —— Boss / 炁机没有配对的对话头像，它们走**同一个位置**的
   * 程序化占位方块（见渲染层），所以三类的顶部结构仍然一模一样。
   */
  readonly portraitId?: string;
  /** 正文（技能列表 / 说明）。 */
  readonly rows: readonly DetailRow[];
}

/* ================================================================== *
 * 聚焦项
 * ================================================================== */

/**
 * 当前"选择框所在"的那一项 —— hover 优先，其次键盘焦点。
 *
 * ⚠️ 两条输入都喂同一个形状（`PrepareTarget`）：所以**内容按类切换**这件
 * 事只在这里判一次，渲染层那边只是一个 `switch`。
 */
export function focusedTarget(
  cursor: PrepareTarget | undefined,
  hover: PrepareTarget | undefined,
): PrepareTarget | undefined {
  return hover ?? cursor;
}

/**
 * **肉鸽确认屏那两行各是什么、焦点怎么走**（纯判定；2026-10-15）。
 *
 * ==================================================================
 * 为什么它住在 `prepareDetail.ts`（而不是屏幕里）
 * ==================================================================
 *
 * 它回答的是"这一屏该给面板哪个 `PrepareTarget`、初始焦点落在谁身上"
 * —— 与 `focusedTarget` 同一类问题（**目标 → 模型**），而且这里有两条
 * **会被写错、截图又看不出来**的规则：
 *
 *   1. **第一场之前没有已选炁机** → 那一行整块不画，焦点必须落到对手上
 *      （否则焦点停在一个不存在的块上、右侧详情空着 —— 画面像"面板坏了"）
 *   2. **焦点走到「开始战斗」上时，右侧仍显示上一块**（`expanded` 不动）
 *      —— 面板忽隐忽现比"停着不动"难看得多
 *   3. **一局选了不止一条炁机时**：块头上照实写"已激活 N 条：A、B"（那是
 *      `prepareFold` 的判据、备战屏同一个块头），而**右侧详情只画得出
 *      一条** —— 画的是**刚选的那条**（最后一条）
 *
 * ⚠️ 第 2 条不是这里实现的：`prepareLogic.withFocus` 早就写着这条
 * （"`focus === 'start'` 时 `expanded` 保持"），本文件只是**读**
 * `expanded` 而不是读 `focus` —— 这就是那条规则的落点。
 */

/**
 * 确认屏的**初始焦点 + 初始选择**（`prepareLogic` 那套纯状态机的入参）。
 *
 * ⚠️ 焦点顺序、空槽位跳过、环绕全在 `prepareLogic.moveFocus` 里（本屏
 * **复用**备战屏那套，不另写一份）—— 所以这里只回答"起点在哪"：
 *
 * ```
 *   有已选炁机 → 焦点落在「炁机」（刚选的那条，最该被确认）
 *   没有       → 落在「对手」（第一场之前唯一存在的那一行）
 * ```
 *
 * ⚠️ `playerId` / `cursor.playerId` 是**空串**：这一屏没有人物那一行。
 * 这与选角色屏把 `bossId` / `cursor.qijiId` 写成空串是同一个处理
 * （见 `characterSelectLogic.characterSelection` 的说明）：`PrepareSelection`
 * 要求每个槽位各记一格，而这一屏到不了那两个槽位。
 */
/**
 * ⚠️ **焦点状态**已经搬到 `./runConfirmFocus.ts`（2026-10-16）—— 这一屏
 * 现在有**四站**（多了一行「恶魔低语」），而备战屏那台状态机的
 * `PrepareFocus` / `PrepareSectionKind` 是围着"三块手风琴 + 块内光标"长的，
 * 塞进去会让两边都变糊（理由逐条写在那个文件头）。这里只留"焦点状态 →
 * 右侧该画谁"这一段：它属于**详情**的职责。
 */

/**
 * 确认屏右侧**该显示谁** —— 读的是 `expanded`（不是 `focus`）。
 *
 * ⚠️ 为什么读 `expanded`：焦点走到「开始战斗」时 `focus === 'start'`，而
 * `expanded` 停在上一块上（`prepareLogic.withFocus`）—— 于是"Tab 到开始
 * 战斗"不会把右侧详情清空。这与备战屏"焦点在开始键上时那一块照样展开"
 * 是**同一条**规则的两个表现。
 *
 * ⚠️ 一局选了不止一条时画**最后一条**（"刚选的那条"）：面板一次只画得出
 * 一条，而"这一场之前刚选了什么"正是玩家要确认的；**整局清单**在一局结束屏
 * （`RunOverScreen` 的「本局炁机」）。
 *
 * ⚠️ `expanded` 指向一个**不存在**的块（没有已选炁机）时退回对手：这是
 * 一条兜底（正常路径到不了 —— `moveFocus` 会跳过空槽位），但它防的是
 * "焦点在空块上、右侧一片空白"那种**看不出原因**的画面。
 */
export function runConfirmDetailTarget(input: {
  readonly expanded: RunConfirmBlock;
  readonly boss: DetailUnit;
  readonly qiji: readonly DetailUnit[];
  /**
   * 这一层的「恶魔低语」；**第 1 层是 `undefined`**（那一行写「本层纯净」）。
   *
   * ⚠️ 用**一个**可选参数而不是"两个分支"：判据只有一条 —— **焦点在哪一行
   * 就画那一行**。低语那一行永远在，所以 `undefined` 时也照样返回它
   * （面板画"本层纯净"那一段，而不是退回去画对手）。
   */
  readonly whisper: DetailWhisper | undefined;
}): RunConfirmDetailTarget {
  if (input.expanded === 'whisper') {
    return { kind: 'whisper', id: input.whisper?.id ?? '' };
  }
  const latest = input.qiji[input.qiji.length - 1];
  if (input.expanded === 'qiji' && latest !== undefined) {
    return { kind: 'qiji', id: latest.id };
  }
  return { kind: 'boss', id: input.boss.id };
}

/** 确认屏右侧可能画的三类（**没有** `'player'` —— 玩家详情在选角色屏）。 */
export type RunConfirmDetailTarget =
  | { readonly kind: 'boss' | 'qiji'; readonly id: string }
  | { readonly kind: 'whisper'; readonly id: string };

/**
 * 一条「恶魔低语」在详情区需要的最小形状（内容实体满足它）。
 *
 * ⚠️ 与 `DetailQiji` 分开：低语**没有**"激活 / 未激活"这个状态
 * （它要么在这一层生效、要么这一层没有），所以它**不需要** `on` 那一套。
 */
export interface DetailWhisper {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
}

/**
 * 「恶魔低语」的详情模型（标题 = 它的名字，正文 = 一句话说明）。
 *
 * ⚠️ 顶部那一行（`subtitle`）写的是**栏目标题**（"恶魔低语"）—— 三类顶部
 * 结构一致那条要求"这一行必须有值"，而低语没有"已激活 / 未激活"这种状态，
 * 它的关键信息就是"它是这一层的哪一类惩罚"。
 */
export function whisperDetailModel(
  unit: DetailWhisper | undefined,
  none: { readonly nameKey: string; readonly descKey: string },
): DetailModel {
  return {
    kind: 'whisper',
    id: unit?.id ?? '',
    titleKey: unit?.nameKey ?? none.nameKey,
    subtitle: { kind: 'text', key: 'screen.runConfirm.whisperBlock' },
    rows: [{ kind: 'text', key: unit?.descKey ?? none.descKey }],
  };
}

/* ================================================================== *
 * 数据注入
 * ================================================================== */

/**
 * 一条炁机在详情区需要的最小形状（内容实体满足它）。
 *
 * ⚠️ 这里**没有** `icon` / `rarity` / `category`：
 *   - `icon` 名（`char_dodge` 那些）今天**不在 `render/icons.ts` 的 SVG
 *     表里**，画不出来 —— 详情区用"名字首字"的占位方块代替（见渲染层）。
 *     把用不上的字段声明进来，只会让下一个人以为那里有图标可用。
 *   - `rarity` 的中文显示名今天不在语言包里（见 `qijiDetail` 的说明）。
 * 真要用时再加（那时连同它的显示路径一起加）。
 */
export interface DetailQiji {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey?: string;
}

/** 一个出战单位在详情区需要的最小形状。 */
export interface DetailUnit {
  readonly id: string;
  readonly nameKey: string;
}

/**
 * 详情区要的外部数据 —— **由 `app/` 注入**，不在这里 import 内容表。
 *
 * ⚠️ 理由与 `canStartBattle` 注入 `developing` 同一条：这一屏的**规则**
 * 不该把内容表焊死（内容表会换名字、会加 Boss），而且注入之后本文件在
 * node 里测起来只需要造几个字面量。
 */
export interface DetailContext {
  readonly playerById: (id: string) => DetailUnit | undefined;
  readonly bossById: (id: string) => DetailUnit | undefined;
  readonly qijiById: (id: string) => DetailQiji | undefined;
  /** 人物 / Boss 的生命上限（展示用）。 */
  readonly playerHp: (id: string) => number;
  readonly bossHp: (id: string) => number;
  /** 这个人物的技能（名字 + 说明 key + 模板参数）。 */
  readonly playerSkills: (id: string) => readonly DetailSkillRow[];
  /** 这个 Boss 的招式（**开发中的 Boss 返回空数组**，见文件头）。 */
  readonly bossSkills: (id: string) => readonly DetailSkillRow[];
  /**
   * 这个 Boss 的**常驻被动**（开战前就挂在它身上那几条）。
   *
   * ⚠️ 取自 `BossDef.passives` —— **不是**从 `buffs` 里猜"哪条像被动"。
   * 那个字段是 2026-10-14 为了修一个真 bug 才加的（见它的说明）：
   * 在此之前被动混在 `buffs` 里，而引擎**从来不挂 `buffs`**，
   * 于是五个 Boss 的被动全是死的。现在"会被挂的"与"被技能授予的"
   * 是两份**明确的**清单，详情区照实各显示一节。
   */
  readonly bossPassives: (id: string) => readonly DetailSkillRow[];
  /** 这个 id 是不是"开发中"。 */
  readonly developing: (id: string) => boolean;
  /**
   * 某条炁机**此刻**开着没有（画"已激活 / 未激活"）。
   *
   * ⚠️ 是**按 id 取的函数**而不是一个布尔字段：激活状态是**可变状态**
   * （玩家每点一下就变），而模型每帧都要新造 —— 存成一个字段就会出现
   * "沿用上一帧的开关态"。
   */
  readonly qijiOn: (id: string) => boolean;
}

/* ================================================================== *
 * 构造
 * ================================================================== */

/**
 * 构造详情区的画面模型。
 *
 * @returns 没有聚焦项时 `undefined` —— 渲染层据此画"把光标移到卡片上"
 *   那句占位（**不是**把面板藏起来：面板忽隐忽现会让右边的布局跳动）。
 */
export function detailModelOf(
  target: PrepareTarget | undefined,
  ctx: DetailContext,
): DetailModel | undefined {
  if (target === undefined) return undefined;
  if (target.kind === 'player') return playerDetail(target.id, ctx);
  if (target.kind === 'boss') return bossDetail(target.id, ctx);
  return qijiDetail(target.id, ctx);
}

function playerDetail(id: string, ctx: DetailContext): DetailModel | undefined {
  const unit = ctx.playerById(id);
  if (unit === undefined) return undefined;
  const soon = ctx.developing(id);
  return {
    kind: 'player',
    id,
    titleKey: unit.nameKey,
    /** 顶部那一行的关键数值：生命上限（见 `DetailModel.subtitle`）。 */
    subtitle: {
      kind: 'text',
      key: 'roster.ui.detail.hpMax',
      params: { hp: ctx.playerHp(id) },
    },
    /** 头像：与卡片上那颗是**同一份素材表**（`render/portraitAssets`）。 */
    portraitId: id,
    /**
     * ⚠️ 「开发中」的人物**不列技能**：`playerSkillsFor` 对没做完的角色
     * 返回的不是她的招式 —— 列出来会把"还没做"显示成"她有这么几招"。
     * 这与 Boss 那一条是同一条纪律。
     */
    rows: soon ? [{ kind: 'text', key: 'roster.ui.developing', dim: true }] : ctx.playerSkills(id),
  };
}

function bossDetail(id: string, ctx: DetailContext): DetailModel | undefined {
  const unit = ctx.bossById(id);
  if (unit === undefined) return undefined;
  const soon = ctx.developing(id);
  return {
    kind: 'boss',
    id,
    titleKey: unit.nameKey,
    /** 顶部那一行与人物**同一条**（生命上限）—— 三类结构一致。 */
    subtitle: {
      kind: 'text',
      key: 'roster.ui.detail.hpMax',
      params: { hp: ctx.bossHp(id) },
    },
    /**
     * **Boss 也有头像了**（2026-10-22）：`portraitFor` 现在同时查玩家表与
     * Boss 表（`BOSS_PORTRAITS`），所以这里给 id 就行 —— 没配对时它会
     * 自己回退到"不显示"（渲染层的 `asset === undefined` 分支）。
     */
    portraitId: id,
    /**
     * ⚠️ **不再分「招式」「被动」两节**（用户 2026-10-14："**不用分 招式和被动，
     * 直接写每个能力就好**"）。
     *
     * 顺序：**招式在前、被动在后**（用户选的）——
     * 招式 = `BossDef.skills`（它怎么打你），被动 = `BossDef.passives`
     * （它天生就会什么）。两节的**小节标题行也一并删掉**：既然不分区，
     * 那两行就是纯粹的噪声。
     *
     * ⚠️ 被动行同样走 `skillRow()` ⇒ **有名字也有说明**（见
     * `app/prepareDetailContext.ts` 的 `bossPassives`）。
     */
    rows: soon
      ? [{ kind: 'text', key: 'roster.ui.developing', dim: true }]
      : [...ctx.bossSkills(id), ...ctx.bossPassives(id)],
  };
}

function qijiDetail(id: string, ctx: DetailContext): DetailModel | undefined {
  const qiji = ctx.qijiById(id);
  if (qiji === undefined) return undefined;
  /**
   * ⚠️ **开关挪到顶部那一行**（原来是正文的头两行）。
   *
   * 理由有两条：
   *   1. **结构一致**（用户要求三类的顶栏一样）：人物 / Boss 的顶栏那一行
   *      是"生命上限"，炁机没有血量，它的**关键状态**就是开没开
   *      —— 放在同一个位置，三类的顶部才是同一种东西。
   *   2. **不重复**：同一件事（开没开）画两遍会让"这一行是状态还是说明"
   *      变含糊，而详情区最上面一条是**一眼扫过**的位置。
   *
   * ⚠️ **只有两种取值**：炁机激活是开关，**没有层数**
   * （用户 2026-10-13 明确纠正；来龙去脉见 `ui/freeQiji.ts` 的文件头）。
   * 上一版还有第三个分支"已叠 N / M 层"，那是被删掉的错机制。
   */
  const subtitle: DetailTextRow = ctx.qijiOn(id)
    ? { kind: 'text', key: 'roster.ui.detail.qijiOn' }
    : { kind: 'text', key: 'roster.ui.detail.qijiOff' };
  const rows: DetailRow[] = [];
  if (qiji.descKey !== undefined) {
    /**
     * ⚠️ 这一行的 `nameKey` 仍填 qi 机自己的名字，但**渲染层不画它**
     * （面板的标题已经是这个名字了）—— 见 `prepareDetailPanel.drawRows`
     * 里 `skill` 那一支对 `nameKey` 的处理：只有它的 `nameKey` 与标题
     * **不同**时才画名下那行。放同一个 key 是为了让"这一条说的是哪台
     * 炁机"在数据里可见（而不是靠"标题在上面"这种位置约定）。
     */
    rows.push({ kind: 'skill', nameKey: qiji.nameKey, descKey: qiji.descKey, descParams: {} });
  }
  return {
    kind: 'qiji',
    id,
    titleKey: qiji.nameKey,
    subtitle,
    /**
     * ⚠️ 这里**没有**稀有度 / 分类：那两个词是 `QijiEntity.rarity` /
     * `.category` 的枚举值（`'uncommon'` / `'offense'` …），而它们的中文
     * 显示名**今天不在语言包里**。编一套（"稀有 / 进攻"）就是**替内容作者
     * 定词** —— 本仓库为这件事纠正过一次（`data/roster.ts` 的"不要顺手编
     * 称号"）。要显示应当由内容作者往 `qiji.*` 里加键（那是另一个领域）。
     */
    rows,
  };
}
