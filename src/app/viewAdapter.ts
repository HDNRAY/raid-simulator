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
import { buildSlotView, slotViewOfSkill } from './slotViews';
import { emptyCombatant, emptyView } from '../render/emptyView';
import type { FeedbackState } from '../render/feedback';
import { HitFeedbackTracker } from './hitFeedback';

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
import { hintKeysOf } from './skillHints';
import { floatAnchorOf } from '../render/actorLayout';
import type { TranslateFn } from '../i18n/translator';
import type {
  BattleSnapshotView,
  BuffView,
  CombatantView,
  FloatingTextView,
  ResultView,
  SkillSlotView,
  SlotPressState,
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
  /** 法术动画的触发计数（见 `BattleSnapshotView.spellSeq`）。 */
  private spellSeq = 0;
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
    private readonly translate: TranslateFn | undefined = undefined,
    /**
     * 这一局是不是**肉鸽**（2026-10-22）：只决定结算那句提示（"继续" vs
     * "再来一次"）。**由开局时传一次**，不在渲染层猜 ✗。
     */
    private readonly roguelike = false,
    /**
     * **按下状态**（2026-10-22）：由输入层提供（键鼠 + 触屏），每帧取一次。
     * 缺省 ⇒ 没有任何按下反馈（单测 / 无输入的场合）。
     * ⚠️ 传**函数**而不是快照：按下是每 tick 变的。
     */
    private readonly pressState: (() => SlotPressState) | undefined = undefined,
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
          /**
           * **这一下打的是谁**。判据是"目标不叫 `player`"（不是写死 Boss 的
           * id）—— 换 Boss 时不需要改这里。
           *
           * ⚠️ 它**不**用来决定飘字的落点（那由 `floatAnchorOf` 自己判，
           * 见下）；这里只管闪白、累计伤害与顿帧 id。
           */
          const onBoss = event.targetId !== 'player';
          /**
           * ⚠️ **锚点从角色自己的位置派生**（`floatAnchorOf`）—— 渲染层
           * 不再自己写 `630` / `300`。
           *
           * 2026-10-13 的 bug：这两行曾经是
           * `baseX = onBoss ? 630 : 300`，而站位互换之后**玩家的 x 是
           * 630、Boss 是 300** —— 于是飘字正好落反：玩家的伤害数字飘在
           * Boss 头上，Boss 的飘在玩家头上（用户报的"角色和boss位置互换
           * 了，战斗文字飘的位置好像没有跟着换"）。
           *
           * 根因不是"数字写错了"，而是**同一个事实（谁站在哪）被算了两
           * 遍**：一遍在 `actorLayout.ACTOR_POS`（角色真的画在那里），
           * 一遍在这里的字面量里（飘字用）。两处必然漂 —— 现在只有一处。
           */
          const anchor = floatAnchorOf(event.targetId);
          this.pushFloating(
            `-${event.amount}${event.crit ? '!' : ''}`,
            damageColor(event.amount, event.crit),
            anchor.x,
            anchor.y,
          );
          /**
           * 强度用**比例**（伤害 ÷ 最大生命），于是暴击/重击自然更重，
           * 不需要为它们单独写反馈。见 `feedback.ts` 的说明。
           */
          if (onBoss) {
            this.bossFlash = 1;
            /**
             * **黛玄的法术动画**（2026-10-22）：她打到 Boss 的每一发都让
             * 渲染层"播下一组"圣光弹。判据是**技能 id**（弹 / 波），
             * 不是"谁打的" —— 同一角色以后加新法术只改这一行。
             */
            /**
             * ⚠️ 2026-10-22 第二次修：判据从"**技能 id**"改成"**谁在打**"。
             *
             * 原因是实测发现：黛玄的「弹」本身**不造成伤害**，真正掉血的是它
             * 挂的那条隐藏节拍（`daixuan-tan-rhythm`）⇒ `event.skillId` 根本
             * 不是 `dan` ⇒ 旧判据一次都不成立（`seq` 一直是 0）✗。
             *
             * 现在按"**黛玄对 Boss 造成的伤害**"触发 —— 她所有进攻手段
             * （弹的节拍 / 波 / 冲）都会让圣光弹亮一下，这正是想要的观感。
             */
            if (this.lastPlayerId === 'daixuan') this.spellSeq += 1;
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
          /**
           * ⚠️ 回血也落在**被回血的人**头上，不是写死玩家那边。
           *
           * 原先这里是 `(300, 380)` 两个字面量 —— 与伤害那一处是同一个
           * 病（第二份"谁在哪"），而且更隐蔽：傲慢的「回补」是**它自己**
           * 回血，`targetId` 是 Boss，所以 `+126` 会飘在玩家头上。
           * 现在与伤害共用同一个派生函数。
           */
          const anchor = floatAnchorOf(event.targetId);
          this.pushFloating(`+${event.amount}`, PALETTE.buff.bright, anchor.x, anchor.y);
          break;
        }
        case 'avoided': {
          this.setStatus(event.reason === 'immune' ? 'hud.immune' : 'hud.dodged', 90);
          // 满免伤飘「闪躲」（动作词），不是机制词「免疫」
          const label =
            event.reason === 'immune' ? this.text('hud.dodged') : '0';
          /**
           * ⚠️ 闪躲飘在**躲掉的那一方**头上（`targetId`，不是施法者）——
           * 与伤害、回血共用同一个派生函数。
           *
           * 原先这里也写死 `(300, ...)`：玩家被互换到右边之后，闪躲提示
           * 会飘到 Boss 那侧。
           */
          const anchor = floatAnchorOf(event.targetId);
          this.pushFloating(label, PALETTE.iframe.bright, anchor.x, anchor.y);
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
    );
    const boss = toCombatantView(
      engine,
      bossRaw.id,
      state.tick,
      this.hitFeedback.of(bossRaw.id),
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
    const builtSkills = derivedSlots
      .map((slot) =>
        buildSlotView(
          this.skills,
          engine,
          slot,
          state.tick,
          playerStats.haste ?? 0,
          comboWindowOpen,
          derivedFrom,
        ),
      )
      .filter((s): s is SkillSlotView => s !== undefined);
    /**
     * **按下 / 按住**（2026-10-22）：给每一格贴上"刚按下"与"正被按住"。
     * 没有输入来源时原样返回（不产生新数组，避免无谓的 GC 抖动）。
     */
    const press = this.pressState?.();
    const skills = press === undefined
      ? builtSkills
      : builtSkills.map((slot) => ({
          ...slot,
          pressed: press.pressed.has(slot.skillId),
          holding: press.holding.has(slot.skillId),
        }));

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
      playerFlash: this.playerFlash,
      bossFlash: this.bossFlash,
      spellSeq: this.spellSeq,
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
      ...(this.roguelike ? { roguelike: true } : {}),
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

  /**
   * **单独造一个槽位视图**（这个技能**不需要**在技能栏里）。
   *
   * 实现搬到 `./slotViews`（"一个技能槽位怎么造"这一撮横向切出去的，
   * 见那里的文件头）。这里只做**转交**：`skills` 是适配器持有的注册表。
   */
  slotViewOf(engine: BattleEngine, skillId: string, index: number): SkillSlotView | undefined {
    return slotViewOfSkill(this.skills, engine, skillId, index);
  }


}

/** 从引擎状态构建一个单位的渲染视图。 */
function toCombatantView(
  engine: BattleEngine,
  id: string,
  tick: number,
  /** 本帧的受击反馈（由调用方按"事件 + 老化帧数"算好）。 */
  feedback: FeedbackState,
): CombatantView {
  const raw = engine.snapshot.combatants.find((c) => c.id === id);
  if (!raw) return emptyCombatant(id);
  const stats = engine.statsOf(id);

  /**
   * 是否**眩晕**（完全不能行动）。
   *
   * ⚠️ 判据是"有没有带 `actionLock` 的 buff"，**不是**写死 `lust-stun`
   * 这个 id：以后任何"禁行动"的来源都自动获得同一个提示。
   */
  const stunned = raw.buffs.some((b) => engine.buffDef(b.defId)?.flags?.actionLock === true);

  const cast = raw.casts[0];
  let castView: CombatantView['cast'];
  if (cast) {
    const skill = engine.skillOf(cast.skillId);
    const elapsedMs = (tick - cast.startedAtTick) * (1000 / 60);
    const progress = cast.castTimeMs > 0 ? Math.min(1, elapsedMs / cast.castTimeMs) : 0;
    /**
     * ⚠️ 只有主动技能有 `hits`（被动技能没有命中段）—— 而读条本来就只属于
     * 主动技能，所以按 `kind` 收窄；不是主动技能就没有"下一段"可预告。
     */
    const hits = skill?.kind === 'activeSkill' ? skill.hits : [];
    const nextHit = hits.find((h) => h.at > elapsedMs)?.at ?? cast.castTimeMs;
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
    /**
     * ⚠️ 列表里装的是 **i18n key**（不是 `HintTag` 值）—— 因为控制类提示
     * 取的是**那个 debuff 自己的名字**（「倒地」「眩晕」），而那不是
     * `HintTag` union 里的值。见 `app/skillHints.ts`。
     */
    const castTags = new Set(hintKeysOf(skill));
    /** 霸体是**状态**（霸体 buff 挂没挂），所以它只能在这里补，不能静态推导。 */
    if (armored) castTags.add('settings.hintTags.interruptImmune');
    const hintTags = [...castTags];

    castView = {
      skillId: cast.skillId,
      nameKey: skill?.nameKey ?? 'hud.casting',
      progress,
      interruptible: cast.interruptible && !armored,
      remainingMs: Math.max(0, nextHit - elapsedMs),
      /** ⚠️ 从**技能定义**推：引导是技能自己的声明（引擎不读它，UI 读）。 */
      ...(skill?.kind === 'activeSkill' && skill.channel !== undefined ? { channel: true } : {}),
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
    stunned,
    feedback,
    ...(castView ? { cast: castView } : {}),
  } satisfies CombatantView & { _stats?: typeof stats };
}
