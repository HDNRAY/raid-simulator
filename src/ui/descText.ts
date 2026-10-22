/**
 * **带参数的说明文本**（2026-10-22，用户报的两条显示 bug）。
 *
 * 用户原话：
 * > 炁机激活界面，我看到了 **{amount}**…… **炁机的描述没有加载**
 *
 * 根因是同一个：炁机选择屏取说明时**没传参数**（`t(descKey)`），模板里的
 * `{amount}` / `{seconds}` 没被替换 ⇒ 界面上直接出现花括号 ✗。
 *
 * ==================================================================
 * 为什么兜底要"抹掉没填上的占位符"
 * ==================================================================
 *
 * `qijiDescParamsOf` 的策略是"**读不到就不给参数**"（不猜、不默认 0）——
 * 那条策略是为了让"说明与定义脱钩"能被测试抓到，**不是**为了让界面显示
 * 花括号 ✗。所以渲染这一层必须再兜一次：
 *
 * - 参数齐 ⇒ 正常显示
 * - 缺参数 ⇒ 那个占位符**整段消失**（宁可不显示那个数，也不要在界面上
 *   出现 `{amount}` —— 玩家会以为那是漏出来的内部东西）
 *
 * ⚠️ 它是**渲染层**的兜底，不是"容忍缺参"：`tests/unit/qijiDescParams.test.ts`
 * 里那条"每条炁机的每个占位符都能取到值"仍然必须绿 —— 兜底只是"万一"。
 */

import type { TranslateFn } from '../i18n/translator';

/**
 * 取一段说明并填参数。
 *
 * @param translate `t`（带 `params` 的那一层）
 * @param key 文案键
 * @param params 由内容定义算出来的参数（可能缺）
 * @returns 已经**不含 `{…}`** 的最终文本
 */
export function descTextOf(
  translate: TranslateFn,
  key: string,
  params?: Readonly<Record<string, string>>,
): string {
  const text = translate(key, params);
  /**
   * 兜底：`{xxx}` 里的东西**连同它的分隔符**一起去掉。
   *
   * ⚠️ 只抹 `{` / `}` 本身会把 "回{amount}缠" 变成 "回缠"（读得通 ✓），
   * 但 "造成{damage}点伤害" 会变成 "造成点伤害"（别扭 ✗）——
   * 所以这里**先试"整段是否就只剩一个占位符"**：那种情况整条降级成空串，
   * 由调用方决定不显示（比显示一个残句好）。
   */
  if (!text.includes('{')) return text;
  const stripped = text.replace(/\{\w+\}/g, '').trim();
  if (stripped === '') return '';
  return stripped;
}
