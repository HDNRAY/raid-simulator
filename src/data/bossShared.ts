/**
 * **两个 Boss 共用的** buff：前摇标记、狂暴、倒地。
 *
 * ==================================================================
 * 为什么从 `bossSkills.ts` 改名过来
 * ==================================================================
 *
 * 这个文件原来叫 `bossSkills.ts`，里面同时装着**共享机制**（本文件的内容）
 * 与**「伪名一郎」的具体招式**（重斩 / 横扫 / 蓄能 / 霸体）。
 *
 * 改造「傲慢」时把后者整体搬到 `bossPride.ts`（与 `lustBoss.ts` 对称：
 * 一个 Boss 一个文件），于是这里只剩下真正共享的三样 —— 名字里的
 * "skills" 就不再准确了。
 *
 * ⚠️ 为什么这三样**必须留在这里**而不是各自复制一份：
 *   - `BOSS_TELEGRAPH` / `BOSS_ENRAGE` / `KNOCKDOWN` 两个 Boss 都用
 *   - 各自复制会让"霸体/倒地"这类概念出现两个 id，UI 与校验器都会看到
 *     两份定义
 *   - 让 `bossPride.ts` 从本文件 import（而不是从 `lustBoss.ts`）也
 *     避免了 `bossPride ↔ lustBoss` 的循环引用 —— `data/scale.ts` 顶部
 *     记过循环引用导致 `undefined` 的坑
 */

import type { BuffDef } from '../core/types';
import { logicMs } from '../core/loopConstants';
import { C } from './scale';

/**
 * Boss 前摇标记（隐藏，只用于让 UI 知道它在读条）。
 *
 * ⚠️ 这是一个**兜底时长**（3.0s）。「傲慢」的四招各自挂
 * `boss-<skill>-telegraph`（时长 = 自己的 `castTime`，见 `bossPride.ts`），
 * 因为一个固定时长不可能对 1.0 / 1.5 / 2.0 / 2.5 秒四种读条都正确
 * （设计 §6.5 第 1 条）。
 *
 * 「色欲」仍在用它 —— 它的三招读条都短于 3.0 秒，所以旧行为没暴露问题。
 */
export const BOSS_TELEGRAPH: BuffDef = {
  id: 'boss-telegraph',
  nameKey: 'hud.casting',
  icon: 'telegraph',
  polarity: 'neutral',
  color: C.boss,
  duration: logicMs(30),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  hidden: true,
};

/**
 * Boss 狂暴：伤害翻倍。
 *
 * ⚠️ `polarity` 是 **`'buff'`** —— 这是**从 Boss 自己的角度**看的。
 * "狂暴对玩家是坏消息"是玩家的感受，而极性决定的是"它出现在哪一行"
 * （`polarity: 'buff'` → 增益行）。把它标成 debuff 会让 Boss 的**增益**
 * 显示在**减益行**上 —— 位置本身就是分类，标错了就是分类错了。
 */
export const BOSS_ENRAGE: BuffDef = {
  id: 'boss-enrage',
  nameKey: 'screen.defeatedByEnrage',
  icon: 'enrage',
  polarity: 'buff',
  color: 0xff3030,
  duration: Number.POSITIVE_INFINITY,
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  modifiers: [{ stat: 'damageBoost', op: 'addPercent', value: 100, sourceKey: 'screen.defeatedByEnrage' }],
};

/**
 * 「倒地」：**2 秒内只能按带 `dodge` tag 的技能**。
 *
 * 需求："给 伪名一郎 的 横扫，增加倒地效果，会给玩家 到底debuff，
 * 2s内只能按 带有 闪避 tag的技能。"
 *
 * ⚠️ 用 `restrictToTags` 而不是 `actionLock`：
 *   - `actionLock` 是"完全不能动"（施法僵直）
 *   - 倒地要的是"**只能翻滚**" —— 那是玩家的一条出路，不该堵死
 *
 * 所以被打倒不是"挨打时什么都做不了"，而是"你只剩闪避这一手"。
 *
 * ⚠️ 「傲慢」的改造把它从**「横扫」（40）搬到了「碾压」（60）**
 * （设计 §2）：它把"挨了 60"和"挨了 40"的后果拉开一档 —— 挨完 60
 * 你 2 秒内只能闪，正好补上"没躲掉最痛的一刀"的后果。
 *
 * ⚠️ 2 秒 = `logicMs(20)`。慢刀的前摇是 2.0 秒，所以倒地结束时
 * 下一刀还没读条完 —— 时间是够反应的，但不多。
 */
export const KNOCKDOWN: BuffDef = {
  id: 'knockdown',
  nameKey: 'debuff.knockdown.name',
  icon: 'char_dodge',
  polarity: 'debuff',
  color: C.debuff,
  duration: logicMs(20),
  maxStacks: 1,
  stacking: { mode: 'refresh' },
  /**
   * 只放行「闪避」类技能。名单由 `SkillTag` 的 `dodge` 决定，
   * 所以以后新增闪避技不需要改这里。
   */
  flags: { restrictToTags: ['dodge'] },
};

/**
 * 三个 Boss **共享**的 buff（前摇标记 / 狂暴 / 倒地）。
 *
 * ⚠️ 它们**不属于任何单个 Boss 的 `*_BUFFS`** —— 那样会被注册两次
 * （`DUP_ID`）。`content.ts` 注册这一组；而每个 Boss 的**定义**
 * （`bossDefs`）把它们带进"这个 Boss 会用到的全部 buff"那一份里。
 */
export const BOSS_SHARED_BUFFS: readonly BuffDef[] = [BOSS_TELEGRAPH, BOSS_ENRAGE, KNOCKDOWN];

