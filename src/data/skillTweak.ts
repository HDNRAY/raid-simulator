/**
 * **`QijiSkillTweak` 的解释点** —— 把炁机对某个技能的改动落到技能定义上。
 *
 * ==================================================================
 * 这个文件是什么（一句话，没有"和"）
 * ==================================================================
 *
 * 它是"**内容说的改动 → 引擎要的技能 / buff 表**"这一步：拿
 * `buildPlayerKit` 收集好的 `QijiSkillTweak[]`，算出**新的**技能与 buff
 * 表（入参不动）。装配那一刻调它的是 `app/battleSetup.ts`。
 *
 * ==================================================================
 * 为什么单独一个文件（AGENTS.md §3 的"关注分离"，不是行数到了）
 * ==================================================================
 *
 * `kit.ts` 是"**造装配**"（角色 + 这一局选的炁机 → 战斗输入），本文件是
 * "**改定义**"（改动 → 覆盖后的技能 / buff 表）—— 两件事的输入输出都不同：
 *
 *   `buildPlayerKit(playerId, chosen) → PlayerKit`（纯数据，不读技能定义）
 *   `applySkillTweaks(tables, tweaks) → 新的两张表`（要读 `SkillDef` / `BuffDef`）
 *
 * 混在一起的话，`kit.ts` 会变成"炁机到战斗输入的一切" —— 那正是
 * 本仓库说的"那句话里出现'和'就该拆"。拆开之后两边都能一句话说清。
 *
 * ⚠️ **没新开一套机制**：`QijiSkillTweak` 的形状定义在
 * `core/types/qiji.ts`（与 `QijiComboWindow` 并排），本文件只是它的消费者 ——
 * 与 `kits/combo.ts` 之于 `comboWindow` 是同一种分工。
 */

import { LOGIC_TICK_MS } from '../core/loopConstants';
import type { QijiSkillTweak } from '../core/types/qiji';
import type { Effect, SkillDef, BuffDef } from '../core/types';

/* ================================================================== *
 * 把内容层的改动落到技能定义上（`skillTweaks` 的**唯一**解释点）
 * ================================================================== */

/**
 * 解释一条 `QijiSkillTweak` 需要的那一小撮东西。
 *
 * ⚠️ 单独一个形状（而不是直接吃 `ContentRegistry`）：本函数住在 `data/`，
 * 而注册表是 `core/content` 的东西 —— 只收"要读的那两张表"可以让它
 * 在单测里用**手写的最小技能表**跑（见 `tests/unit/qijiWiring.test.ts`
 * 对 `skillTweaks` 的纯函数断言）。
 */
export interface SkillTables {
  readonly skills: ReadonlyMap<string, SkillDef>;
  readonly buffs: ReadonlyMap<string, BuffDef>;
}

/**
 * ⚠️ **表达不了 / 写错了就抛错，绝不静默。**
 *
 * 与 AGENTS.md §2 的判据同一条线：一条"看起来会生效、实际什么都不做"的
 * 炁机比一句 TODO 危险得多。具体会抛的三种：
 *
 *   1. `skillId` 不在技能表里（这个角色根本没有那个技能）
 *   2. `costDeltas` 指向一个技能**没有的**资源（例如给「避」写缠耗减免
 *      —— 「避」花的是炁，这条什么都不改）
 *   3. `buffOverrides` 指向的技能 / 修正找不到（buff 不是它挂的、
 *      或 `stat` 在那条 buff 里没有）
 */
function fail(tweak: QijiSkillTweak, what: string): never {
  throw new Error(`qiji skillTweak: ${what} (skill=${tweak.skillId})`);
}

/** 与 `fail` 同一条判据，但错在 buff 侧（那时"哪条炁机"比"哪个技能"更有用）。 */
function failBuff(buffId: string, what: string): never {
  throw new Error(`qiji skillTweak: buff ${buffId} ${what}`);
}
/**
 * 应用全部炁机改动，返回一张**新的**技能表（入参不动）。
 *
 * ⚠️ **合并规则**（三条，都可单测）：
 *   1. 同一个技能的多个 `costDeltas` **按资源相加**，然后与基础代价相加，
 *      结果 ≤ 0 的代价项被丢掉（"减到 0 = 免费"，不是"倒贴"）
 *   2. 一个技能有多个 `buffOverrides` 针对同一个 `stat` = 内容写重了
 *      → 抛错（"哪一条生效"没有答案）
 *   3. 没有任何 tweak 的技能**原样返回同一个对象**（引用不变）——
 *      于是"没有炁机"时这张表逐字等于注册表那一张
 */
export function applySkillTweaks(
  tables: SkillTables,
  tweaks: readonly QijiSkillTweak[],
): {
  readonly skills: ReadonlyMap<string, SkillDef>;
  /**
   * 被改过的 buff（`id` → **新的** `BuffDef`）。
   *
   * ⚠️ 单独回一张表而不是直接换掉技能表里的引用，是因为 buff 与技能是
   * **两张表**：引擎从 `CreateBattleOptions.buffs` 解析 buff
   * （`buffApplied` 后 snapshot 里的 `buffs[]` 读的是它），
   * 技能里的 `grant.buff` 只是"要挂哪个 id"的来源。只换技能表的话，
   * 窗口挂上去的仍然是旧的 60% —— 那是**静默算错**。
   */
  readonly buffs: ReadonlyMap<string, BuffDef>;
} {
  if (tweaks.length === 0) return { skills: tables.skills, buffs: tables.buffs };

  /** 逐技能累积代价增量（按资源）。 */
  const costDeltas = new Map<string, Map<string, number>>();
  /** 逐技能收集"成功后给资源"。 */
  const onUse = new Map<string, QijiSkillTweak['onUse']>();
  /** 逐 buff 收集覆盖值（按 stat）。 */
  const buffValues = new Map<string, Map<string, number>>();
  /** 逐技能收集"读条倍率 / 伤害倍率"（「砍」，2026-10-14）。 */
  const scales = new Map<string, { castTimeScale?: number; damageScale?: number }>();

  for (const tweak of tweaks) {
    if (!tables.skills.has(tweak.skillId)) fail(tweak, 'skill not found in this role\'s skill table');

    for (const change of tweak.costDeltas ?? []) {
      const perSkill = costDeltas.get(tweak.skillId) ?? new Map<string, number>();
      perSkill.set(change.resource, (perSkill.get(change.resource) ?? 0) + change.delta);
      costDeltas.set(tweak.skillId, perSkill);
    }

    if (tweak.onUse !== undefined) {
      if (onUse.has(tweak.skillId)) fail(tweak, 'two onUse entries for the same skill');
      onUse.set(tweak.skillId, tweak.onUse);
    }

    if (tweak.castTimeScale !== undefined || tweak.damageScale !== undefined) {
      /**
       * ⚠️ **同一个技能写了两条倍率 = 抛错**（与 `onUse` 同一条判据）：
       * "哪一条生效"没有答案，而"相乘"也不是显然的语义 ⇒ 不让它变成一个
       * 事后才发现的漂移。
       */
      if (scales.has(tweak.skillId)) fail(tweak, 'two scale entries for the same skill');
      scales.set(tweak.skillId, {
        ...(tweak.castTimeScale === undefined ? {} : { castTimeScale: tweak.castTimeScale }),
        ...(tweak.damageScale === undefined ? {} : { damageScale: tweak.damageScale }),
      });
    }

    for (const override of tweak.buffOverrides ?? []) {
      const perBuff = buffValues.get(override.buffId) ?? new Map<string, number>();
      for (const modifier of override.modifiers) {
        if (perBuff.has(modifier.stat)) fail(tweak, `buff ${override.buffId} overrides ${modifier.stat} twice`);
        perBuff.set(modifier.stat, modifier.value);
      }
      buffValues.set(override.buffId, perBuff);
    }
  }

  /** 新的 buff 表：只替换被点名的那些，其余**保持同一个引用**。 */
  const buffs = new Map(tables.buffs);
  for (const [buffId, values] of buffValues) {
    const base = tables.buffs.get(buffId);
    if (base === undefined) failBuff(buffId, 'not in the buff table');
    buffs.set(buffId, overrideBuffModifiers(buffId, base, values));
  }

  const skills = new Map<string, SkillDef>();
  for (const [skillId, skill] of tables.skills) {
    const deltas = costDeltas.get(skillId);
    const effect = onUse.get(skillId);
    skills.set(skillId, applyToSkill(skill, deltas, effect, buffs, scales.get(skillId)));
  }

  return { skills, buffs };
}

/**
 * 把覆盖值写进 buff 的修正里（**只改 `value`**）。
 *
 * 找不到 `stat` 对应的修正就抛错 —— 那说明内容写了一条不会生效的覆盖。
 */
function overrideBuffModifiers(
  buffId: string,
  base: BuffDef,
  values: ReadonlyMap<string, number>,
): BuffDef {
  const baseModifiers = base.modifiers ?? [];
  const modifiers = baseModifiers.map((modifier) => {
    const value = values.get(modifier.stat);
    return value === undefined ? modifier : { ...modifier, value };
  });

  for (const stat of values.keys()) {
    if (!baseModifiers.some((m) => m.stat === stat)) {
      failBuff(buffId, `has no ${stat} modifier, so the override would do nothing`);
    }
  }

  return { ...base, modifiers };
}

/**
 * 把一个技能的代价增量 / onUse / 被覆盖的 buff 落上去。
 *
 * ⚠️ **没有改动时原样返回**（同一个引用）—— "没有炁机 = 逐字等于今天"
 * 靠的就是这一行。
 *
 * ⚠️ **必须同时换掉 `grant.buff` 的引用**：引擎挂 buff 读的是
 * `ability.buff`（`castPipeline` 的 `grantTo(ability.buff, …)`），
 * **不是** `CreateBattleOptions.buffs` 里那一份。只换 `buffs` 表的话，
 * 技能挂上去的仍然是旧的 60% —— 而属性管线读的是挂上去的那个对象，
 * 于是"增伤变成 100%"**静默不生效**（踩过：只改表不改引用时，
 * 实测增伤仍是 60）。
 */
function applyToSkill(
  skill: SkillDef,
  deltas: ReadonlyMap<string, number> | undefined,
  effect: QijiSkillTweak['onUse'],
  buffs: ReadonlyMap<string, BuffDef>,
  /** 「砍」那两个倍率（缺省 = 不动）。 */
  scale: { castTimeScale?: number; damageScale?: number } | undefined,
): SkillDef {
  /** 这条技能里哪些 grant 的 buff 被覆盖过（按 id 找新对象）。 */
  const abilities = skill.abilities.map((ability) => {
    if (ability.kind !== 'grant') return ability;
    const replaced = buffs.get(ability.buff.id);
    if (replaced === undefined || replaced === ability.buff) return ability;
    return { ...ability, buff: replaced };
  });

  if (
    deltas === undefined &&
    effect === undefined &&
    scale === undefined &&
    abilities.every((a, i) => a === skill.abilities[i])
  ) {
    return skill;
  }

  let cost = skill.cost;
  if (deltas !== undefined) {
    const merged = new Map<string, number>();
    for (const entry of skill.cost) {
      const delta = deltas.get(entry.resource) ?? 0;
      /**
       * ⚠️ **只认数字代价**：表达式代价（`Cost.value: Expr`）在编译期
       * 拿不到值，写一条负数增量会静默无效 —— 所以直接抛错。
       * 今天「凝」「避」的代价都是数字（`S(40)` / `S(15)`），所以走不到这里；
       * 将来内容里出现表达式代价时，这一行会把"减耗炁机对它无效"变成
       * 一个**开发期立刻看得见的崩溃**。
       */
      if (delta !== 0 && typeof entry.value !== 'number') {
        throw new Error(
          `qiji skillTweak: ${skill.id} cost ${entry.resource} is an Expr, cannot adjust it`,
        );
      }
      const value = (typeof entry.value === 'number' ? entry.value : 0) + delta;
      /** ≤ 0 的项直接丢掉（"减到 0 = 免费"，不做负数代价）。 */
      if (value > 0) merged.set(entry.resource, value);
    }

    for (const resource of deltas.keys()) {
      if (!skill.cost.some((entry) => entry.resource === resource)) {
        throw new Error(
          `qiji skillTweak: ${skill.id} has no ${resource} cost, so the reduction would do nothing`,
        );
      }
    }

    cost = skill.cost
      .map((entry) => ({ resource: entry.resource, value: merged.get(entry.resource) }))
      .filter((entry): entry is { resource: string; value: number } => entry.value !== undefined);
  }

  /**
   * 读条倍率：`castTime × castTimeScale`，**四舍五入到逻辑步**
   * （`logicMs` 的粒度）—— 不到网格上的值会被 `assertValidContent` 拦下，
   * 所以这里**主动对齐**，而不是留一个"内容挑错了就崩"的坑。
   */
  const castTime =
    scale?.castTimeScale === undefined
      ? skill.castTime
      : roundToLogicStep(skill.castTime * scale.castTimeScale);

  /**
   * 伤害倍率：乘在**所有 `hits` 里的伤害效果**上。
   * 非伤害效果（buff / 搬运资源）一律不动 —— 那些不是"伤害"。
   */
  const hits =
    scale?.damageScale === undefined
      ? skill.hits
      : skill.hits.map((hit) => ({
          ...hit,
          effects: hit.effects.map((fx) => scaleDamageEffect(fx, scale.damageScale ?? 1)),
        }));

  return {
    ...skill,
    castTime,
    hits,
    cost,
    abilities: effect === undefined ? abilities : [...abilities, effect],
  };
}

/**
 * 把一个效果里的**伤害**乘上倍率；不是伤害效果就原样返回（同一个引用）。
 *
 * ⚠️ 单独一个具名函数（而不是内联的嵌套三元）：`Effect` 是联合类型，
 * 内联写在 `map` 里会让 TS 推不出那个成员（`damage` 可选）—— 而这里
 * 用 `kind !== 'damage'` 收窄之后，返回的仍然是**同一个成员**。
 */
function scaleDamageEffect(fx: Effect, factor: number): Effect {
  if (fx.kind !== 'damage' || fx.damage === undefined) return fx;
  /**
   * ⚠️ **只认数字伤害**（与 `costDeltas` 只认数字代价是同一条纪律）：
   * 表达式伤害在编译期拿不到值，乘不了 ⇒ 直接抛错，而不是静默不生效。
   */
  if (typeof fx.damage.base !== 'number') {
    throw new Error('qiji skillTweak: damage base is an Expr, cannot scale it');
  }
  return { ...fx, damage: { ...fx.damage, base: fx.damage.base * factor } };
}

/** 把毫秒对齐到逻辑步网格（`LOGIC_TICK_MS`）—— `assertValidContent` 的要求。 */
function roundToLogicStep(ms: number): number {
  return Math.round(ms / LOGIC_TICK_MS) * LOGIC_TICK_MS;
}
