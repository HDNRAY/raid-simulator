/**
 * **攻击帧判定**：某个角色刚才是不是放了一个攻击招式。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `app/viewAdapter.ts` 已经贴着 700 行上限（AGENTS.md §3），而这段
 * 逻辑是**自成一体的一个小机制**：它只依赖"技能定义表 + 最近的施放记录"，
 * 与适配器的其它职责（飘字、状态行、受击反馈）没有交集。抽成纯函数后
 * 还能单独测 —— 而那正是它容易出错的地方（tag 判定、来源过滤、时间窗）。
 *
 * ==================================================================
 * ⚠️ 判定依据是 `SkillTag`，不是技能 id 列表
 * ==================================================================
 *
 * 需求："人物攻击，无论是那个攻击（tags实现）都播放 攻击帧。"
 *
 * 所以看的是技能的 `tags` 里有没有攻击类标签（`melee` / `spell`）。
 * 写死技能 id 列表的话，**加新攻击技能时必然漏** —— 而"漏"的表现是
 * "这一招没有攻击帧"，玩家只会觉得"这个技能怪怪的"。
 */

import type { SkillDef } from '../core/types';

/** 属于"攻击"的机械标签。`defensive` / `dodge` 不算。 */
const ATTACK_TAGS: readonly string[] = ['melee', 'spell'];

/**
 * 攻击帧显示多少 tick。
 *
 * 6 tick ≈ 0.1 秒。
 *
 * ⚠️ **必须大于 1**：60fps 下单帧只有 16ms，肉眼看不见 —— 那等于没做。
 * 需求说"一帧就行了"指的是"**不需要做多帧动画**"，不是"短到看不见"。
 */
export const ATTACK_FRAME_TICKS = 6;

/** 最近施放记录的键：`${sourceId}:${skillId}`。 */
export function lastUsedKey(sourceId: string, skillId: string): string {
  return `${sourceId}:${skillId}`;
}

/**
 * `id` 这个角色在最近 `ATTACK_FRAME_TICKS` 内放过攻击招式吗。
 *
 * @param lastUsed 键为 `lastUsedKey()` 的记录表
 * @param tick 当前 tick
 */
export function isAttacking(
  lastUsed: ReadonlyMap<string, number>,
  skills: ReadonlyMap<string, SkillDef>,
  id: string,
  tick: number,
): boolean {
  const prefix = `${id}:`;
  for (const [key, at] of lastUsed) {
    /** ⚠️ 必须按来源过滤：否则 Boss 放攻击技会让**玩家**也播攻击帧。 */
    if (!key.startsWith(prefix)) continue;
    if (tick - at > ATTACK_FRAME_TICKS) continue;
    const skillId = key.slice(prefix.length);
    const tags = skills.get(skillId)?.tags ?? [];
    if (ATTACK_TAGS.some((t) => tags.includes(t as never))) return true;
  }
  return false;
}
