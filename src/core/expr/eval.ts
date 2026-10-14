/**
 * 表达式求值。
 *
 * 数据模型规范 §3：值是**结构化表达式**而不是函数。
 * 理由：函数不可序列化（存不了档、测不了、内容作者改不了），
 * 而且做不到"动态重算"。
 *
 * 本模块是纯计算，不修改任何状态 —— 这保证它可以在任意
 * 上下文（引擎 tick / 测试 / 调试面板）里安全调用。
 */

import { clamp, safeDiv } from '../numeric';
import type { Condition, Expr, ResourceKey, ResourcePoolRef, StatKey, Who } from '../types';

/**
 * 求值上下文。
 *
 * `getStat` 由调用方注入而不是在这里递归求值 —— 因为 stat 的求值
 * 依赖修正树（M1-3），两者必须解耦：
 *   表达式层只负责"怎么算"
 *   修正树层负责"算的顺序"
 */
export interface EvalContext {
  /** 读某个单位的某个属性（已完成相关阶段的值） */
  getStat(who: Who, stat: StatKey): number;
  /** 读资源当前值 */
  getResource(who: Who, resource: ResourceKey): number;
  /** 读资源上限 */
  getMaxResource(who: Who, resource: ResourceKey): number;
  /** 读 buff 层数（不存在返回 0） */
  getBuffStacks(who: Who, buffId: string): number;
  /**
   * 读内容实例的离散计数器。
   *
   * ⚠️ **引擎尚未实现**：战斗路径的实现是 `() => 0` 的桩（见
   * `core/combat/stats.ts`）。为了避免内容作者**静默算错**，
   * `validate.ts` 会拒绝任何用到 `Expr.counter` 的内容
   * （`COUNTER_UNIMPLEMENTED`）—— 实现之后把那条校验删掉。
   */
  getCounter(poolKey: string, counter: string): number;
  /**
   * 读某个命名空间下所有修正的当前值之和。
   *
   * 这是 `contrib` 的实现钩子：命名空间的值由修正树在结算时收集，
   * 于是"暴击触发的 buff 提供和某装备一样多的增伤"能动态跟随。
   */
  getContribution(namespace: string): number;
  /** 求值条件（`cond` 节点用） */
  evaluateCondition(cond: Condition): boolean;
}

/** 缺少 `contrib` 命名空间时的默认值。 */
const DEFAULT_CONTRIB = 0;

/**
 * 求值一个表达式。
 *
 * 所有分支都必须返回**有限数**：NaN 一旦进入状态就会顺着算术传播，
 * 而 `NaN <= 0` 恒为 false，表现为"打不死"且极难定位（见 numeric.ts）。
 * 所以每个可能产生非有限值的地方都过 `guard`。
 */
export function evalExpr(expr: Expr, ctx: EvalContext): number {
  switch (expr.e) {
    case 'const':
      return guard(expr.value);

    case 'stat':
      return guard(ctx.getStat(expr.who, expr.stat) * (expr.scale ?? 1));

    case 'resource':
      return guard(ctx.getResource(expr.who, expr.resource));

    case 'maxResource':
      return guard(ctx.getMaxResource(expr.who, expr.resource));

    case 'resourceRatio': {
      const max = guard(ctx.getMaxResource(expr.who, expr.resource));
      return clamp(safeDiv(guard(ctx.getResource(expr.who, expr.resource)), max), 0, 1);
    }

    case 'missingResourceRatio': {
      const max = guard(ctx.getMaxResource(expr.who, expr.resource));
      return clamp(1 - safeDiv(guard(ctx.getResource(expr.who, expr.resource)), max), 0, 1);
    }

    case 'hpRatio': {
      const max = guard(ctx.getMaxResource(expr.who, 'hp'));
      return clamp(safeDiv(guard(ctx.getResource(expr.who, 'hp')), max), 0, 1);
    }

    case 'buffStacks':
      return guard(ctx.getBuffStacks(expr.who, expr.buffId));

    case 'hasBuff':
      return ctx.getBuffStacks(expr.who, expr.buffId) > 0 ? 1 : 0;

    /**
     * ⚠️ 这条**能算**，但引擎还没有计数器：战斗路径的 `getCounter`
     * 是 `() => 0`，所以读出来恒为 0。内容里写它会被校验器
     * （`COUNTER_UNIMPLEMENTED`）拦下 —— 这里保留求值分支，是为了
     * "实现时只改上下文实现 + 删一条校验"，而不是连类型一起重加。
     */
    case 'counter':
      // 池子的引用方式与命名空间共用一套字符串约定，由调用方解释
      return guard(ctx.getCounter(counterRefId(expr.ref), expr.counter));

    case 'contrib': {
      const value = guard(ctx.getContribution(expr.namespace));
      // 命名空间不存在时用 fallback（而不是 0），
      // 这样内容作者可以给出"没有该来源时的默认值"
      return value === 0 ? guard(expr.fallback ?? DEFAULT_CONTRIB) : value;
    }

    case 'add': {
      // 用 Kahan 补偿求和：顺序不敏感（黄金重放测试依赖这一点）
      let sum = 0;
      let compensation = 0;
      for (const item of expr.of) {
        const y = evalExpr(item, ctx) - compensation;
        const t = sum + y;
        compensation = t - sum - y;
        sum = t;
      }
      return guard(sum);
    }

    case 'mul': {
      let product = 1;
      for (const item of expr.of) product *= evalExpr(item, ctx);
      return guard(product);
    }

    case 'min': {
      let result = Number.POSITIVE_INFINITY;
      for (const item of expr.of) result = Math.min(result, evalExpr(item, ctx));
      return Number.isFinite(result) ? result : 0;
    }

    case 'max': {
      let result = Number.NEGATIVE_INFINITY;
      for (const item of expr.of) result = Math.max(result, evalExpr(item, ctx));
      return Number.isFinite(result) ? result : 0;
    }

    case 'clamp': {
      const value = evalExpr(expr.value, ctx);
      const min = evalExpr(expr.min, ctx);
      const max = evalExpr(expr.max, ctx);
      return clamp(value, min, max);
    }

    case 'neg':
      return guard(-evalExpr(expr.value, ctx));

    case 'cond':
      return evalExpr(ctx.evaluateCondition(expr.if) ? expr.then : expr.else, ctx);
  }
}

/**
 * 把非有限值收成 0。
 *
 * **每个返回值都必须过这里** —— 不是只在外层 `add`/`mul` 上做。
 * NaN 一旦从任何一个叶子（比如某个上下文实现返回了 NaN）漏出去，
 * 就会顺着算术传播，而 `NaN <= 0` 恒为 false，最终表现为
 * "打不死"且极难定位。这道防线必须在**每个出口**上。
 */
function guard(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * 把 `ResourcePoolRef` 归一成字符串 id，供上下文实现查表。
 *
 * 归一化而不是各自 switch，是为了让"池子身份"这个概念只有一个表示 ——
 * 否则每个消费者都要自己处理三种引用方式。
 */
export function counterRefId(ref: ResourcePoolRef): string {
  switch (ref.kind) {
    case 'combatant':
      return ref.combatantId;
    case 'entity':
      return ref.entityInstanceId;
    case 'encounter':
      return '';
  }
}

/* ------------------------------------------------------------------ *
 * 便捷构造器：让内容数据写起来短一些
 * ------------------------------------------------------------------ */

export const constExpr = (value: number): Expr => ({ e: 'const', value });

export const statExpr = (stat: StatKey, who: Who = 'self'): Expr => ({ e: 'stat', who, stat });

export const buffStacksExpr = (buffId: string, who: Who = 'self'): Expr => ({
  e: 'buffStacks',
  who,
  buffId,
});

export const contribExpr = (namespace: string, fallback?: number): Expr => ({
  e: 'contrib',
  namespace,
  ...(fallback === undefined ? {} : { fallback }),
});

export const mulExpr = (...of: readonly Expr[]): Expr => ({ e: 'mul', of });
export const addExpr = (...of: readonly Expr[]): Expr => ({ e: 'add', of });
