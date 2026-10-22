/**
 * **图鉴的条目怎么算**（2026-10-20）。
 *
 * ==================================================================
 * 为什么在 `app/` 而不是 `ui/`
 * ==================================================================
 *
 * 判定"已解锁"要 `core/run/unlock.isUnlocked`（求值 `QijiUnlock`）——
 * 而 `ui/` **不许** import core 的内部模块（架构规范 C3，
 * `raid/render/no-core-internals` 是一条 ESLint 规则，不是口头约定）。
 *
 * 于是：**算在这里、画在 `ui/CodexScreen`**，两边只共用 `CodexEntry` 这个
 * 形状（声明在 `ui/codexLogic`，因为它属于"界面要什么"）。
 *
 * ==================================================================
 * 没有进行中的一局时
 * ==================================================================
 *
 * 拿不到统计 ⇒ 只认 `unlock.kind === 'always'` 的那几条（它们本来就不需要
 * 统计）。**不伪造**"整局统计"：那会让"已解锁"变成一个说不清的数字。
 */

import { isUnlocked, type UnlockStats } from '../core/run/index';
import type { QijiEntity } from '../core/types/qiji';
import type { CodexEntry } from '../ui/codexLogic';
import type { QijiUnlock } from '../core/types/qiji';

/**
 * 图鉴的条目（顺序 = 池子顺序）。
 *
 * @param stats 解锁判定要的统计；**没有进行中的一局时给 `undefined`**
 * @param devMode 开发模式：内容照实显示，但 `unlocked` 仍是真话
 */
export function codexEntriesOf(args: {
  readonly pool: readonly QijiEntity[];
  readonly stats: UnlockStats | undefined;
  readonly devMode: boolean;
  /** 解锁条件 → 人话（`app/unlockText.unlockTextOf`；注入是为了可测）。 */
  readonly unlockText: (unlock: QijiUnlock) => string;
  /** 说明模板里要的数值（从炁机定义读，见 `app/qijiDescParams`）。 */
  /**
   * 说明模板里要的数值（从炁机定义读）。
   *
   * ⚠️ **可选**：老的调用点（测试里的假 pool）不传也能跑 —— 缺省就"没有参数"，
   * 模板里的占位符会原样留在文字里（那种调用点本来就没有真实内容）。
   */
  readonly descParams?: (qiji: QijiEntity) => Readonly<Record<string, string>>;
}): readonly CodexEntry[] {
  return args.pool.map((qiji) => {
    const unlocked = args.stats === undefined
      ? qiji.unlock.kind === 'always'
      : isUnlocked(qiji, args.stats);
    const show = unlocked || args.devMode;
    return {
      id: qiji.id,
      nameKey: show ? qiji.nameKey : undefined,
      descKey: show ? qiji.descKey : undefined,
      descParams: show ? args.descParams?.(qiji) : undefined,
      unlocked,
      unlockText: args.unlockText(qiji.unlock),
    };
  });
}
