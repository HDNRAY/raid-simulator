/**
 * 引擎状态 → 渲染 view-model 的适配器。
 *
 * 这是**唯一**允许同时知道引擎与渲染两侧的文件（它住在 `app/`，
 * 不属于任何一侧）。两边的耦合被限制在这一个文件里，
 * 所以换渲染库或换引擎时改动范围可控。
 *
 * 它还负责把引擎的**事件流**变成渲染需要的东西：
 *   - 飘字（伤害数字）
 *   - 屏幕闪白
 *   - 状态提示（"闪避！"/"被打断"）
 */

import type { BattleEngine } from '../core/combat/battleState';
import type { SkillDef, EventDef } from '../core/types';
import { PALETTE } from '../render/theme';
import {
  blockKeyOf,
  damageColor,
  defaultBuffColor,
  isDefensiveBuff,
  isInternalBuff,
  shortLabelKeyOf,
} from './viewHelpers';
import { LAYOUT } from '../ui/layout';
import type {
  BattleSnapshotView,
  BuffView,
  CombatantView,
  FloatingTextView,
  ResultView,
  SkillSlotView,
  SlotCost,
} from '../render/viewModel';

/** 一条槽位绑定（键位 → 技能）。 */
export interface SlotBinding {
  readonly index: number;
  readonly key: string;
  readonly skillId: string;
}

/**
 * 适配器：持有"渲染侧的瞬时状态"（飘字、闪光），
 * 这些不属于引擎状态（它们纯粹是表现）。
 */
/**
 * 飘字的位置散布范围（逻辑像素）。
 *
 * 横向比纵向大：飘字本身是往上浮的，纵向散太多会和上一个数字叠一起。
 * 需求："战斗文字 位置随机一点"。
 */
const FLOATING_SPREAD_X = 76;
const FLOATING_SPREAD_Y = 34;

export class ViewAdapter {
  private floating: FloatingTextView[] = [];
  private nextFloatingId = 1;
  private playerFlash = 0;
  private bossFlash = 0;
  private statusLine = '';
  private statusLineTtl = 0;

  /** 每个技能上次使用的 tick，用于在引擎不暴露 CD 时估算冷却显示。 */
  private readonly lastUsed = new Map<string, number>();
  private readonly skillNameKeys = new Map<string, string>();
  /** 状态提示的副标题（例如"贯击 · 公共冷却"） */
  private statusDetail = '';
  /** 累计造成的总伤害（结算面板用） */
  private damageDealt = 0;
  /** 累计承受的总伤害 */
  private damageTaken = 0;
  /**
   * 最近一次被拒的「技能 + 原因」与它的 tick。
   *
   * 用途：**不让同一件事重复刷屏**。
   *
   * 输入层已经用"与引擎共用的 GCD 判据"把绝大部分误报消掉了，
   * 但预测毕竟是在动作生效**之前**做的 —— 状态在那一瞬间变化时
   * 仍可能漏一次。这层去重保证即使漏了，玩家也不会看到
   * 同一行提示连续闪动。
   */
  private lastReject: { readonly key: string; readonly tick: number } | undefined;

  /**
   * @param skills 技能定义表（视图只读它，不回写引擎）
   * @param translate 本地化取词。**注入而不是 import i18n 单例** ——
   *   视图适配器要能在测试里用假翻译跑，也便于将来换语言/换实现。
   *   只有飘字这类"纯字符串载荷"用它；状态提示仍然传 key 给渲染层。
   */
  constructor(
    private readonly skills: ReadonlyMap<string, SkillDef>,
    private readonly translate: ((key: string) => string) | undefined = undefined,
  ) {
    for (const [id, skill] of skills) this.skillNameKeys.set(id, skill.nameKey);
  }

  /**
   * 消费引擎事件。**必须在引擎 tick 之后、渲染之前调用一次。**
   *
   * ⚠️ `playerId` 不是装饰：`skillRejected` 不区分是谁在施放，Boss 的
   * 冷却拒绝会写进玩家状态区（显示"我的技能在冷却中"，可他刚放出来）。
   */
  consume(events: readonly EventDef[], tick: number, playerId: string): void {
    for (const event of events) {
      switch (event.kind) {
        case 'damage': {
          if (event.amount <= 0) break;
          // 飘字落在**被打的人**头上。用 side 判断而不是写死 id ——
          // 换 Boss 时不需要改这里。
          const onBoss = event.targetId !== 'player';
          const baseY = onBoss ? LAYOUT.combatTextY.boss : LAYOUT.combatTextY.player;
          const baseX = onBoss ? 630 : 300;
          this.pushFloating(
            `-${event.amount}${event.crit ? '!' : ''}`,
            damageColor(event.amount, event.crit),
            baseX,
            baseY,
          );
          if (onBoss) {
            this.bossFlash = 1;
            this.damageDealt += event.amount;
          } else {
            this.playerFlash = 1;
            this.damageTaken += event.amount;
          }
          break;
        }
        case 'heal': {
          if (event.amount <= 0) break;
          this.pushFloating(`+${event.amount}`, PALETTE.buff.bright, 300, 380);
          break;
        }
        case 'avoided': {
          this.setStatus(event.reason === 'immune' ? 'hud.immune' : 'hud.dodged', 90);
          /**
           * 完全免伤时飘的是"闪躲"而不是数字 `0`。
           *
           * 需求："闪避现在飘的战斗文字是'免疫'？改成闪躲"。
           * 确实原来是 `immune`（免疫）—— 那是"伤害被豁免"的机制词，
           * 而玩家做的是"闪躲"这个动作，用动作词更自然。
           *
           * ⚠️ 这里**只改满免伤（immune）**；被其他原因避免的
           * （如目标已死）仍然走 `0`，因为它不是玩家闪出来的。
           */
          const label =
            event.reason === 'immune' ? this.text('hud.dodged') : '0';
          this.pushFloating(label, PALETTE.iframe.bright, 300, LAYOUT.combatTextY.player);
          this.playerFlash = 0.6;
          break;
        }
        case 'skillRejected': {
          /**
           * 技能被拒时把「技能名 + 原因」放进状态区。
           *
           * 为什么不写在技能格上：格子只有 44px，七个格子各挂一行小字
           * 会糊成一片。集中一行反而读得更快。同一个「技能 + 原因」
           * 在 1 秒内只提示一次（见 `lastReject`）。
           */
          /**
           * **只提示玩家自己的拒绝。**
           *
           * Boss 的招式冷却不该占用玩家的状态行 —— 那条线是
           * "我刚才那一下为什么没生效"，只对玩家的输入负责。
           * （Boss 在 CD 中尝试出手是它自己的轮转问题，见 `runAi` 的
           * 工作副本修正。）
           */
          if (event.sourceId !== playerId) break;
          const key = `${event.skillId}:${event.reason}`;
          const suppressed =
            this.lastReject !== undefined &&
            this.lastReject.key === key &&
            tick - this.lastReject.tick < 60;
          this.lastReject = { key, tick };
          if (suppressed) break;

          const skillName = this.skillNameKeys.get(event.skillId) ?? event.skillId;
          this.setStatus(`block.${blockKeyOf(event.reason)}`, 55, skillName);
          break;
        }
        case 'castInterrupted': {
          this.setStatus('hud.interrupted', 150);
          break;
        }
        case 'enrageStarted': {
          this.setStatus('event.enrage', 300);
          break;
        }
        case 'interruptImmune': {
          /**
           * 打断被霸体挡下 —— 必须给玩家明确反馈。
           *
           * 否则玩家按了「破」、什么都没发生，会以为是 bug。
           */
          this.setStatus('hint.armored', 120);
          break;
        }
        case 'behaviorTriggered': {
          /**
           * Boss 的行为阈值被跨过（例如进入二形态）。
           *
           * 引擎不知道"阶段"是什么 —— 它只知道"某条 onHpBelow 触发了"。
           * 所以这里的提示也只是"形态变化"，具体变成了什么由
           * buff 条上的图标告诉玩家。
           */
          this.setStatus('event.phaseChange', 120);
          break;
        }
        case 'skillUsed': {
          this.lastUsed.set(event.skillId, event.tick);
          break;
        }
        default:
          break;
      }
    }

    // 衰减
    this.playerFlash = Math.max(0, this.playerFlash - 0.08);
    this.bossFlash = Math.max(0, this.bossFlash - 0.12);
    if (this.statusLineTtl > 0) {
      this.statusLineTtl -= 1;
      if (this.statusLineTtl === 0) {
        this.statusLine = '';
        this.statusDetail = '';
      }
    }

    // 飘字上浮与淡出
    this.floating = this.floating
      .map((item) => ({ ...item, y: item.y - 1.1, life: item.life - 0.02 }))
      .filter((item) => item.life > 0);

    void tick;
  }

  /**
   * 加一条飘字。
   *
   * 位置带**确定性随机**（需求："战斗文字 位置随机一点"）。
   *
   * 为什么不用 `Math.random`：core 与视图都要能在 Node 里复现 ——
   * 引擎的纪律是"所有随机走 `rngSeed`"，视图沿用同一套思路，
   * 用一个自增的 id 做散列即可（视觉上足够随机，且完全可复现）。
   *
   * 原来的做法是 `(floating.length % 5) * 18`：那会让**相邻几条**
   * 严格排在 5 个固定位置上，连打时看起来像一列整齐的队列。
   */
  private pushFloating(text: string, color: number, x: number, y: number): void {
    const seed = this.nextFloatingId * 2654435761;
    /** 取散列的不同位段，得到两个独立的伪随机值 */
    const jitterX = ((seed >>> 8) % 100) / 100 - 0.5; // -0.5..0.5
    const jitterY = ((seed >>> 16) % 100) / 100 - 0.5;
    this.floating.push({
      id: this.nextFloatingId++,
      text,
      color,
      x: x + jitterX * FLOATING_SPREAD_X,
      y: y + jitterY * FLOATING_SPREAD_Y,
      life: 1,
    });
    // 上限，避免长时间战斗累积
    if (this.floating.length > 24) this.floating.splice(0, this.floating.length - 24);
  }

  /** 取一条本地化文案（视图层内部用小工具，避免各处重复 try/catch）。 */
  private text(key: string): string {
    if (!this.translate) return key;
    try {
      return this.translate(key);
    } catch {
      // 缺 key 时退回 key 本身：飘字是装饰，不该让整场战斗崩掉
      return key;
    }
  }

  private setStatus(key: string, ttl: number, detailKey?: string): void {
    this.statusLine = key;
    this.statusLineTtl = ttl;
    this.statusDetail = detailKey ?? '';
  }

  /** 构建完整的渲染快照。 */
  build(
    engine: BattleEngine,
    slots: readonly SlotBinding[],
    options: { readonly timeLimitMs?: number } = {},
  ): BattleSnapshotView {
    const state = engine.snapshot;
    const playerRaw = state.combatants.find((c) => c.side === 'ally');
    const bossRaw = state.combatants.find((c) => c.side === 'enemy');
    if (!playerRaw || !bossRaw) return emptyView(state.tick);

    const playerStats = engine.statsOf(playerRaw.id);
    const player = toCombatantView(engine, playerRaw.id, state.tick);
    const boss = toCombatantView(engine, bossRaw.id, state.tick);

    const remainingMs =
      options.timeLimitMs === undefined
        ? undefined
        : Math.max(0, options.timeLimitMs - (state.tick - state.startedAtTick) * (1000 / 60));

    const comboWindowOpen = player.buffs.some(
      (b) => b.id === 'combo-window' && b.remainingMs > 0,
    );

    const skills = slots
      .map((slot) => this.buildSlot(engine, slot, state.tick, playerStats.haste ?? 0, comboWindowOpen))
      .filter((s): s is SkillSlotView => s !== undefined);

    const result =
      state.status === 'running' ? undefined : this.buildResult(engine, state.tick);

    return {
      tick: state.tick,
      status: state.status,
      ...(result === undefined ? {} : { result }),
      ...(remainingMs === undefined ? {} : { remainingMs }),
      enraged: boss.buffs.some((b) => b.id.startsWith('boss-enrage')),
      player,
      boss,
      skills,
      floatingText: this.floating,
      ...(this.statusLine === '' ? {} : { statusLine: this.statusLine }),
      ...(this.statusDetail === '' ? {} : { statusDetail: this.statusDetail }),
      telegraphing: boss.cast !== undefined,
      /**
       * 霸体：由 boss 身上的 `interruptImmune` buff 决定。
       *
       * 与 `castView.interruptible` 读的是同一个 flag —— 两处结论必须
       * 一致，否则会出现"读条说不可打断、但人物没描边"这种自相矛盾。
       */
      armored: boss.buffs.some(
        (b) => engine.buffDef(b.id)?.flags?.interruptImmune === true,
      ),
      playerFlash: this.playerFlash,
      bossFlash: this.bossFlash,
    };
  }

  /**
   * 构建结算信息。
   *
   * "造成伤害"用**玩家对 Boss 的累计**（逐次命中累加），
   * 而不是"Boss 掉的血" —— 后者在有护盾/治疗时会失真。
   */
  private buildResult(engine: BattleEngine, tick: number): ResultView {
    const state = engine.snapshot;
    const player = state.combatants.find((c) => c.side === 'ally');
    const seconds = (tick - state.startedAtTick) * (1000 / 60) / 1000;
    const victory = state.status === 'victory';

    const reasonKey =
      state.status === 'victory'
        ? 'screen.wonByKill'
        : state.endReason === 'timeout'
          ? 'screen.defeatedByTimeout'
          : state.endReason === 'enrage'
            ? 'screen.defeatedByEnrage'
            : 'screen.defeatedByDeath';

    /**
     * 胜因里的 Boss 名走**参数**，不写死在文案里。
     *
     * ⚠️ 传的是**名字的 i18n key**（`boss.name`），不是译好的文字 ——
     * 渲染层拿到 key 自己再翻一次，符合"适配器不产文案"的分层。
     */
    const bossNameKey = state.combatants.find((c) => c.side === 'enemy')?.nameKey;

    return {
      victory,
      titleKey: victory ? 'screen.victory' : 'screen.defeat',
      reasonKey,
      ...(reasonKey === 'screen.wonByKill' && bossNameKey !== undefined
        ? { reasonParams: { name: bossNameKey } }
        : {}),
      seconds: seconds.toFixed(1),
      remainingHp: Math.ceil(player?.resources.hp ?? 0),
      remainingHpCap: Math.ceil(player?.caps.hp ?? 1),
      totalDamage: Math.round(this.damageDealt),
      dps: seconds > 0 ? Math.round(this.damageDealt / seconds) : 0,
    };
  }

  private buildSlot(
    engine: BattleEngine,
    slot: SlotBinding,
    tick: number,
    haste: number,
    comboWindowOpen: boolean,
  ): SkillSlotView | undefined {
    const skill = this.skills.get(slot.skillId);
    if (!skill) return undefined;
    const state = engine.snapshot.combatants.find((c) => c.side === 'ally');
    if (!state) return undefined;

    // 冷却：引擎把"下次可用 tick"存在 cooldowns 里
    const readyAt = state.cooldowns[slot.skillId] ?? 0;
    const totalTicks = Math.max(1, Math.round((skill.cooldown * (1 - haste)) / (1000 / 60)));
    const remainTicks = Math.max(0, readyAt - tick);
    const cooldownRatio = skill.cooldown > 0 ? Math.min(1, remainTicks / totalTicks) : 0;

    // 资源是否够（UI 需要提前变灰，而不是等玩家按了才拒绝）
    let costOk = true;
    for (const cost of skill.cost) {
      const need = typeof cost.value === 'number' ? cost.value : 0;
      const has = (state.resources as Record<string, number>)[cost.resource] ?? 0;
      if (has < need) costOk = false;
    }

    // 前置条件（派生窗口）
    let conditionOk = true;
    for (const cond of skill.requires ?? []) {
      if (cond.kind === 'hasBuff' && cond.buffId === 'combo-window' && !comboWindowOpen) {
        conditionOk = false;
      }
    }

    const casting = state.casts.length > 0;
    const usable = costOk && conditionOk && cooldownRatio <= 0.001 && !casting;

    // 不可用原因用**本地化 key**表达，UI 层负责取文案
    let blockedKey: string | undefined;
    if (!conditionOk) blockedKey = 'block.comboWindow';
    else if (!costOk) blockedKey = 'block.cost';
    else if (cooldownRatio > 0.001) blockedKey = 'block.cooldown';
    else if (casting) blockedKey = 'block.casting';

    /**
     * 资源代价 —— 取**第一项**。
     *
     * 现在的技能都只有一项代价；如果以后出现"同时消耗炁和缠"，
     * 这里要改成数组（格子右上角放不下两项，得换表达方式）。
     * 按住技（「防」）的代价在 `holdDrain` 里，不是 `cost`。
     */
    const firstCost = skill.cost[0];
    const drain = skill.holdDrain;
    /**
     * 数据层（`core/types.ts`）把 `resource` 声明成了宽泛的 `string`，
     * 而视图层要的是 `'hp' | 'energy' | 'douqi'`。用**类型守卫**收敛，
     * 不用 `as` 断言（AGENTS.md §1）。守卫失败就当作"没有代价可显示"，
     * 这比让一个未知字符串漏进渲染层更安全。
     */
    const cost: SlotCost | undefined =
      firstCost !== undefined && typeof firstCost.value === 'number'
        ? toSlotCost(firstCost.resource, firstCost.value)
        : drain !== undefined
          ? // 按住技：代价是"每逻辑步扣一次" → 换算成**每秒**并标上 /s
            toSlotCost(drain.resource, drain.perLogicTick, '/s')
          : undefined;

    return {
      index: slot.index,
      key: slot.key,
      skillId: slot.skillId,
      nameKey: skill.nameKey,
      icon: skill.icon,
      usable,
      cooldownRatio,
      ...(cost === undefined ? {} : { cost }),
      cooldownSec: (remainTicks * (1000 / 60)) / 1000,
      // 固有冷却（满值）—— 左下角显示的那个
      skillCdSec: skill.cooldown / 1000,
      comboReady: (skill.requires?.length ?? 0) > 0 && conditionOk,
      ...(blockedKey === undefined ? {} : { blockedKey }),
    };
  }

}

/** 从引擎状态构建一个单位的渲染视图。 */
function toCombatantView(engine: BattleEngine, id: string, tick: number): CombatantView {
  const raw = engine.snapshot.combatants.find((c) => c.id === id);
  if (!raw) return emptyCombatant(id);
  const stats = engine.statsOf(id);

  const cast = raw.casts[0];
  let castView: CombatantView['cast'];
  if (cast) {
    const skill = engine.skillOf(cast.skillId);
    const elapsedMs = (tick - cast.startedAtTick) * (1000 / 60);
    const progress = cast.castTimeMs > 0 ? Math.min(1, elapsedMs / cast.castTimeMs) : 0;
    const nextHit =
      skill?.hits.find((h: { at: number }) => h.at > elapsedMs)?.at ?? cast.castTimeMs;
    /**
     * `interruptible` 在这里被**重新解释**为"现在能不能被打断"。
     *
     * 引擎里它是技能自身的静态标记；而**霸体是状态**，会临时推翻它。
     * 视图层给出合并后的结论，UI 才不必同时了解两套规则。
     * （引擎侧真正拦截打断的地方在 `interrupt` effect 里，
     * 同样读 `interruptImmune` —— 两边结论一致。）
     */
    const armored = raw.buffs.some(
      (b) => engine.buffDef(b.defId)?.flags?.interruptImmune === true,
    );
    /**
     * 读条上要显示的提示标签。
     *
     * 「霸体」是**状态**（引擎里由 `interruptImmune` 标记表达），
     * 而不是技能静态属性 —— 所以这里要合并两者：
     *   技能自己声明的 `hintTags` ∪ 当前状态推出的 `interruptImmune`
     * 否则 Boss 开了霸体、读条上却不提示，玩家会白按「破」。
     */
    const castTags = new Set(skill?.hintTags ?? []);
    if (armored) castTags.add('interruptImmune');
    const hintTags = [...castTags];

    castView = {
      skillId: cast.skillId,
      nameKey: skill?.nameKey ?? 'hud.casting',
      progress,
      interruptible: cast.interruptible && !armored,
      remainingMs: Math.max(0, nextHit - elapsedMs),
      ...(hintTags.length === 0 ? {} : { hintTags }),
    };
  }

  const buffs: BuffView[] = raw.buffs
    .filter((buff) => !isInternalBuff(buff.defId, engine.buffDef(buff.defId)?.hidden))
    .map((buff) => {
    const def = engine.buffDef(buff.defId);
    const durationMs = def?.duration ?? 0;
    const remainingMs = Number.isFinite(buff.expiresAtTick)
      ? Math.max(0, (buff.expiresAtTick - tick) * (1000 / 60))
      : Number.POSITIVE_INFINITY;
    const polarity = def?.polarity ?? 'neutral';
    return {
      id: buff.defId,
      nameKey: def?.nameKey ?? 'hud.casting',
      icon: def?.icon ?? '',
      polarity,
      // 内容指定了颜色就用它，否则按极性给个兜底色
      color: def?.color ?? defaultBuffColor(polarity, buff.defId),
      shortLabelKey: shortLabelKeyOf(buff.defId),
      stacks: buff.stacks,
      remainingMs,
      durationMs,
      isDefensive: isDefensiveBuff(buff.defId),
    };
  });

  return {
    id,
    nameKey: raw.nameKey,
    side: raw.side,
    alive: raw.alive,
    hp: { current: raw.resources.hp, cap: raw.caps.hp },
    energy: { current: raw.resources.energy, cap: raw.caps.energy },
    douqi: { current: raw.resources.douqi, cap: raw.caps.douqi },
    buffs,
    ...(castView ? { cast: castView } : {}),
  } satisfies CombatantView & { _stats?: typeof stats };
}

function emptyCombatant(id: string): CombatantView {
  return {
    id,
    nameKey: 'hud.level',
    side: 'ally',
    alive: true,
    hp: { current: 0, cap: 1 },
    energy: { current: 0, cap: 1 },
    douqi: { current: 0, cap: 1 },
    buffs: [],
  };
}

function emptyView(tick: number): BattleSnapshotView {
  return {
    tick,
    status: 'idle',
    enraged: false,
    player: emptyCombatant('player'),
    boss: { ...emptyCombatant('meiichiro'), side: 'enemy' },
    skills: [],
    floatingText: [],
    telegraphing: false,
    armored: false,
    playerFlash: 0,
    bossFlash: 0,
  };
}

/**
 * 从**键位表**推导战斗画面右下角的技能格。
 *
 * ==================================================================
 * 为什么不让调用方手写 slots
 * ==================================================================
 *
 * 原先 `DEFAULT_SLOTS` 是一张**写死的 6 格表**，与键位表各说各话。
 * 于是改键之后画面不跟着变，而"新增一个默认不绑键的技能（「闪」）"
 * 也没法表达 —— 它要么强行占一格，要么根本不出现。
 *
 * 现在**键位表是唯一真相来源**：
 *   - 有键的技能才出现在战斗画面，顺序按 `index`
 *   - 没键的技能（「闪」默认如此）仍然在设置里可绑，但不占画面
 *
 * ⚠️ 需求："暂时不设置最大按键数量" —— 这里不做截断，
 * 技能栏自己按画布宽度收窄（见 `SkillBarView` 的 `max`）。
 */
export function slotsFromBindings(
  bindings: readonly { readonly key: string; readonly skillId: string }[],
): readonly SlotBinding[] {
  return bindings
    .filter((b) => b.key !== '')
    .map((b, i) => ({ index: i, key: b.key, skillId: b.skillId }));
}

/** 默认技能槽（= 默认键位表推导出的那一份）。 */
export const DEFAULT_SLOTS: readonly SlotBinding[] = slotsFromBindings([
  { key: 'q', skillId: 'attack' },
  { key: 'w', skillId: 'blast' },
  { key: 'e', skillId: 'focus' },
  { key: 'r', skillId: 'break' },
  { key: 'a', skillId: 'dodge' },
  { key: 's', skillId: 'guard' },
]);

/** GCD 时长再导出，避免渲染层直接 import core/combat。 */

/**
 * 把 core 的宽泛 `resource: string` 收敛成视图层的 `ResourceKeyName`。
 *
 * 用类型守卫而不是断言：未知资源名返回 `undefined`，
 * 渲染层就只是"这个格子没有代价可显示"，不会拿到一个它不认识的值。
 */
function toSlotCost(resource: string, value: number, suffix?: string): SlotCost | undefined {
  if (resource === 'hp' || resource === 'energy' || resource === 'douqi') {
    return suffix === undefined ? { resource, value } : { resource, value, suffix };
  }
  return undefined;
}
