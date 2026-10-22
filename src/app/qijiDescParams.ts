/**
 * **炁机说明里的数值，从定义里读**（2026-10-22，用户："炁机的数字是写死的还是
 * 读的代码？**应该读代码**"）。
 *
 * ==================================================================
 * 为什么不是"把数字写进语言包"
 * ==================================================================
 *
 * 语言包里写 `伤害增加 20%` 的那一版，调平衡时（把 0.2 改成 0.25）说明**不会变**
 * —— 玩家看到的是旧数字 ✗。而且没有任何测试能发现"文案与内容不一致"（除非
 * 逐条钉死数值，那又是 AGENTS §4b 明令不许的"钉字面值"）。
 *
 * 所以：**模板里放占位符**，值从 `QijiEntity` 里**读出来**。改内容 ⇒ 说明自动
 * 跟着变 ✓。
 *
 * ==================================================================
 * ⚠️ 参数按**语义**命名，不按"第几条规则"
 * ==================================================================
 *
 * 同一个数在说明里可能叫"增加 20%"、"减半"、"缠消耗 15" —— 但它们各自来自
 * **不同的字段**，所以参数也分开：读错字段会静默给出一个"看起来合理"的数 ✗，
 * 那比缺参数难查得多。因此：
 *
 * - **读不到就不给**（不猜、不默认成 0）⇒ 模板里也就不会有那个占位符
 *
 * | 参数 | 来源字段 |
 * |---|---|
 * | `{delta}` | `skillTweak.costDeltas[].delta`（取绝对值，说明里配"减少"）|
 * | `{castPercent}` | `skillTweak.castTimeScale`（0.5 ⇒ "减半" ⇒ 50）|
 * | `{damagePercent}` | `skillTweak.damageScale`（1.3 ⇒ 30）|
 * | `{percent}` | `passiveBuffs[0].modifiers[0].value`（0.2 ⇒ 20）|
 * | `{override}` | `skillTweak.buffOverrides[0].modifiers[0].value`（100 ⇒ 100%）|
 * | `{damage}` | 触发器 `then[].deal` 里那条 damage 的 `base` |
 * | `{seconds}` | 触发器 `cooldownMs` / buff `duration` |
 * | `{windowSeconds}` | `comboWindow.buff.duration`（派生窗口多长）|
 * | `{threshold}` | 触发器 `when.value`（`resourceBelow` 那类阈值）|
 * | `{stacks}` | buff `maxStacks`（"变成 3 层"）|
 * | `{amount}` | 触发器 `then[].resource.delta` / 修正里的**整数**值（回 10 缠）|
 */

import type { QijiEntity } from '../core/types/qiji';

/** 说明模板里能用的参数（缺的就不给）。 */
export type QijiDescParams = Readonly<Record<string, string>>;

/** 毫秒 → 秒（整数不带小数，其余保留一位，与 `displayTime` 同一口径）。 */
function secondsOf(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/** 0.2 ⇒ 20（百分比取整；非有限数返回 undefined）。 */
function percentOf(ratio: number | undefined): string | undefined {
  if (ratio === undefined || !Number.isFinite(ratio)) return undefined;
  return String(Math.round(ratio * 100));
}

/** 从一项能力里挖（`deal` 的伤害 / `resource` 的量 / `grant` 的 buff）。 */
interface AbilityHarvest {
  readonly damage?: number;
  readonly amount?: number;
  readonly stacks?: number;
  readonly percent?: string;
  readonly seconds?: string;
}

function harvestAbility(ability: unknown): AbilityHarvest {
  const out: {
    damage?: number;
    amount?: number;
    stacks?: number;
    percent?: string;
    seconds?: string;
  } = {};
  if (ability === null || typeof ability !== 'object') return out;
  const a = ability as { kind?: string; hit?: { effects?: readonly unknown[] }; resource?: { delta?: number }; buff?: unknown };
  if (a.kind === 'deal') {
    for (const effect of a.hit?.effects ?? []) {
      const e = effect as { kind?: string; damage?: { base?: number } };
      if (e.kind === 'damage' && typeof e.damage?.base === 'number') out.damage = e.damage.base;
    }
  }
  if (a.kind === 'resource' && typeof a.resource?.delta === 'number') out.amount = a.resource.delta;
  const buff = a.buff as { maxStacks?: number; duration?: number; modifiers?: readonly { value?: number }[] } | undefined;
  if (buff !== undefined) {
    if (typeof buff.maxStacks === 'number') out.stacks = buff.maxStacks;
    const value = buff.modifiers?.[0]?.value;
    if (typeof value === 'number') out.percent = percentOf(value);
    out.seconds = secondsOf(buff.duration);
  }
  return out;
}

/**
 * 从炁机定义里读出说明要用的数值。
 *
 * ⚠️ 只用**这个炁机自己**的字段（不跨池子找同名 buff）—— 说明写的就是它自己的
 * 效果；跨对象取值会让"这条炁机改了、那条说明跟着变"✗。
 */
export function qijiDescParamsOf(qiji: QijiEntity): QijiDescParams {
  const params: Record<string, string> = {};
  const tweak = qiji.skillTweak;

  const delta = tweak?.costDeltas?.[0]?.delta;
  if (typeof delta === 'number' && Number.isFinite(delta)) params.delta = String(Math.abs(delta));

  /** 读条 ×0.5 ⇒ "减半" ⇒ 50（说明里用"减半"也可以，参数留给百分比写法）。 */
  const castScale = tweak?.castTimeScale;
  if (typeof castScale === 'number' && Number.isFinite(castScale)) {
    params.castPercent = String(Math.round((1 - castScale) * 100));
  }

  const damageScale = tweak?.damageScale;
  if (typeof damageScale === 'number' && Number.isFinite(damageScale)) {
    params.damagePercent = String(Math.round((damageScale - 1) * 100));
  }

  const override = tweak?.buffOverrides?.[0]?.modifiers?.[0]?.value;
  if (typeof override === 'number' && Number.isFinite(override)) params.override = String(override);

  /** 用出技能时结算的那条能力（「避实击虚」挂蓄势 / 回缠那类）。 */
  const onUse = harvestAbility(tweak?.onUse);
  if (onUse.amount !== undefined) params.amount = String(onUse.amount);
  if (onUse.percent !== undefined) params.percent = onUse.percent;

  const buff = qiji.passiveBuffs?.[0];
  const trigger = buff?.triggers?.[0];

  const modifier = buff?.modifiers?.[0]?.value;
  if (typeof modifier === 'number' && Number.isFinite(modifier)) {
    /** 0.2 ⇒ 20%（百分比语义）；整数（如 30）是**点数**，走 `amount`。 */
    if (Number.isInteger(modifier)) params.amount = String(modifier);
    else params.percent = percentOf(modifier);
  }

  if (typeof buff?.maxStacks === 'number' && Number.isFinite(buff.maxStacks)) {
    params.stacks = String(buff.maxStacks);
  }

  const seconds = secondsOf(trigger?.cooldownMs) ?? secondsOf(buff?.duration);
  if (seconds !== undefined) params.seconds = seconds;

  const when = trigger?.when;
  if (when?.kind === 'resourceBelow') params.threshold = String(when.value);

  const then = harvestAbility(trigger?.then?.[0]);
  if (then.damage !== undefined) params.damage = String(then.damage);
  if (then.amount !== undefined) params.amount = String(then.amount);
  if (then.stacks !== undefined) params.stacks = String(then.stacks);
  if (then.percent !== undefined) params.percent = then.percent;
  if (then.seconds !== undefined) params.seconds = then.seconds;

  /** 派生窗口的时长（「闪」躲开一击后 3 秒内能派生「击」）。 */
  const windowSeconds = secondsOf((qiji.comboWindow?.buff as { duration?: number } | undefined)?.duration);
  if (windowSeconds !== undefined) params.windowSeconds = windowSeconds;

  return params;
}
