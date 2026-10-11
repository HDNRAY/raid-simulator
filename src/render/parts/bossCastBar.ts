/**
 * Boss 的**预警条**（读条 / 剩余秒数 / 招式提示标签）。
 *
 * 帧部件。语义与玩家读条**故意不同**：这条是威胁，
 * 颜色表达"能不能打断"。
 */

import type { CastBar } from '../../ui/CastBar';
import { PALETTE } from '../theme';
import type { FrameContext, FramePart } from '../sceneTypes';

/** Boss 预警条部件。 */
export class BossCastBarPart implements FramePart {
  readonly name = 'bossCastBar';

  constructor(private readonly castBar: CastBar) {}

  render(ctx: FrameContext): void {
    const { view, translate } = ctx;
    const cast = view.boss.cast;
    this.castBar.visible = cast !== undefined;
    if (!cast) return;
    /**
     * 招式的提示标签（需求："boss 的招式的 tags 显示在它的读条中"）。
     *
     * 「霸体」= 打不断，别浪费「破」；「高伤」= 闪避比防御更值；
     * 「倒地」「眩晕」= 挨到就会被控住（那是**后果**预告，比"疼"更急）。
     *
     * ⚠️ `cast.hintTags` 里装的是**完整 i18n key**，直接交给翻译层即可 ——
     * **不要**再拼 `settings.hintTags.` 前缀。手写的那几个恰好长得像
     * `settings.hintTags.highDamage`，但推导出来的控制类提示是
     * **debuff 自己的 `nameKey`**（如 `lust.stun.name` = 「眩晕」）。
     * 拼前缀会得到 `settings.hintTags.lust.stun.name`，**屏幕上就是那串
     * 英文路径本身**（实测截图抓到过，见 `app/skillHints.ts`）。
     */
    const tagLabel = (cast.hintTags ?? []).map((key) => translate(key)).join(' · ');
    this.castBar.setContent(
      translate(cast.nameKey),
      `${(cast.remainingMs / 1000).toFixed(1)}s`,
      tagLabel,
    );
    /**
     * 文字颜色表达**能不能打断**：可打断 → 青绿；霸体 → 青蓝。
     *
     * ⚠️ 边框**不再随进度变色** —— 曾经在进度过 70% 时把边框转成亮金。
     * 去掉了：剩余秒数已经写在条上（信息重复），而硬编码 70% 对 1.0 秒
     * 的「轻蔑」和 2.0 秒的「碾压」意味着不同的剩余时间，
     * 玩家学不到稳定规则。
     * 现在边框恒为红色（构造时定下），只界定"这是一条威胁读条"。
     */
    this.castBar.setNameColor(cast.interruptible ? PALETTE.interrupt.bright : 0x30c8d0);
    this.castBar.update(cast.progress);
  }
}
