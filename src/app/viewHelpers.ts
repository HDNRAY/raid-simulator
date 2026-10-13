/**
 * 视图适配器的**纯函数**辅助：buff 的分类、配色、文案 key、伤害配色。
 *
 * ==================================================================
 * 为什么拆出来
 * ==================================================================
 *
 * `viewAdapter.ts` 超过 700 行（AGENTS.md §3）。这一块约 105 行，
 * 而且是**纯函数 + 常量表**（没有状态、不碰引擎），与
 * "持有渲染侧瞬时状态并构建快照" 那部分职责完全不同。
 */

/** 判定窗口类 buff 的 id 前缀（UI 要最醒目地显示它们）。 */
const DEFENSIVE_BUFF_PREFIXES = ['dodge-iframe', 'guard'];

export function isDefensiveBuff(buffId: string): boolean {
  return DEFENSIVE_BUFF_PREFIXES.some((p) => buffId.startsWith(p));
}

/**
 * 引擎内部用的标记 buff —— **不在 UI 上显示图标**。
 *
 * 它们不是"玩家应该看到的增益/减益"，而是引擎的状态标记。
 *
 * ⚠️ 曾经这里列着 `gcd` / `boss-telegraph-active` / `boss-telegraph`，
 * 三个**全是死的**：
 *   - `gcd`：公共冷却早被删了，没有任何 buff 会产生这个 id（同一个死分支
 *     还留在 `blockKeyOf` 与 `buffShort.gcd` 文案里，一并删了）
 *   - `boss-telegraph-active`：**全仓库没有任何地方产生它**
 *   - `boss-telegraph`：它自己的 `BuffDef` 就有 `hidden: true`，
 *     在这里再列一遍是**两处真相**（改一处漏一处）
 *
 * 所以现在这个集合是**空的**，`hidden: true` 是唯一机制。
 * 保留这个 Set 与 `isInternalBuff` 是因为 id 黑名单在需要时有用
 * （那种"不该改内容就按下"的场合），但它不该靠冗余项撑着。
 */
const INTERNAL_BUFF_IDS = new Set<string>();

/**
 * 该 buff 是否**不应该出现在图标条上**。
 *
 * 两个来源：
 *   1. id 在内部集合里（引擎标记）
 *   2. 内容里显式声明了 `hidden: true`
 *
 * 第二条让内容作者可以自己决定"这个 buff 不需要图标"
 * （公共冷却由按钮变灰表达、Boss 前摇由预警条表达），
 * 不必回头改这个文件。
 */
export function isInternalBuff(buffId: string, hidden?: boolean): boolean {
  if (hidden) return true;
  return INTERNAL_BUFF_IDS.has(buffId);
}

/** 拒绝原因 → 本地化 key 后缀。 */
/**
 * 按极性推导兜底色。
 *
 * 内容作者应尽量显式指定 `color` —— 同一极性下的不同 buff
 * （无敌 vs 急速）需要区分。这只是没指定时的保底。
 */
export function defaultBuffColor(polarity: string, buffId: string): number {
  if (isDefensiveBuff(buffId)) return POLARITY_COLORS.iframe;
  if (polarity === 'debuff') return POLARITY_COLORS.debuff;
  if (polarity === 'neutral') return POLARITY_COLORS.neutral;
  return POLARITY_COLORS.buff;
}

const POLARITY_COLORS = {
  buff: 0x6cc46c,
  debuff: 0xcc5555,
  neutral: 0x8a8ca0,
  iframe: 0xff7a55,
} as const;

/**
 * buff id → 极简标签的**语言 key**。
 *
 * 这张表的必要性：机制 id 与文案 key 不是同一套命名
 * （例如 `dodge-iframe` 的显示名是 `skill.dodge.name`）。
 * 没登记时回退到中性占位，不影响玩法。
 *
 * ==================================================================
 * ⚠️ 这张表**必须覆盖内容里每一个会显示的 buff**（不是"缺了也能跑"）
 * ==================================================================
 *
 * 缺项的后果是**静默**的：图标上是一个「？」，而"漏登记"与"这个 buff
 * 本来就没名字"在画面上长得一模一样。所以覆盖率由
 * `tests/unit/viewHelpers.test.ts` 钉住（`ALL_BUFFS` 的每一条都要有标签）
 * —— 加一个 buff 却忘了登记，测试会红。
 *
 * ⚠️ **`ALL_BUFFS` 不是"全部 buff id"**：`boss-enrage-active` 是引擎在
 * `core/combat/stats.ts` 里**现造**的（它的 `damageMultBoost` 是参数，
 * 塞不进静态注册表），所以必须在下面**显式登记**一条 —— 覆盖率测试看不见
 * 它（那条测试的输入就是 `ALL_BUFFS`）。
 */
const SHORT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'dodge-iframe': 'skill.dodge.name',
  /**
   * ⚠️ **补漏（2026-10-13 报的 bug）**：「闪」的 0.2 秒无敌窗口没登记，
   * 于是战斗 HUD 上那个图标一直显示「？」（截图里能看到）。
   *
   * 与 `dodge-iframe` 同源：它自己的 `BuffDef.nameKey` 就是
   * `skill.flash.name`（`data/kits/kaili.ts`），所以这里取同一个 key。
   */
  'flash-iframe': 'skill.flash.name',
  guard: 'skill.guard.name',
  focus: 'skill.focus.name',
  sunder: 'debuff.sunder.name',
  'boss-enrage': 'buffShort.enrage',
  /**
   * ⚠️ **引擎现造的 buff**（不在 `ALL_BUFFS` 里，见上面的说明）：
   * 「狂暴开始」那一刻挂上的，显示名沿用同一个「狂暴」。
   */
  'boss-enrage-active': 'buffShort.enrage',
  'boss-telegraph': 'buffShort.telegraph',
  /**
   * ⚠️ 下面这几条是**补漏**：它们原本没登记，于是命中了下方的兜底 ——
   * 而兜底当时是 `buffShort.telegraph`（"前摇"），导致**霸体 / 倒地 /
   * 派生窗口全被显示成"前摇"**。
   *
   * 症状很难从代码看出来（表是"允许缺项"的设计），只有在游戏里看到
   * 几个都叫「前摇」的图标才会发现。所以缺项要么补上，要么**兜底必须是
   * 中性的**（见 `shortLabelKeyOf`）。
   */
  'boss-armor': 'buffShort.bossArmor',
  /**
   * ⚠️ 傲慢的「碾压」霸体（`BOSS_HEAVY_ARMOR`）。
   *
   * 它的 `nameKey` 就是 `boss.armor.name`（"霸体"），与上面两条是同一个
   * 显示名 —— 玩家看到的是同一个东西，所以复用同一个短标签。
   */
  'boss-heavy-armor': 'buffShort.bossArmor',
  'combo-window': 'buffShort.comboWindow',
  knockdown: 'buffShort.knockdown',
  /** 色欲的眩晕与印记（不登记就会显示中性兜底「？」）。 */
  'lust-stun': 'buffShort.stunned',
  'lust-mark': 'buffShort.lustMark',
};

/**
 * **开发期**的"兜底被用到了"告警（每个 id 每局一次）。
 *
 * ⚠️ 这只是**第二道防线**：第一道是上面那条覆盖率测试 —— 它拦得住
 * "`ALL_BUFFS` 里的 buff 忘了登记"（终局覆盖），而测试**看不见**引擎现造
 * 的 id（`boss-enrage-active` 那类）。两者合起来才是闭环。
 *
 * ⚠️ 用 `import.meta.env.DEV` 而不是 `NODE_ENV`：这是**客户端**代码，
 * 判据跟"构建模式"走（生产构建里整段被摇掉）。所以它是**开发期**的声音，
 * 玩家看到的仍然是那个中性的「？」—— 那是**有意的兜底**，不该变成面向
 * 玩家的弹窗 / 报错（看不见名字时，"没登记"比"被一个错误的名字误导"好，
 * 见 `shortLabelKeyOf`）。
 */
const warnedUnknownShortLabels = new Set<string>();

export function warnUnknownShortLabel(buffId: string): void {
  if (!import.meta.env.DEV) return;
  if (warnedUnknownShortLabels.has(buffId)) return;
  warnedUnknownShortLabels.add(buffId);
  console.warn(
    `[buffShort] ${buffId} 没有短标签登记（显示成「？」）—— ` +
      `请在 src/app/viewHelpers.ts 的 SHORT_LABEL_KEYS 里补一条`,
  );
}

/**
 * buff → 极简标签的语言 key。
 *
 * ⚠️ **兜底不能是一个具体机制的名字。** 这里曾经写成
 * `?? 'buffShort.telegraph'`（"前摇"），而注释却说是"中性占位" ——
 * 于是每一个没登记的 buff 都显示"前摇"。
 *
 * 现在兜底到一个真正中性的 `buffShort.unknown`（"？"）：看不见名字时
 * 玩家知道"这个没名字"，而不是被一个**错误的**名字误导。
 */
export function shortLabelKeyOf(buffId: string): string {
  const key = SHORT_LABEL_KEYS[buffId];
  if (key !== undefined) return key;
  /**
   * ⚠️ 调用点就是渲染路径（`viewAdapter` 每帧为每个 buff 调一次），
   * 所以这里顺手喊一声 —— 开发期必须有人发现"又漏了一个"（见上面的
   * `warnUnknownShortLabel`）。测试环境里 `import.meta.env.DEV` 同为真，
   * 但覆盖率测试**不会**走到这个分支（它先把整张表断言一遍）。
   */
  warnUnknownShortLabel(buffId);
  return 'buffShort.unknown';
}

export function blockKeyOf(reason: string): string {
  switch (reason) {
    case 'cooldown':
      return 'cooldown';
    case 'cost':
      return 'cost';
    case 'condition':
      return 'condition';
    case 'casting':
      return 'casting';
    case 'locked':
      return 'locked';
    case 'tagRestricted':
      return 'tagRestricted';
    case 'target':
      return 'target';
    default:
      return 'condition';
  }
}

/** 事件的颜色规则（数据模型规范 §12 的 EventDef → 视觉）。 */
export function damageColor(amount: number, crit: boolean): number {
  if (crit) return 0xfff0a0;
  return amount >= 500 ? 0xffd080 : 0xf0f0f6;
}
