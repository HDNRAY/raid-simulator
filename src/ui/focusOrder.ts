/**
 * **焦点走位的唯一实现**（顺序 → 跳过不能停的站 → 到边停 / 环绕）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 全仓库有**两处**"用 Tab / 方向键在一串站之间走"的地方：
 *
 * | 谁 | 站 | 顺序从哪来 |
 * |---|---|---|
 * | 备战屏 / 选角色屏（`prepareLogic.moveFocus`） | 人物 → 炁机 → 对手 → 开始 | 固定 4 站，空的跳过 |
 * | 肉鸽确认屏（`runConfirmFocus`） | 炁机 → 对手 → **恶魔低语** → 开始 | 同一套规则，但站的**集合**不同 |
 *
 * 两边的**状态形状**不一样（备战屏那份带"每个槽位各自的光标"与
 * "手风琴展开块"，确认屏只有"焦点 + 展开块"），所以状态类型不该硬合成
 * 一个（那会让"这一屏需要什么"变模糊）。**但"怎么走"是同一段算法** ——
 * 于是它住在这里，两处都调它。§2 那条"同一份算法只许有一份实现"因此
 * 是**结构上**成立的，而不是靠两边各写一遍再对齐。
 *
 * ⚠️ 判据是**纯函数**：不读时间、不读随机、不碰 DOM。跳站由调用方给的
 * `canFocus` 决定（"哪个槽位是空的"是调用方才知道的事）。
 */

export interface StepFocusArgs<T extends string> {
  /** 此刻停在哪一站。 */
  readonly current: T;
  /** 站的顺序（从前往后 = Tab 的方向）。 */
  readonly order: readonly T[];
  /** 走几步：正数往后、负数往前。 */
  readonly delta: number;
  /** 到头之后**环绕**（默认不环绕：到边就停）。 */
  readonly wrap?: boolean;
  /** 这一站能不能停（`false` = 跳过，例如"一个炁机都没选"时那一行不存在）。 */
  readonly canFocus: (candidate: T) => boolean;
}

/**
 * 走一步（可以跨过若干不能停的站）。
 *
 * @returns 新的站；**一动也不动**时返回 `current` 本身（调用方据此判断
 *   "这次按键白按了"，不必自己比较）
 */
export function stepFocus<T extends string>(args: StepFocusArgs<T>): T {
  const { order } = args;
  const step = args.delta >= 0 ? 1 : -1;
  /** ⚠️ 找不到当前站时按第 0 站算（防守：状态里出现了已删掉的站）。 */
  const from = Math.max(0, order.indexOf(args.current));

  if (args.wrap === true) {
    for (let i = 1; i <= order.length; i += 1) {
      const candidate = order[(from + step * i + order.length) % order.length];
      if (candidate !== undefined && args.canFocus(candidate)) return candidate;
    }
    return args.current;
  }

  for (let idx = from + step; idx >= 0 && idx < order.length; idx += step) {
    const candidate = order[idx];
    if (candidate !== undefined && args.canFocus(candidate)) return candidate;
  }
  return args.current;
}
