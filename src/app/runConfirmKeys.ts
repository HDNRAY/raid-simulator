/**
 * **确认出战屏的按键路由**（2026-10-22 从 `loopWiring` 横向切出来）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * `loopWiring` 已经贴着 AGENTS §3 的 700 行上限（一次性加了三类键就会超 ✗），
 * 而"确认屏的键"是**自成一体的一个状态机**：它只认 5 个键、只调 4 个方法，
 * 与战斗 / 备战没有任何交集。搬出来之后 `loopWiring` 那边只剩一行调用。
 *
 * ==================================================================
 * 键位（用户 2026-10-22 定的）
 * ==================================================================
 *
 * ```
 * Tab / Shift+Tab     焦点在 炁机 → 对手 → 恶魔低语 → 开始战斗 之间切（环绕）
 * ↑ ↓                 同 Tab（这一屏没有"行内滚动"，所以裸 ↑↓ 走焦点）
 * Shift + ↑ ↓         滚右侧详情正文
 * ← →                 **炁机块内切换**（这一局选了多条时；见 `cycleQiji`）
 * Enter / Space       开始这一场
 * ```
 *
 * ⚠️ `← →` 在这一屏**只**服务于"炁机块内切换"：这一屏不能改选，块外没有
 * 别的含义。别把它改成"切站"（那是 Tab / ↑↓ 的活）。
 */

/** 这一屏需要的能力（与 `CanvasHost.runConfirm` 同形，只取用到的部分）。 */
export interface RunConfirmKeyHost {
  moveFocus(delta: number): void;
  scrollDetail(dir: 'up' | 'down'): void;
  cycleQiji(delta: number): void;
  confirm(): void;
}

/**
 * 把一次按键交给确认屏。
 *
 * @returns 有没有消费（`false` = 这一屏不认这个键，调用方继续往下走）
 */
export function routeRunConfirmKey(args: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly host: RunConfirmKeyHost;
}): boolean {
  const { key, shiftKey, host } = args;
  switch (key) {
    case 'Tab':
      host.moveFocus(shiftKey ? -1 : 1);
      return true;
    case 'ArrowUp':
    case 'ArrowDown': {
      const dir = key === 'ArrowUp' ? 'up' : 'down';
      if (shiftKey) host.scrollDetail(dir);
      else host.moveFocus(dir === 'up' ? -1 : 1);
      return true;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
      host.cycleQiji(key === 'ArrowLeft' ? -1 : 1);
      return true;
    case 'Enter':
    case ' ':
      host.confirm();
      return true;
    default:
      return false;
  }
}
