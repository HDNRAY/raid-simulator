/**
 * **备战屏的构造参数**（`PrepareScreen` 需要什么才算装得起来）。
 *
 * ==================================================================
 * 它是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是这一屏对**外部世界**的全部依赖：要显示的人物 / 对手 / 炁机、详情区的
 * 取值函数、几个回调（开战 / 存档 / 设置 / 返回）。
 *
 * ==================================================================
 * 为什么从 `PrepareScreen.ts` 切出来（AGENTS.md §3 的关注分离）
 * ==================================================================
 *
 * 2026-10-13 第二轮（手风琴）动 `PrepareScreen.ts` 之前它已经 **697 行**，
 * 贴着 700 的上限。按 §3 的正确顺序，**先拆 util**（接口定义是最典型的
 * 可拆 util），而不是压注释。
 *
 * | 文件 | 一句话 |
 * |---|---|
 * | 本文件 | 备战屏要什么（依赖的形状） |
 * | `PrepareScreen.ts` | 光标与选择怎么走、每帧把状态喂给谁 |
 *
 * ⚠️ `PrepareScreen.ts` 仍然**转发**这两个类型（`export type { … }`），
 * 所以 `app/screenSetup.ts` 的导入一行都不用改 —— 拆文件不该改调用方的
 * import 路径（那是纯噪音，还会让 review 看不出真正动了什么）。
 */

import type { RosterEntry } from '../data/roster';
import type { TranslateFn } from '../i18n/translator';
import type { DetailContext } from './prepareDetail';
import type { FreeQiji } from './prepareLogic';
import type { PixiCtor } from './primitives';

/**
 * 炁机在这一屏需要的最小形状。
 *
 * ⚠️ 与 `core/types/qiji.ts` 的 `QijiEntity` **刻意不同**（结构性类型）：
 * 这一屏只用得到"叫什么"，而 `QijiEntity` 带着 `abilities` / `unlock` /
 * `comboWindow` / `skillTweak` 那些战斗期（与**肉鸽**）的知识。收窄之后
 * 单测可以喂 2 个字面量。
 *
 * ⚠️ **没有层数**：备战屏的炁机是**开关**，没有层数（见 `ui/freeQiji.ts`
 * 的文件头）。⚠️ 肉鸽那边的 `maxStacks` **已经整条删除**（2026-10-13：
 * 一局只能选一次、不叠加），所以"炁机的层数"这件事**两个模式都没有了**。
 */
export interface PrepareQijiOption {
  readonly id: string;
  readonly nameKey: string;
}

export interface PrepareScreenOptions {
  readonly pixi: PixiCtor;
  readonly translate: TranslateFn;
  readonly players: readonly RosterEntry[];
  readonly bosses: readonly RosterEntry[];
  /** 可选炁机（**从内容表读**，不写死条数）。 */
  readonly qiji: readonly PrepareQijiOption[];
  /**
   * 详情区的数据装配（`app/prepareDetailContext.prepareDetailContext`）。
   *
   * ⚠️ **注入**而不是在这里 import 内容表：本文件是"装配"，而"Boss 的
   * 招式叫什么、说明里的秒数是多少"是内容层的知识。注入之后这一屏在
   * 测试里可以喂假上下文（与 `prepareLogic.canStartBattle` 注入
   * `developing` 同一条纪律）。
   */
  readonly detailContext: (free: { readonly on: (id: string) => boolean }) => DetailContext;
  readonly initial: { readonly playerId: string; readonly bossId: string };
  /** 上次存下来的炁机激活状态（没开的条目不出现）。 */
  readonly freeQiji?: FreeQiji | undefined;
  /** 是否显示键位提示（触屏为假）。见 `HomeScreenOptions.showKeyHints`。 */
  readonly showKeyHints: () => boolean;
  /** 点右上角的齿轮（打开设置）。见 `HomeScreenOptions.onGear`。 */
  readonly onGear: () => void;
  /** 点左上角的返回箭头（回首页）—— 触屏对等靠它（AGENTS.md §3b）。 */
  readonly onBack?: (() => void) | undefined;
  /** `F1` 的显示名（齿轮的键位提示）。 */
  readonly f1Label: () => string;
  /** 点了「开始」。 */
  readonly onStart: (playerId: string, bossId: string) => void;
  /** 选择变了（用于持久化）。 */
  readonly onChange?: (playerId: string, bossId: string) => void;
  /**
   * 炁机的激活状态变了（用于持久化）。
   *
   * ⚠️ 它**只报激活集合**，不报"哪一条变了"：调用方（`app/`）要的是
   * "存什么"，而"哪一条"是界面的事 —— 多传一个 id 只会让两边都要维护
   * 一个用不上的字段。
   */
  readonly onQijiChange?: (free: FreeQiji) => void;
}
