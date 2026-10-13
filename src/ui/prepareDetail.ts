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
 * | 炁机 | 已开层数 / 上限 | `maxStacks`（与肉鸽**同一个字段**） |
 * | Boss | 名字 | `data/roster.BOSS_ROSTER` 的 `nameKey` |
 * | Boss | 生命上限 | `data/units.BOSS_CAPS.hp` |
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
 * 炁机 = 开没开 / 叠了几层），渲染层负责把"标题 + 这一行 + 头像位"摆成
 * 同一条（见 `ui/prepareDetailPanel.ts`）。**炁机没有头像、Boss 也没有**
 * —— 它们用**同一个位置**的程序化占位方块，所以顶栏不会留洞
 * （用户："炁机没有头像 → 那一条怎么排，你判断；别留一个空洞"）。
 */

import type { PrepareTarget } from './prepareLogic';

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
  readonly kind: 'player' | 'qiji' | 'boss';
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
   * | 炁机 | 开没开 / 已叠几层（它没有"血量"，这一行就是它的关键数值） |
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
  readonly maxStacks?: number;
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
  /** 这个 id 是不是"开发中"。 */
  readonly developing: (id: string) => boolean;
  /**
   * 某条炁机**此刻**的层数 / 上限（画"已开 N 层"）。
   *
   * ⚠️ 是**按 id 取的函数**而不是一个 `{ stacks, cap }` 字段：层数是
   * **可变状态**（玩家每点一下就变），而模型每帧都要新造 —— 存成一个
   * 字段就会出现"沿用上一帧的层数"。
   */
  readonly qijiStacks: (id: string) => { readonly stacks: number; readonly cap: number };
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
    /** ⚠️ 不设 `portraitId`：Boss 没有配对的对话头像（见文件头）。 */
    rows: soon
      ? [{ kind: 'text', key: 'roster.ui.developing', dim: true }]
      : [{ kind: 'text', key: 'roster.ui.detail.skills', dim: true }, ...ctx.bossSkills(id)],
  };
}

function qijiDetail(id: string, ctx: DetailContext): DetailModel | undefined {
  const qiji = ctx.qijiById(id);
  if (qiji === undefined) return undefined;
  const { stacks, cap } = ctx.qijiStacks(id);
  /**
   * ⚠️ **开关 / 层数挪到顶部那一行**（原来是正文的头两行）。
   *
   * 理由有两条：
   *   1. **结构一致**（用户要求三类的顶栏一样）：人物 / Boss 的顶栏那一行
   *      是"生命上限"，炁机没有血量，它的**关键数值**就是开没开 / 叠了几层
   *      —— 放在同一个位置，三类的顶部才是同一种东西。
   *   2. **不重复**：同一件事（开没开）画两遍会让"这一行是状态还是说明"
   *      变含糊，而详情区最上面一条是**一眼扫过**的位置。
   *
   * ⚠️ 三种取值仍按旧规则分（没开 / 可叠多层 `stacks / cap` / 单层生效）：
   * 合成一句会让"上限 3、现在 0"读成"开了 0/3 层"（看不出它其实没开）。
   */
  const subtitle: DetailTextRow =
    stacks <= 0
      ? { kind: 'text', key: 'roster.ui.detail.qijiOff' }
      : cap > 1
        ? { kind: 'text', key: 'roster.ui.detail.qijiStacks', params: { stacks, cap } }
        : { kind: 'text', key: 'roster.ui.detail.qijiOn' };
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
