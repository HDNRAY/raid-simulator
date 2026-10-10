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
 * 它们不是"玩家应该看到的增益/减益"，而是引擎的状态标记：
 *   - `gcd`：公共冷却，UI 通过技能格变灰表达，不需要图标
 *   - `boss-telegraph`：前摇标记，UI 通过预警条表达
 *   - `combo-window`：派生窗口，UI 通过技能格高亮表达
 *
 * 早期版本没做这个过滤，结果预警条上压着一个被裁掉的图标。
 */
const INTERNAL_BUFF_IDS = new Set(['gcd', 'boss-telegraph-active', 'boss-telegraph']);

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
  gcd: 'buffShort.gcd',
};

export function shortLabelKeyOf(buffId: string): string {
  return SHORT_LABEL_KEYS[buffId] ?? 'buffShort.telegraph';
}

export function blockKeyOf(reason: string): string {
  switch (reason) {
    case 'gcd':
      return 'gcd';
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
