/**
 * **作战单位的构造**（玩家与各 Boss）。
 *
 * ==================================================================
 * 为什么单独一个文件
 * ==================================================================
 *
 * 这些是**内容装配**：血量上限、基础属性、技能表、Boss 的行为表。
 * 放在 `main.ts` 里会把"入口装配"和"内容数值"混在一起，而且 `main.ts`
 * 长期贴着 700 行上限（AGENTS.md §3）—— 加一个 Boss 就要挤一次。
 *
 * ⚠️ 行为表是**每个 Boss 自己的**，而技能注册表是**共用的**：
 * 两个 Boss 的技能都在 `ALL_SKILLS` 里是正常的，各自只放自己轮转里
 * 列出的那些。
 *
 * ==================================================================
 * 2026-10-12：玩家**按角色**装配（技能与血上限）
 * ==================================================================
 *
 * 原先所有角色用的是同一个 `PLAYER_CAPS` 与同一套通用技能。现在两样都
 * 按备战界面选中的角色走：
 *
 *   `makePlayer(id)`         → 血上限取那个角色的 kit（林晚风 150 / 凯丽 120）
 *   `skillsForPlayer(id)`    → 那一套 5 个技能（见 `data/content.ts` 的转发）
 *
 * 定稿与"血上限为什么这样做"见 `docs/specs/2026-10-12-player-kits.md`。
 * ⚠️ 这个文件**不决定**"这一局装哪一套"之外的事 —— 那是 app 层的选择。
 */

import type { Behavior, Combatant, SkillDef, StatKey, BuffDef } from '../core/types';
import { applyBuff } from '../core/buffs';
import { DOUQI_MAX, ENERGY_MAX, HP_MAX, skillsForPlayer } from './content';
import { KAILI_HP } from './kits/kaili';
import { LIN_WANFENG_HP } from './kits/linwanfeng';
import { LUST_BEHAVIORS } from './lustBoss';
import { JEALOUSY_BEHAVIORS } from './jealousyBoss';
import { GREED_BEHAVIORS } from './greedBoss';
import { LAZY_BEHAVIORS } from './lazyBoss';
import { GLUTTONY_BEHAVIORS } from './gluttonyBoss';
import { WRATH_BEHAVIORS } from './wrathBoss';
import { PRIDE_BEHAVIORS } from './bossPride';
import { bossDefById, bossHpFor, bossStartHpFor } from './bossDefs';
import { BOSS_ROSTER, PLAYER_ROSTER, findEntry } from './roster';

/**
 * 玩家基础属性。
 *
 * 新刻度下**不需要**主属性参与伤害计算了 —— 所有技能的伤害都是
 * 内容里写死的固定值（斩 10 / 轰 30 / 劈 45）。所以这里只留最小的基础值，
 * 属性系统本身仍然可用（装备/增益可以往里加）。
 *
 * 缠回复**不走属性**：它是固定"每 0.1 秒 1 点"，
 * 由 `data/balance.ts` 的 `ENERGY_PER_LOGIC_TICK` 决定。
 *
 * ⚠️ 血上限**不在这里** —— 它是每个角色自己的（见 `PLAYER_HP_BY_ID`）。
 */
export const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

/**
 * **每个角色的生命上限**（角色文档 §1）。
 *
 * ==================================================================
 * 它为什么是一张表，而不是 `PLAYER_CAPS` 里的一个数（W6）
 * ==================================================================
 *
 * 需求是"每个人的血量不同"（林晚风 150 / 凯丽 120 / 黛玄 100）。
 * 原先 `HP_MAX = 100` 是**全局常量**，谁都改不了 ——
 * 这就是 `docs/specs/2026-10-12-characters.md` §0.1 记的 W6。
 *
 * 落地方式刻意选**最窄的那一种**：只把"上限值"参数化，
 * 不动资源结算的机制。也就是说：
 *   - `combatant.caps.hp` 仍然是引擎夹血用的那个值（`changeResource` 读它）
 *   - 它现在由**这个角色的 kit** 决定，而不是一个全局常量
 *
 * ⚠️ `maxHp` 这个 `StatKey` 现在仍然**算出来没人读**（见
 * `core/combat/index.ts` 的 `changeResource`）—— 本次**没有**把它接线，
 * 那是"装备/炁机动态改血上限"才需要的机制，属于以后。这里只是把
 * 静态上限变成"按角色取值"，所以战斗的确定性语义**没有变化**
 * （同一角色、同样的输入 → 同样的结果）。
 */
const PLAYER_HP_BY_ID: Readonly<Record<string, number>> = {
  player: LIN_WANFENG_HP,
  kaili: KAILI_HP,
};

/**
 * 某个角色的血上限（展示刻度）。
 *
 * ⚠️ 未登记的角色回落到 `HP_MAX`（100）—— 那是"默认人类"的兜底，
 * 让还没做完的角色（黛玄）也能上场而不至于 0 血。
 */
export function playerHpFor(id: string): number {
  return PLAYER_HP_BY_ID[id] ?? HP_MAX;
}

/**
 * **资源上限**（默认角色那一份）。
 *
 * ⚠️ 保留它是为了那些"只要一个 100 制上限"的调用点（测试、调试面板），
 * 而**玩家的真实上限**一律走 `playerCapsFor(id)` —— 直接读这个常量
 * 会让凯丽也拿到 150 血（症状是"她的血条比她该有的长"，很难注意到）。
 */
export const PLAYER_CAPS = { hp: HP_MAX, energy: ENERGY_MAX, douqi: DOUQI_MAX };

/** 某个角色的资源上限。炁/缠上限目前与角色无关。 */
export function playerCapsFor(id: string): {
  readonly hp: number;
  readonly energy: number;
  readonly douqi: number;
} {
  return { hp: playerHpFor(id), energy: ENERGY_MAX, douqi: DOUQI_MAX };
}


/**
 * 造一个玩家单位。
 *
 * @param id 备战界面选中的角色 id（`PLAYER_ROSTER` 里那个）。
 *
 * ⚠️ 技能**不在 `Combatant` 上**（它是 `BattleEngineOptions.skills` 的
 * 内容），所以这里只出"这个人是谁、多少血、什么属性"。技能由
 * `app/battleSetup.ts` 用 `skillsForPlayer(id)` 交给引擎 ——
 * 一个装载点，不是两处。
 *
 * ==================================================================
 * 2026-10-13：**炁机改上限的那一半走 `options.kit`**
 * ==================================================================
 *
 * 肉鸽里"选了「加血上限」"必须真的加在下一场战斗上，而 `caps` 是**这里**
 * 写的（引擎的钳制读 `combatant.caps.hp`，见 `changeResource`）。所以
 * `options.kit` 让调用方把 `data/kit.ts` 算好的 `caps` / `base` 传进来 ——
 * 而不是让本文件去 import `data/kit`（那会造出 `units ↔ kit` 的环：
 * `kit` 本来就要读 `playerCapsFor`）。
 *
 * ⚠️ **不传 `kit` 时逐字等于今天**（`playerCapsFor(id)` + `PLAYER_BASE`）：
 * 单场 / 自由模式 / 黄金重放走的都是这一支。
 */
export function makePlayer(
  id: string,
  options?: {
    readonly kit?: {
      readonly caps: { readonly hp: number; readonly energy: number; readonly douqi: number };
      /**
       * **炁机带来的常驻 buff**（「黑闪」的节拍那条）。
       *
       * ⚠️ 与 `innateBuffsFor`（Boss 的固有 buff）是**同一时刻、同一种东西**
       * —— 都在战斗开始**之前**存在，所以 `appliedAtTick` 从 0 起算。
       */
      readonly passiveBuffs?: readonly BuffDef[];
    };
  },
): Combatant {
  const caps = options?.kit?.caps ?? playerCapsFor(id);
  /**
   * ⚠️ 先建一个"只有 buffs 字段"的空壳再 `applyBuff`：`applyBuff` 只读
   * `buffs` 决定"复用还是新建实例"，而这里要建的对象**还没建好**
   * （与 `innateBuffsFor` 用 `EMPTY_FOR_INNATE` 是同一个理由）。
   */
  const innateBuffs = (options?.kit?.passiveBuffs ?? []).reduce<Combatant['buffs']>(
    (acc, def) => applyBuff({ ...EMPTY_FOR_INNATE, id, side: 'ally', buffs: acc }, def, id, 0).buffs,
    [],
  );

  return {
    id,
    /** 显示名来自 roster（需求："这个人物目前就叫 林晚风"）。 */
    nameKey: findEntry(PLAYER_ROSTER, id)?.nameKey ?? 'hud.you',
    side: 'ally',
    caps,
    resources: { hp: caps.hp, energy: caps.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: innateBuffs,
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

/**
 * 这个角色带的技能表（**装配用的转发**）。
 *
 * ⚠️ 实现住在 `data/content.ts`（它才是"玩家技能全集"的家）。这里转发
 * 而不是让 app 层直接读 content，是因为"一个单位的技能"属于**装配**，
 * 与"血量上限"是同一件事的两半 —— 拆开放会让人只找到一半。
 */
export function playerSkillsFor(id: string): readonly SkillDef[] {
  return skillsForPlayer(id);
}

/**
 * 按 Boss id 取它的行为（轮转 / 狂暴 / 时限）。
 *
 * ⚠️ 行为表是**每个 Boss 自己的**，而技能注册表是**共用的** ——
 * 所以"两个 Boss 的技能都在 `ALL_SKILLS` 里"是正常的：各自只会放
 * 自己轮转里列出的那些。
 *
 * ==================================================================
 * ⚠️ 新增的 5 个 Boss **还没有自己的行为表**（本次范围只到"能上场看到"）
 * ==================================================================
 *
 * 它们暂时借用「傲慢」的轮转 —— 不是"临时数值"，而是**占位**：
 * 备战界面里它们被灰掉（`roster.isDeveloping`），正常情况下**进不了战斗**；
 * 借这一手是为了"万一从别的路径（存档 / 调试参数）进来了也不要崩"。
 *
 * 做完某个 Boss 时，在这里补一条它自己的行为表，并把 id 从
 * `data/roster.ts` 的 `DEVELOPING` 里删掉。
 */
const BOSS_BEHAVIORS: ReadonlyMap<string, readonly Behavior[]> = new Map([
  ['lust', LUST_BEHAVIORS],
  ['envy', JEALOUSY_BEHAVIORS],
  ['greed', GREED_BEHAVIORS],
  ['sloth', LAZY_BEHAVIORS],
  ['gluttony', GLUTTONY_BEHAVIORS],
  ['wrath', WRATH_BEHAVIORS],
]);

export function behaviorsFor(id: string): readonly Behavior[] {
  return BOSS_BEHAVIORS.get(id) ?? PRIDE_BEHAVIORS;
}

/**
 * **按这一场的选项裁过的**行为表（`makeBoss` 用它）。
 *
 * 两处裁剪，都与"谁决定"有关：
 *   - `noAi`：截图 / 调试用，清空全部行为（理由见 `makeBoss` 的注释）
 *   - `enrage === false`：**只**裁掉 `kind: 'enrage'` —— 那是「恶魔低语」
 *     的「狂暴」，一局里抽到才有（第 1 层一定没有）
 */
function behaviorsForBattle(
  id: string,
  options?: { readonly noAi?: boolean; readonly enrage?: boolean },
): readonly Behavior[] {
  if (options?.noAi === true) return [];
  const all = behaviorsFor(id);
  return options?.enrage === false ? all.filter((b) => b.kind !== 'enrage') : all;
}

/**
 * @param options.noAi 清空全部行为 —— **截图/调试用**。
 *
 *   ⚠️ 为什么需要它：Boss 的轮转会不停打玩家，几秒内就死，于是"等某个
 *   特定机制发生"变得几乎不可能（实测想验眩晕，玩家 15 秒内就死了、
 *   「魅惑」还没轮到）。关掉 AI 后场景是**静止**的，可以稳稳造状态再截图。
 *
 *   ⚠️ 这里**曾经**过滤出 `kind: 'timeLimit'`（"只留时限"）—— 那个行为
 *   变体已删（它是死值，时限的真相在 `BattleEngineOptions.timeLimitMs`，
 *   见 `core/types/behavior.ts`）。所以现在就是**空数组**：时限不受影响。
 *
 *   ⚠️ 用**参数**而不是在函数里读 `location.search`：本文件会被 Node 侧
 *   的单测 import，而那里没有 `location` —— 读它会让测试**直接崩**。
 */
export function makeBoss(
  id: string,
  options?: {
    readonly noAi?: boolean;
    /**
     * **这一场要不要「狂暴」**（`undefined` = 保留内容里写的，2026-10-16）。
     *
     * ⚠️ 这是「恶魔低语」里那条 `kind: 'bossEnrage'` 的落点：一局肉鸽
     * **每一层抽一条**惩罚，抽到「狂暴」才有 —— 第 1 层一定没有。
     *
     * ⚠️ 不传（自由模式 / 直接单场 / 黄金夹具）⇒ 与今天**逐位一致**，
     * 所以基线不动。判据：`enrage === false` 时只裁 `kind: 'enrage'`
     * 那一条，别的一律不动。
     */
    readonly enrage?: boolean;
  },
): Combatant {
  return {
    id,
    nameKey: findEntry(BOSS_ROSTER, id)?.nameKey ?? 'boss.name',
    side: 'enemy',
    caps: { hp: bossHpFor(id), energy: 0, douqi: 0 },
    /** ⚠️ 起始血量可以与上限不同（「懒惰」= 上限 500 / 开局 250）。 */
    resources: { hp: bossStartHpFor(id), energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: behaviorsForBattle(id, options),
    alive: true,
    /**
     * ⚠️ **固有 buff**（常驻被动）在构造时就挂上。
     *
     * 「色欲」的反伤被动需要一个**始终存在**的触发器持有者 —— 见
     * `LUST_PASSIVE` 的"自举悖论"说明。放在这里（而不是战斗开始后的
     * 某个钩子里）是因为它没有"什么时候开始"的问题：整场都在。
     */
    buffs: innateBuffsFor(id),
  };
}

/**
 * 某个 Boss 开战时就带着的 buff。
 *
 * ⚠️ `tick = 0`：固有 buff 在战斗开始前就存在，所以它的 `appliedAtTick`
 * 从 0 起算。永久 buff 不看这个值，但要保持一致（否则重放会有细微差异）。
 */
function innateBuffsFor(id: string): Combatant['buffs'] {
  /**
   * ⚠️ **被动技能 → "开战就挂着的那几条 buff"**（2026-10-14 改）。
   *
   * 走的是被动技能的 `abilities`（`grant` = 挂 buff），而不是"把 `passives`
   * 当成 buff 直接用" —— 那是这次换类型的目的：被动技能是一等公民
   * （`PassiveSkillDef`），它**授予什么**写在 `abilities` 里。
   *
   * ⚠️ **只认 `grant`**：别的 kind（`modifier` / `deal` / `consume` …）在
   * 这条路上**没有执行点**，写了必须**立刻崩**，不许静默无效
   * （AGENTS.md §2 的判据："用了不报错、结果什么也没发生"是最坏的一类）。
   * `modifier`（"被动改属性"）将来要在 `battleSetup` 的 `passiveModifiers`
   * 那条路上接 —— 那时**两条路都要按 kind 分派**，见本函数末尾的说明。
   */
  let acc: Combatant['buffs'] = [];
  for (const passive of bossDefById(id).passives) {
    for (const ability of passive.abilities) {
      /**
       * ⚠️ `modifier`（"被动改属性"）**不在这里**处理 —— 它要进那一局的
       * `passiveModifiers`（`app/battleSetup.ts`），而 `makeBoss` 只造
       * `Combatant`、拿不到那份 Map。**两条路按 kind 分派**，谁也别吞谁。
       */
      if (ability.kind === 'modifier') continue;
      if (ability.kind !== 'grant') {
        throw new Error(
          `boss passive ${passive.id}: only 'grant' / 'modifier' are supported (got '${ability.kind}')`,
        );
      }
      acc = applyBuff({ ...EMPTY_FOR_INNATE, id, side: 'enemy', buffs: acc }, ability.buff, id, 0).buffs;
    }
  }
  return acc;
}

/**
 * 给 `applyBuff` 用的空壳 —— 它只读 `buffs` 字段来决定"复用还是新建实例"。
 *
 * ⚠️ 不直接用 `makeBoss` 的返回值是为了避免"边构造边读自己"的书写顺序
 * 问题：`innateBuffsFor` 在对象字面量里被调用，那时对象还没建好。
 */
const EMPTY_FOR_INNATE: Combatant = {
  id: '',
  nameKey: 'hud.you',
  side: 'enemy',
  caps: { hp: 0, energy: 0, douqi: 0 },
  resources: { hp: 0, energy: 0, douqi: 0 },
  counters: {},
  basePrimary: { strength: 0, agility: 0, intelligence: 0, spirit: 0 },
  buffs: [],
  cooldowns: {},
  casts: [],
  uses: {},
  behaviors: [],
  alive: true,
};
