/**
 * 设置页底部那行**提示**（"已恢复默认键位" / "X 是系统保留键"）的状态。
 *
 * ==================================================================
 * 为什么单独一小块
 * ==================================================================
 *
 * `SettingsPanel.ts` 顶到 700 行上限（AGENTS.md §3）。这一段是**自带
 * 生命周期**的一小块（一段时间后自己消失），与面板的其余状态
 * （焦点 / 键位 / 捕获）没有交集 —— 切出来之后面板只转发。
 *
 * ⚠️ 计时口径：`ttl` 的单位是**帧**（由主循环每帧调 `tick()`）——
 * 与面板原先的 `noticeTtl` 完全一致（180 帧 ≈ 3 秒 @60Hz）。
 * 不用 `Date.now()`：那是这个仓库的既有纪律（渲染层不该自己读时钟）。
 */

/** 提示显示的帧数（= 3 秒 @60Hz，与原先的 180 相同）。 */
export const NOTICE_TTL_FRAMES = 180;

export class PanelNotice {
  private content = '';
  private ttl = 0;

  /** 当前提示（空串 = 没有提示）。 */
  get text(): string {
    return this.content;
  }

  set(text: string): void {
    this.content = text;
    this.ttl = NOTICE_TTL_FRAMES;
  }

  clear(): void {
    this.content = '';
    this.ttl = 0;
  }

  /**
   * 每帧调用。
   *
   * @returns 这次**刚好**到期（调用方据此重画一次，把提示抹掉）
   */
  tick(): boolean {
    if (this.ttl <= 0) return false;
    this.ttl -= 1;
    if (this.ttl > 0) return false;
    this.content = '';
    return true;
  }
}
