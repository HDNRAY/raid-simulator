/** 关卡定义。 */

import type { EntityId, LocaleKey } from './ids';
import type { Loadout } from './loadout';
import type { Condition } from './stats';
import type { Behavior } from './behavior';

/* ================================================================== *
 * 15. 关卡定义
 * ================================================================== */

export interface EncounterDef {
  readonly id: EntityId;
  readonly nameKey: LocaleKey;
  readonly player: Loadout;
  readonly boss: Loadout & { readonly behaviors: readonly Behavior[] };
  readonly victory: readonly Condition[];
  readonly defeat: readonly Condition[];
  readonly timeLimitMs?: number;
}
