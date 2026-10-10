/**
 * 引擎的数据模型类型 —— **按概念分段放在本目录下**。
 *
 * 原先是一个 `types.ts`（971 行），顶到了 AGENTS.md §3 的 700 行上限。
 * 按"横向切割"拆成一个目录：每一段（标识 / 资源 / 属性 / Buff / 触发 /
 * 效果 / Ability / 技能 / 配装 / 行为 / 运行时 / 关卡）各自一个文件，
 * 每个都远低于上限，以后加类型不再触线。
 *
 * ⚠️ 段与段之间**必然互相引用**（`SkillDef` 要 `Cost`，`Cost` 要 `Expr`…），
 * 所以这里只做**同目录相对 import**。这些都是 `import type`，编译期即
 * 擦除，**不产生运行期的 import 环** —— 这正是能横向切的前提。
 *
 * 本文件只是**转发**，方便 `from '../core/types'` 这种整体导入。
 */

export * from './ids';
export * from './resources';
export * from './stats';
export * from './buffs';
export * from './triggers';
export * from './effects';
export * from './abilities';
export * from './skills';
export * from './loadout';
export * from './behavior';
export * from './runtime';
export * from './encounter';

/** 事件 / 输入的定义在各自的叶子里（见其文件头）。 */
export type { EncounterEndEvent, EventDef, EventKind, SkillRejectReason } from '../events';
export type { Action, ActionType } from '../actions';
