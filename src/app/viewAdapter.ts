/**
 * 引擎状态 → 渲染 view-model 的适配器。
 *
 * 这是**唯一**允许同时知道引擎与渲染两侧的文件（它住在 `app/`，不属于
 * 任何一侧），所以两边的耦合被限制在这里 —— 换渲染库或换引擎时改动
 * 范围可控。
 *
 * 它把引擎的**事件流**变成渲染需要的东西：飘字、屏幕闪白、状态提示、
 * 受击反馈（后者交给 `./hitFeedback`）。
 */

import type { BattleEngine } from '../core/combat/battleState';
import type { SkillDef, EventDef } from '../core/types';
import { PALETTE } from '../render/theme';
import { deriveSlots, type SlotBinding } from './derivedSlots';
import { IDLE_FEEDBACK, type FeedbackState } from '../render/feedback';
import { HitFeedbackTracker } from './hitFeedback';
import { isAttacking, lastUsedKey } from './attackFrame';
/**
 * 槽位相关的两个导出**搬到了 `./derivedSlots`**（那里才是内聚的位置：
 * 派生技的槽位推导与基础槽位推导是一件事）。这里**转发**，外部
 * import 路径不变。
 */
export { DEFAULT_SLOTS, slotsFromBindings, type SlotBinding } from './derivedSlots';
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
  /**
   * **受击反馈**（跨帧老化 + 曲线）。
   *
   * ⚠️ 这里只记"发生了什么"，"现在该显示什么"由 `feedback.ts` 的纯函数
   * 算 —— 所以曲线可以单测，事件分支里也不用手写衰减。
   */
  private readonly hitFeedback = new HitFeedbackTracker();
  /** 最近一次 `consume` 见过的两个角色 id（`pendingHitStopMs` 要用）。 */
  private lastPlayerId = '';
  private lastBossId = '';
  private statusLine = '';
  private statusLineTtl = 0;

  /** 每个技能上次使用的 tick，用于在引擎不暴露 CD 时估算冷却显示。 */
  /**
   * 最近一次"谁在什么时候用了哪个技能"（键见 `lastUsedKey`）。
   * ⚠️ 原先键只有 `skillId` 且只写不读（死字段）—— 必须带来源 id，
   * 否则 Boss 放攻击技会让玩家也播攻击帧。
   */
  private readonly lastUsed = new Map<string, number>();
  private readonly skillNameKeys = new Map<string, string>();
  /** 状态提示的副标题（例如"贯击 · 公共冷却"） */
  private statusDetail = '';
  /** 累计造成的总伤害（结算面板用） */
  private damageDealt = 0;
  /** 累计承受的总伤害 */
  private damageTaken = 0;
  /** 最近一次被拒的「技能 + 原因」与它的 tick（用于 1 秒内去重）。 */
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
  /**
   * 本帧事件要求的**顿帧时长**（ms）—— 主循环读它来冻结推进。
   *
   * ⚠️ 由适配器"算好、报出来"，而不是主循环自己判断事件：判断依据与
   * 反冲/挤压同源（都是 `feedback.ts` 的曲线），分两处必然漂移。
   */
  pendingHitStopMs(): number {
    return Math.max(
      this.hitFeedback.of(this.lastPlayerId).hitStopMs,
      this.hitFeedback.of(this.lastBossId).hitStopMs,
    );
  }

  consume(
    events: readonly EventDef[],
    tick: number,
    playerId: string,
    /**
     * 取某个角色的**最大生命**（强度分频用）。
     *
     * ⚠️ 由调用方注入而不是适配器自己存快照：适配器已经只依赖
     * "事件 + tick"，自己缓存一份快照会变成**第二个真相**
     * （引擎状态与缓存不一致时，反馈强度会算错且很难查）。
     */
    capsOf: (id: string) => number = () => 0,
  ): void {
    this.lastPlayerId = playerId;
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
          /**
           * 强度用**比例**（伤害 ÷ 最大生命），于是暴击/重击自然更重，
           * 不需要为它们单独写反馈。见 `feedback.ts` 的说明。
           */
          if (onBoss) {
            this.bossFlash = 1;
            this.damageDealt += event.amount;
          } else {
            this.playerFlash = 1;
            this.damageTaken += event.amount;
          }
          /**
           * 受击反馈按**比例**给强度（暴击/重击自然更重），
           * 见 `feedback.ts`。两个角色走同一条路 —— 这就是"统一设计"。
           */
          this.hitFeedback.note(
            event.targetId,
            event.amount,
            capsOf(event.targetId),
            event.crit,
          );
          // 记下 Boss 的 id（顿帧查询要用；不能假设它叫某个固定名字）
          if (onBoss) this.lastBossId = event.targetId;
          break;
        }
        case 'heal': {
          if (event.amount <= 0) break;
          this.pushFloating(`+${event.amount}`, PALETTE.buff.bright, 300, 380);
          break;
        }
        case 'avoided': {
          this.setStatus(event.reason === 'immune' ? 'hud.immune' : 'hud.dodged', 90);
          // 满免伤飘「闪躲」（动作词），不是机制词「免疫」
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
          this.lastUsed.set(lastUsedKey(event.sourceId, event.skillId), event.tick);
          // 成功放出技能 → 立刻清掉被拒提示（否则会残留到超时）
          if (event.sourceId === playerId) {
            this.lastReject = undefined;
            this.statusLine = '';
            this.statusDetail = '';
            this.statusLineTtl = 0;
          }
          break;
        }
        default:
          break;
      }
    }

    // 衰减
    this.playerFlash = Math.max(0, this.playerFlash - 0.08);
    this.bossFlash = Math.max(0, this.bossFlash - 0.12);
    this.hitFeedback.advance();
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
   * 加一条飘字，位置带**确定性随机**（需求："战斗文字 位置随机一点"）。
   * 不用 `Math.random` 是为了可在 Node 里复现 —— 用自增 id 做散列即可。
   * 原先的 `(length % 5) * 18` 会让相邻几条排成整齐一列。
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
    slots: readonly SlotBinding[] | ((engine: BattleEngine) => readonly SlotBinding[]),
    options: { readonly timeLimitMs?: number } = {},
  ): BattleSnapshotView {
    const state = engine.snapshot;
    const playerRaw = state.combatants.find((c) => c.side === 'ally');
    const bossRaw = state.combatants.find((c) => c.side === 'enemy');
    if (!playerRaw || !bossRaw) return emptyView(state.tick);

    const playerStats = engine.statsOf(playerRaw.id);
    const player = toCombatantView(
      engine,
      playerRaw.id,
      state.tick,
      this.hitFeedback.of(playerRaw.id),
      isAttacking(this.lastUsed, this.skills, playerRaw.id, state.tick),
    );
    const boss = toCombatantView(
      engine,
      bossRaw.id,
      state.tick,
      this.hitFeedback.of(bossRaw.id),
      isAttacking(this.lastUsed, this.skills, bossRaw.id, state.tick),
    );

    const remainingMs =
      options.timeLimitMs === undefined
        ? undefined
        : Math.max(0, options.timeLimitMs - (state.tick - state.startedAtTick) * (1000 / 60));

    const comboWindowOpen = player.buffs.some(
      (b) => b.id === 'combo-window' && b.remainingMs > 0,
    );
    /**
     * **派生窗口是从哪个技能来的** —— 需求要求把派生技画在源技能上方。
     *
     * ⚠️ 从 buff 的 flags 读而不是查技能的静态字段：源是**动态的**
     * （"后派生的顶掉先派生的"），buff 刷新时 flags 一起被覆盖。
     */
    const derivedFrom = playerRaw.buffs.find(
      (b) => b.defId === 'combo-window',
    )?.def?.flags?.comboWindowSource;

    /**
     * ⚠️ `slots` 允许是**函数**：派生技的槽位是**每帧变**的
     * （窗口开了才有、用掉就消失），提前算好会一直显示过期状态。
     */
    const resolvedSlots = typeof slots === 'function' ? slots(engine) : slots;
    /**
     * **派生技的槽位在这里动态插进来。**
     *
     * 它不在绑定表里（平时不可用、也不该出现在设置页），所以只能由
     * "源技能有派生窗口"这一个事实推出来。而判定用的 `comboWindowOpen`
     * 与 `derivedFrom` 是**同一个来源**（上面刚读的 buff），
     * 所以不会出现"技能栏说能用、按下去被拒"。
     */
    const { slots: derivedSlots } = deriveSlots(resolvedSlots, playerRaw.buffs, this.skills);
    const skills = derivedSlots
      .map((slot) =>
        this.buildSlot(engine, slot, state.tick, playerStats.haste ?? 0, comboWindowOpen, derivedFrom),
      )
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
    /** 派生窗口的源技能（没有窗口时为 undefined）。 */
    derivedFrom: string | undefined,
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
      /**
       * 只有**派生技**才带 `derivedFrom` —— 判断依据是"它有 requires"。
       * 渲染层据此把它画在源技能旁边，而不是占一个正常槽位。
       */
      ...((skill.requires?.length ?? 0) > 0 && comboWindowOpen && derivedFrom !== undefined
        ? { derivedFrom }
        : {}),
      ...(blockedKey === undefined ? {} : { blockedKey }),
    };
  }

}

/** 从引擎状态构建一个单位的渲染视图。 */
function toCombatantView(
  engine: BattleEngine,
  id: string,
  tick: number,
  /** 本帧的受击反馈（由调用方按"事件 + 老化帧数"算好）。 */
  feedback: FeedbackState,
  /** 刚放了攻击招式（见 `isAttacking`）。 */
  attacking: boolean,
): CombatantView {
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
    attacking,
    feedback,
    ...(castView ? { cast: castView } : {}),
  } satisfies CombatantView & { _stats?: typeof stats };
}

function emptyCombatant(id: string): CombatantView {
  return {
    attacking: false,
    feedback: IDLE_FEEDBACK,
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
