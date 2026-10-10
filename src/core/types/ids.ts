/** 基础标识（id 别名与阵营/资源键）。 */

/* ================================================================== *
 * 1. 基础标识
 * ================================================================== */

/**
 * 文案 key（**由 core 自己定义，不从 i18n 层 import**，即 lint 约束
 * C1/I3）：接口形状由消费者声明，实现方满足它 —— i18n 层有编译期断言
 * 证明 `MessageKey` 满足该形状，所以写错 key 仍会在编译期被拒。
 * 引擎只**持有** key，不解析文案。
 */
export type LocaleKey = string;

export type CombatantId = string;
export type EntityId = string;
export type SkillId = string;
export type BuffId = string;
export type ModifierNamespace = string;

export type Side = 'ally' | 'enemy';
