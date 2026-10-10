/**
 * 内容的**共享刻度与配色**。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `content.ts` 与 `bossSkills.ts` 都要它们。如果留在 `content.ts`，
 * 就构成**循环依赖**：
 *
 *   content.ts    →（要 Boss 技能）→ bossSkills.ts
 *   bossSkills.ts →（要 C / S）   → content.ts
 *
 * ESM 下循环依赖**不报错**，但会让其中一方读到 `undefined`
 * （实测：`Cannot read properties of undefined (reading 'boss')`，
 * 因为 `C` 尚未初始化就被使用）。
 *
 * 把共享的东西**下沉成叶子**：两边都向下依赖它，谁也不再依赖谁。
 */

/**
 * 内容刻度 = **展示刻度**。
 *
 * 内容是"100 血 / 10 伤害 / 10 缠"这种可读的小整数，UI 直接显示它，
 * 不需要任何换算。早期版本给血量乘了 10 而伤害没乘，
 * 结果 10 点伤害只打掉 1 点血、一场战斗要按上百次 ——
 * 统一成单一刻度之后这类错位不可能再发生。
 */
export function S(value: number): number {
  return value;
}
export const C = {
  attack: 0xd8d8e4,
  dodge: 0x60c8f0,
  guard: 0x9aa8d8,
  break: 0xffd050,
  blast: 0xff8040,
  focus: 0xa070e0,
  debuff: 0xd05050,
  boss: 0xff7040,
} as const;
