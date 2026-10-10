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
 * （例如 `dodge-iframe` 的显示名是 `buffShort.dodgeIframe`）。
 * 没登记时回退到中性占位，不影响玩法。
 */
const SHORT_LABEL_KEYS: Readonly<Record<string, string>> = {
  'dodge-iframe': 'skill.dodge.name',
  guard: 'skill.guard.name',
  focus: 'skill.focus.name',
  sunder: 'debuff.sunder.name',
  'boss-enrage': 'buffShort.enrage',
  'boss-empowered': 'buffShort.empowered',
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
  'boss-cleave-armor': 'buffShort.bossArmor',
  'combo-window': 'buffShort.comboWindow',
  knockdown: 'buffShort.knockdown',
};

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
  return SHORT_LABEL_KEYS[buffId] ?? 'buffShort.unknown';
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
