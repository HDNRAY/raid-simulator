/**
 * **法术动画的帧组**（2026-10-22，圣光弹 = `FDOTHER_028`）。
 *
 * ==================================================================
 * 帧组的边界是怎么算出来的（不是硬编码）
 * ==================================================================
 *
 * 原版把一段法术动画导出成"很多帧"，而**每帧的坐标都不一样**（那正是
 * 用户提醒的："这个动画 不同阶段的帧坐标 好像是不一样的"）。028 的
 * `animation.json` 里能直接读到每帧的 `x / y / width / height`，而
 * **几何序列会周期性地重复**：
 *
 * ```
 *   一组 = 2 帧"光带/轨迹"（宽 122 / 250）+ 6 帧膨胀星爆（41→143，逐步变大）
 *   028 = 4 组 × 8 帧，四组的 (w,h) 序列完全相同，只有 x/y 平移
 * ```
 *
 * 所以判据是"**找 `(w,h)` 序列的最小周期**"：`p` 满足
 * `seq[i] === seq[i + p]` 对所有权值都成立 ⇒ 一组 `p` 帧。找不到周期就
 * 当成**一组**（整段播一遍）。这样换别的法术也成立，不用为每个法术写表。
 *
 * ==================================================================
 * 为什么这里只有纯函数
 * ==================================================================
 *
 * 加载纹理、摆位置、按帧推进都在 `spellBurst.ts`（那要碰 Pixi）；这一份
 * 只做"几何 → 分组 → 该画第几帧"的算术，所以能在 node 里精确测。
 */

/** 一帧的几何（`animation.json` 里我们用的那几个字段）。 */
export interface SpellFrameGeometry {
  readonly width: number;
  readonly height: number;
  /**
   * 这一帧在原版画布里的**绝对左上角**（`animation.json` 的 `x/y`）。
   *
   * ⚠️ 分组的判据**不看它**（只看 `width/height`）—— 四组之间 x/y 本来就
   * 不同（那正是"四次出手"的平移），拿它参与分组会把同一段动画切碎 ✗。
   * 它只用于**画**（见 `spellBurst.draw`）。
   */
  readonly x: number;
  readonly y: number;
}

/**
 * 按几何周期性**切帧组**，返回每组的起始下标（第 0 组永远从 0 开始）。
 *
 * @returns 组起点数组。长度 = 组数；每组的长度 = 下一个起点 − 本起点
 *   （最后一组到末尾）。单组时返回 `[0]`。
 */
export function spellFrameGroupStarts(frames: readonly SpellFrameGeometry[]): readonly number[] {
  const count = frames.length;
  if (count < 2) return count === 1 ? [0] : [];

  /**
   * ⚠️ **不能用"整段 (w,h) 序列严格重复"来切**（第一版就是这么写的，
   * 实测在真实素材上**切不出来**）：028 的四组只差 2~6 个像素
   * （`122×98` vs `122×96`），严格相等一条都匹配不上 ✗。
   *
   * 换成**结构判据**：每组都从"**最小的一帧**"开始膨胀（028 是 41×41，
   * 四组各一张）。于是：
   *
   *   1. 找出所有"宽度 = 最小宽度"的帧 ⇒ 它们就是每一组的**起爆点**
   *   2. 组间距 = 前两个起爆点的距离
   *   3. 组起点 = 起爆点 − 第一组的起爆点（把"起手的光带帧"算进组里）
   *
   * 这条判据只用**素材自己的几何**（没有魔法数），换别的法术也成立：
   * 只要"每组从同一个最小尺寸开始膨胀"，就能切出来。
   */
  const minWidth = Math.min(...frames.map((frame) => frame.width));
  const markers: number[] = [];
  frames.forEach((frame, index) => {
    if (frame.width === minWidth) markers.push(index);
  });
  if (markers.length < 2) return [0];

  const leadIn = markers[0] ?? 0;
  const first = markers[1];
  const second = markers[0];
  if (first === undefined || second === undefined) return [0];
  const spacing = first - second;

  /** 间距必须一致，否则不是"同一段动画的重复" ⇒ 当成一组。 */
  for (let i = 2; i < markers.length; i += 1) {
    if ((markers[i] ?? 0) - (markers[i - 1] ?? 0) !== spacing) return [0];
  }

  const starts: number[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = (markers[i] ?? 0) - leadIn;
    /** 起点必须是递增的、且第一组从 0 开始。 */
    if (start < 0 || (starts.length > 0 && start <= (starts[starts.length - 1] ?? -1))) return [0];
    starts.push(start);
  }
  return starts[0] === 0 ? starts : [0];
}

/** 组数（= 可以轮换的"攻击帧组"个数）。 */
export function spellFrameGroupCount(frames: readonly SpellFrameGeometry[]): number {
  return Math.max(1, spellFrameGroupStarts(frames).length);
}

/**
 * 下一次伤害该播**第几组**（顺序循环，用户 2026-10-22："按顺序"）。
 *
 * @param current 上一次播的组下标；`undefined`（还没播过）⇒ 第 0 组
 */
export function nextSpellGroup(current: number | undefined, groupCount: number): number {
  if (groupCount <= 0) return 0;
  if (current === undefined) return 0;
  return (current + 1) % groupCount;
}

/**
 * 这一组里、已经过了 `elapsedMs` 该画第几帧（按 `delay_native` 加权）。
 *
 * @param delays 每帧的停留时长（单位由调用方统一缩放，见 `spellBurst`）
 * @returns 帧下标；超过末尾就停在最后一帧
 */
export function spellFrameAtElapsed(delays: readonly number[], elapsedMs: number): number {
  if (delays.length === 0) return 0;
  let rest = Math.max(0, elapsedMs);
  for (let i = 0; i < delays.length; i += 1) {
    const duration = delays[i] ?? 0;
    if (rest < duration) return i;
    rest -= duration;
  }
  return delays.length - 1;
}
