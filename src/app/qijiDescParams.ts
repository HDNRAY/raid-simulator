/**
 * **炁机说明里的数值，从定义里读**（2026-10-22，用户："炁机的数字是写死的
 * 还是读的代码？**应该读代码**"）。
 *
 * ==================================================================
 * 为什么不是"把数字写进语言包"
 * ==================================================================
 *
 * 语言包里写 `伤害增加 20%` 的那一版，调平衡时（把 0.2 改成 0.25）说明**不会变**
 * —— 玩家看到的是旧数字 ✗。而且没有任何测试能发现"文案与内容不一致"（除非
 * 逐条钉死数值，那又是 AGENTS §4b 明令不许的"钉字面值"）。
 *
 * 所以：**模板里放占位符**（`{percent}` / `{damage}` / `{seconds}` …），值从
 * `QijiEntity` 里**读出来**。改内容 ⇒ 说明自动跟着变 ✓。
 *
 * ==================================================================
 * 读哪几个字段（按"离机制最近"的顺序）
 * ==================================================================
 *
 * | 占位符 | 来源 |
 * |---|---|
 * | `{seconds}` | `passiveBuffs[].duration` / `triggers[].cooldownMs`（`logicMs` ⇒ 秒）|
 * | `{damage}` | `triggers[].then[].deal.damage.base` / `abilities[].damage` |
 * | `{percent}` | `modifiers[].value`（0.2 ⇒ 20）|
 * | `{delta}` | `skillTweak.costDeltas[].delta`（负值取绝对值，说明里配"减少"）|
 * | `{stacks}` | `maxStacks` / `modifiers[].maxStacks` |
 * | `{threshold}` | `triggers[].when.value`（`resourceBelow` 那类阈值）|
 *
 * ⚠️ **只做这一层**：读不到就不给参数（模板里也就没有占位符），**不猜**、不默认
 * 成 0 —— 静默填错数比"没上色"难查得多。
 */

import type { QijiEntity } from '../core/types/qiji';

/** 说明模板里能用的参数（缺的就不给）。 */
export type QijiDescParams = Readonly<Record<string, string>>;

/** 把毫秒换成"秒"的字符串（整数不带小数，其余保留一位）。 */
function secondsOf(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

/**
 * 从炁机定义里读出说明要用的数值。
 *
 * ⚠️ 一个炁机的数值可能同时存在于"挂的 buff"与"触发器"里（`passiveBuffs[0]`
 * 上的修正 + `triggers[0]` 的结算）—— 这里**按优先级各取第一个能读到的**，
 * 与说明的写法一一对应；读不到就留空（模板里自然没有那个占位符）。
 */
export function qijiDescParamsOf(qiji: QijiEntity): QijiDescParams {
  const params: Record<string, string> = {};
  const buff = qiji.passiveBuffs?.[0];
  const trigger = buff?.triggers?.[0];
  const then = trigger?.then?.[0];

  const modifier = buff?.modifiers?.[0]?.value;
  if (typeof modifier === 'number' && Number.isFinite(modifier)) {
    params.percent = String(Math.round(Math.abs(modifier) * 100));
  }

  const stacks = buff?.maxStacks;
  if (typeof stacks === 'number' && Number.isFinite(stacks)) params.stacks = String(stacks);

  const seconds = secondsOf(trigger?.cooldownMs) ?? secondsOf(buff?.duration);
  if (seconds !== undefined) params.seconds = seconds;

  /** `deal` 的伤害在 `hit.effects` 里那条 `kind:'damage'` 的 `damage.base` 上。 */
  if (then?.kind === 'deal') {
    const effect = then.hit.effects.find((e) => e.kind === 'damage');
    const base = effect?.damage?.base;
    if (typeof base === 'number' && Number.isFinite(base)) params.damage = String(base);
  }

  const threshold = trigger?.when?.kind === 'resourceBelow' ? trigger.when.value : undefined;
  if (typeof threshold === 'number' && Number.isFinite(threshold)) {
    params.threshold = String(threshold);
  }

  const delta = qiji.skillTweak?.costDeltas?.[0]?.delta;
  if (typeof delta === 'number' && Number.isFinite(delta)) params.delta = String(Math.abs(delta));

  return params;
}
