/**
 * 读条 / 设置页上那些**玩法提示**从哪来 —— **全部推导，没有手写数据**。
 *
 * ==================================================================
 * 为什么是"推导"而不是"每个技能手写一遍"
 * ==================================================================
 *
 * 原先每个技能自己写 `hintTags: [...]`，而那份数据**与效果是冗余的** ——
 * 于是它会往**两个方向**漂（都是真实发生过的）：
 *
 * | 漂法 | 实例 |
 * |---|---|
 * | **漏标** | 傲慢的「碾压」会倒地、却没标「倒地」；色欲的「魅惑」会眩晕、却没标「眩晕」 |
 * | **错标** | 「魅惑」**完全没有伤害效果**，却标着「高伤」 |
 *
 * 玩家原话："傲慢现在哪个招式会导致倒地，请加 tag，**玩家看不到**。"
 * 以及 "检查一下 色欲的魅惑，好像没有眩晕标签，**一样的问题**。"
 *
 * 而**真相本来就在技能自己的声明里**：效果的 `buff` 字段直接指向
 * `BuffDef` 对象（内容写的是 `buff: KNOCKDOWN`，不是 `buffId`），
 * 所以推导**不需要任何查表** —— 任何拿到 `SkillDef` 的地方都能推。
 *
 * ==================================================================
 * ⚠️ 什么时候算：**读的时候算，不存**
 * ==================================================================
 *
 * 曾经考虑过"在内容表组装时算一遍、写回 `hintTags`"。那会**再造出两份
 * 真相**：`content.ts` 里 `RAW.map(withDerivedHints)` 产生的对象与
 * `bossPride.ts` 导出的那个**不是同一个**，于是"某个调用点拿到的是哪一份"
 * 变成新的坑。
 *
 * 所以这里保持**纯函数**：只读技能自己的声明，不缓存、不写回。
 * 成本是"扫一个技能的那几个 effect"（1–2 个 hit × 1–4 个 effect），
 * 常数级、可忽略；真到了要优化的那天再加 `WeakMap`，那时它是纯粹的优化。
 */
import { HP_MAX } from '../data/content';
import type { BuffDef, SkillDef, TargetRule } from '../core/types';

/** 提示 key 的前缀（这些 key 在 i18n 里是一组，「高伤」「打断」「霸体」）。 */
const HINT_KEY_PREFIX = 'settings.hintTags.';

/**
 * **多少伤害算「高伤」** —— 占玩家血上限的比例。
 *
 * ==================================================================
 * 为什么是一个阈值，而不是每个技能标一次
 * ==================================================================
 *
 * 原先它是手写的，于是**四个技能全标了「高伤」**（轻蔑 20 / 缠绕 30 /
 * 呵斥 40 / 碾压 60）—— 一个所有人都有的标签，等于没有标签。
 *
 * 更糟的是它**和设计自相矛盾**：「轻蔑」的设计原话是
 * "**硬吃**（花 30 炁去闪不划算）"，却标着「高伤」（劝你闪）。
 *
 * 阈值化之后这两件事一起解决：只有一个统一的判据，
 * 而且"多少算高"这个判断**只写在这里一处**。
 *
 * ⚠️ 用**比例**而不是绝对值（`HP_MAX * 0.3 = 30`）：血上限以后变了，
 * 判据自动跟着走，不需要有人记得回来改这个数。
 */
const HIGH_DAMAGE_RATIO = 0.3;

/**
 * 某个 buff 会不会**锁住挨打者的行动** —— 会的话，它的名字就该出现在读条上。
 *
 * ⚠️ 按 `flags` 判，不按 buff id 硬编码：
 *   - `actionLock`     = 完全不能动（「魅惑」的眩晕）
 *   - `restrictToTags` = 只能按白名单里的技能（「碾压」的倒地 = 只能翻滚）
 *
 * 于是**以后任何新的控制类 debuff 自动获得提示**，没人需要记得同步。
 */
function locksActions(def: BuffDef | undefined): boolean {
  const flags = def?.flags;
  if (flags === undefined) return false;
  return flags.actionLock === true || (flags.restrictToTags?.length ?? 0) > 0;
}

/**
 * 这个效果是不是**作用在挨打者身上**（默认就是；写了 `target: self` 才是自己）。
 *
 * 只有作用在挨打者身上的控制效果才该提示"你会被控" —— Boss 给自己挂的
 * 东西（霸体、前摇标记）不属于"后果预告"。
 */
function hitsVictim(effect: { readonly target?: { readonly mode?: string } }): boolean {
  return effect.target?.mode !== 'self';
}

/**
 * 从技能**自己的声明**推出提示（i18n key 列表，去重后）。
 *
 * 规则（全部来自机械真相，没有一条需要人手写）：
 *
 * | 看到什么 | 提示什么 |
 * |---|---|
 * | `interrupt` 效果 | 「打断」 |
 * | 给挨打者挂 `actionLock` / `restrictToTags` 的 buff（含 `stun` 效果） | **那个 buff 自己的名字** |
 * | 给自己挂 `interruptImmune` 的 buff | 「霸体」 |
 *
 * ⚠️ 控制类提示取的是**buff 自己的 `nameKey`**，不是另一个 union 值 ——
 * 这正是"零同步"的来源：`KNOCKDOWN` 叫「倒地」，读条上就显示「倒地」；
 * 改名也只需要改 i18n 那一处。
 */
export function derivedHintKeys(skill: SkillDef | undefined): readonly string[] {
  const out = new Set<string>();
  if (skill === undefined) return [];

  /**
   * ⚠️ **两条路径都要扫**：`hits[].effects`（命中时发生的事）与
   * `abilities`（施法时发生的事，如 `castStart` 给自己挂霸体）。
   *
   * 踩过的坑：最初只扫 `hits`，于是「碾压」少推了一条「霸体」——
   * 而它的霸体正是走 `abilities: [{ kind: 'grant', on: 'castStart',
   * buff: BOSS_HEAVY_ARMOR }]`，**根本不在 hits 里**。
   */
  const buffEffects: readonly (
    | { readonly kind: string; readonly buff?: BuffDef; readonly target?: TargetRule }
  )[] = [
    ...(skill.hits ?? []).flatMap((hit) => [...(hit.effects ?? [])]),
    ...(skill.abilities ?? []).filter((a) => a.kind === 'grant'),
  ];

  /**
   * 「高伤」：**单次**伤害超过血上限的那个比例。
   *
   * ⚠️ 取**单次最高**而不是总和：多段技的总伤可能很高，但每一段都不痛 ——
   * 而这条提示说的是"**这一下**值不值得用闪避全额免掉"。
   */
  const threshold = HP_MAX * HIGH_DAMAGE_RATIO;
  const biggestHit = (skill.hits ?? [])
    .flatMap((hit) => [...(hit.effects ?? [])])
    .reduce((max, e) => {
      if (e.kind !== 'damage') return max;
      const base = e.damage?.base;
      /**
       * ⚠️ `base` 允许是 `Expr`（随属性缩放的伤害）。那种伤害**静态算不出来**，
       * 所以这里**不去猜** —— 猜错会让玩家在该闪的时候硬吃。
       * 保守处理 = 不标「高伤」：**宁可少标，不可错标**。
       *
       * 目前内容里全是字面量（`S(20)` 这种），所以这条分支暂时走不到；
       * 真有人写了 `Expr` 伤害，它会安静地少一个提示，而不是给错提示。
       */
      return typeof base === 'number' ? Math.max(max, base) : max;
    }, 0);
  if (biggestHit >= threshold) out.add(`${HINT_KEY_PREFIX}highDamage`);

  for (const effect of buffEffects) {
    if (effect.kind === 'interrupt') {
      out.add(`${HINT_KEY_PREFIX}interrupt`);
      continue;
    }

    const def = effect.buff;
    if (def === undefined) continue;

    if (!hitsVictim(effect)) {
      /**
       * 作用于**施法者自己**：只有「霸体」对玩家有意义 ——
       * 它在预告"你打不断我，别浪费打断技"。
       */
      if (def.flags?.interruptImmune === true) {
        out.add(`${HINT_KEY_PREFIX}interruptImmune`);
      }
      continue;
    }

    /** 作用于**挨打者**：会被控住就报出那个 debuff 的名字。 */
    if (locksActions(def)) out.add(def.nameKey);
  }

  return [...out];
}

/**
 * 一个技能要在读条 / 设置页上显示的全部提示（i18n key，去重）。
 *
 * ⚠️ **它就是推导本身** —— 手写的 `hintTags` 字段连同 `HintTag` 类型
 * 已经**整个删掉**了：五个提示全部有机械真相，"两份数据要同步"这件事
 * 从根上消失了。详见 `derivedHintKeys`。
 */
export const hintKeysOf = derivedHintKeys;
