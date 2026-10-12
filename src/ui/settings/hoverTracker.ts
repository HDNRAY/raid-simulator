/**
 * **鼠标悬停 → 焦点**的去重逻辑（"光标停着不动，方向键还走得动"）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。这一段是
 * `hoverSkill` 里真正难的那部分（判定 + 去重），与 Pixi 无关 ——
 * 按"拆 util"的做法切出来，面板只剩"调一次 hitTest、改一次焦点"。
 *
 * ==================================================================
 * 它解决的是什么问题（踩过的坑，整段搬过来）
 * ==================================================================
 *
 * 玩家原话："关键是 hover 停止后，方向键要依然有效。"
 *
 * 症状：光标停在一个格子上，用方向键把焦点移走 —— **焦点立刻被拽回来**，
 * 于是"方向键没反应"。原因是 `pointermove` 会在鼠标**极其轻微**的抖动下
 * 反复触发（甚至像素级抖动也算），每次都把焦点重设成光标所在那一格。
 *
 * 所以记住上一次悬停的格子，**同一个格子上的重复 hover 直接忽略**：
 *   - 光标停着不动（或微抖） → 方向键移走的焦点**留得住**
 *   - 光标真的移到另一格 → 才换焦点
 *   - 光标离开网格（`lastHoverId` 清空）→ 再移回来仍能选中它
 *
 * 清空那一步不能省：否则"移到 A → 方向键到 B → 移开 → 再移回 A"
 * 会因为 A 还是 `lastHoverId` 而**选不动 A**。
 */

import { hitTest, type SettingsTab } from './logic';
import type { KeyRow } from './rows';
import type { OperationMode } from '../../render/platform';

export interface HoverQuery {
  readonly tab: SettingsTab;
  /** **可见的 tab 表**（首页只有「通用」）—— 命中测试要用。 */
  readonly tabs: readonly SettingsTab[];
  readonly rows: readonly KeyRow[];
  readonly showKeyHints: boolean;
  /**
   * **当前操作方式**（唯一 flag）—— 命中测试要按它判"哪一块"。
   *
   * ⚠️ 悬停本身只在**键盘方式**下发生（面板已经挡掉了触屏那套），但这里
   * 仍要从调用方**收**这个值、不许写死 `'keyboard'`：写死就是第二个来源，
   * 而命中测试一旦与渲染用的方式不一致，坐标就会对到别的块上。
   */
  readonly mode: OperationMode;
}

/**
 * 悬停追踪器。
 *
 * 用法：把每次 `pointermove` 交给 `skillAt()`，拿到**要新聚焦的技能 id**
 * （`undefined` = 什么都不用改）。
 */
export class HoverTracker {
  private lastHoverId: string | undefined;

  /**
   * 这次悬停该聚焦谁。
   *
   * @returns 需要新聚焦的技能 id；`undefined` = 焦点不变
   *   （同一格上的重复 hover / 光标在网格之外）
   */
  skillAt(px: number, py: number, query: HoverQuery): string | undefined {
    const target = hitTest(px, py, {
      tab: query.tab,
      tabs: query.tabs,
      rowSkillIds: query.rows.map((r) => r.skillId),
      showKeyHints: query.showKeyHints,
      mode: query.mode,
    });
    if (target.kind !== 'keyRow') {
      /** 光标离开网格 → 清掉记录（见文件头最后一段：不清就"选不动 A"）。 */
      this.lastHoverId = undefined;
      return undefined;
    }
    if (target.skillId === this.lastHoverId) return undefined;
    this.lastHoverId = target.skillId;
    return target.skillId;
  }

  /** 面板关闭 / 切页时复位（不然下一页会拿旧格子做去重）。 */
  reset(): void {
    this.lastHoverId = undefined;
  }
}
