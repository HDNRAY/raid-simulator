import { BattleLoop } from './app/battleLoop';
import { DEFAULT_SLOTS } from './app/viewAdapter';
import { createRegistry } from './core/content/registry';
import { VERROT_BEHAVIORS } from './core/ai';
import { ALL_BUFFS, ALL_SKILLS } from './data/content';
import { ENTROPY_CLOCK } from './data/entities/entropyClock';
import { DEFAULT_BINDINGS } from './input/keyboard';
import { flattenCatalog, translator } from './i18n/translator';
import { zhCN } from './i18n/locales/zh-CN';
import { LOGICAL_H, LOGICAL_W, type ScalingMode } from './render/scaling';
import { observeStage } from './render/sizes';
import { BattleScene } from './render/BattleScene';
import type { Combatant, StatKey, StatModifier } from './core/types';
import './styles.css';

/**
 * MVP 入口。
 *
 * 数据流（严格单向）：
 *   键盘 → Action → 引擎 tick → 事件 → view-model → Pixi 场景
 *
 * 渲染层**只读** view-model，从不反向调用引擎（架构规范 C3）。
 */

const SCALING_MODE: ScalingMode = 'fit';

/** 每场战斗的时限。超时判负。与 Boss 的 enrage 阈值一致。 */
const TIME_LIMIT_MS = 180_000;

/**
 * 玩家基础属性。
 *
 * `energyRegen` 是这套技能组的**节奏来源**：防御技（闪避 30 / 格挡 20）
 * 只消耗精力，所以"我现在躲得起吗"完全由它决定。
 * 22/秒 大致支持"每 1.4 秒一次防御"或"连续两次闪避"。
 */
const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 120,
  agility: 100,
  intelligence: 110,
  spirit: 100,
  energyRegen: 22,
  critChance: 0.2,
  critDamage: 0.5,
};

/** 玩家资源上限。 */
const PLAYER_CAPS = { hp: 12_000, energy: 120, douqi: 100 };

/**
 * Boss 资源上限。
 *
 * 17 万血配实测约 1300 DPS → 一场约 2.2 分钟的战斗。
 * 刻意留出余量：**玩得差的循环（不接派生、不放终结技）会打不完**，
 * 于是"把循环打对"变成通关的必要条件，而不是可选的优化。
 */
const BOSS_CAPS = { hp: 170_000, energy: 0, douqi: 0 };

function makePlayer(): Combatant {
  return {
    id: 'player',
    nameKey: 'hud.you',
    side: 'ally',
    caps: { ...PLAYER_CAPS },
    resources: { hp: PLAYER_CAPS.hp, energy: PLAYER_CAPS.energy, douqi: 0 },
    counters: {},
    basePrimary: { strength: 120, agility: 100, intelligence: 110, spirit: 100 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: [],
    alive: true,
  };
}

function makeBoss(): Combatant {
  return {
    id: 'verrot',
    nameKey: 'boss.name',
    side: 'enemy',
    caps: { ...BOSS_CAPS },
    resources: { hp: BOSS_CAPS.hp, energy: 0, douqi: 0 },
    counters: {},
    basePrimary: { strength: 400, agility: 200, intelligence: 300, spirit: 200 },
    buffs: [],
    cooldowns: {},
    casts: [],
    uses: {},
    behaviors: VERROT_BEHAVIORS,
    alive: true,
  };
}

/** 把熵之钟的能力展开成被动修正池（装备就是"被动修正的集合"）。 */
function clockModifiers(): StatModifier[] {
  const out: StatModifier[] = [];
  for (const ability of ENTROPY_CLOCK.abilities) {
    if (ability.kind === 'modifier') out.push(ability.modifier);
    else if (ability.kind === 'derived') out.push({ ...ability.modifier, value: ability.value });
  }
  return out;
}

async function bootstrap(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('index.html is missing the #stage container');

  const { Application, Container, Graphics, Text } = await import('pixi.js');

  const app = new Application();
  await app.init({
    width: LOGICAL_W,
    height: LOGICAL_H,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    roundPixels: true,
    background: 0x0a0a0f,
  });
  stage.appendChild(app.canvas);

  /* ---------- 内容（校验通过才允许使用） ---------- */
  const registry = createRegistry(
    { entities: [ENTROPY_CLOCK], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
    { localeKeys: new Set(flattenCatalog(zhCN).keys()) },
  );

  /* ---------- 场景 ---------- */
  const scene = new BattleScene({
    app,
    pixi: { Container, Graphics, Text },
    translate: (key) => {
      try {
        return translator.t(key as Parameters<typeof translator.t>[0]);
      } catch {
        return key;
      }
    },
  });

  /* ---------- 一局战斗 ---------- */
  const startBattle = (): BattleLoop =>
    new BattleLoop({
      engineOptions: {
        combatants: [makePlayer(), makeBoss()],
        // 用真实时钟做种子：每次开局不同，但仍可复现（记录 seed 即可）
        seed: Date.now() >>> 0,
        bossId: 'verrot',
        timeLimitMs: TIME_LIMIT_MS,
        buffs: registry.buffs,
        skills: registry.skills,
        baseStats: new Map<string, Partial<Record<StatKey, number>>>([
          ['player', PLAYER_BASE],
          ['verrot', {}],
        ]),
        passiveModifiers: new Map([['player', clockModifiers()]]),
      },
      bindings: DEFAULT_BINDINGS_LOCAL,
      slots: DEFAULT_SLOTS,
      timeLimitMs: TIME_LIMIT_MS,
      stopOnEnd: true,
    });

  let loop = startBattle();

  const disposeStageObserver = observeStage(stage, app.canvas, SCALING_MODE, () => {});

  /* ---------- 主循环 ---------- */
  app.ticker.add(() => {
    frameCount += 1;
    loop.frame(performance.now());
    scene.update(loop.snapshot);
  });

  /* ---------- 重开 ----------
   * 战斗结束后按 Enter 重开（而不是 R —— R 是技能键之一）。 */
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && loop.engineState.snapshot.status !== 'running') {
      loop.dispose();
      loop = startBattle();
    }
  });

  /**
   * 调试探针：把战斗状态挂到 window，供端到端验证读取。
   *
   * 静态截图只能证明"渲染了一帧"，证明不了"战斗在推进"。
   * M7 起会被真正的调试面板与回放录制取代。
   */
  /** 捕获运行期异常，供端到端验证读取（否则会被静默吞掉）。 */
  const runtimeErrors: string[] = [];
  window.addEventListener('error', (event) => {
    runtimeErrors.push(String(event.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    runtimeErrors.push(`unhandled rejection: ${String(event.reason)}`);
  });

  let frameCount = 0;

  window.__raidBattle = {
    probe: () => {
      const state = loop.engineState.snapshot;
      const player = state.combatants.find((c) => c.side === 'ally');
      const boss = state.combatants.find((c) => c.side === 'enemy');
      const view = loop.snapshot;
      return {
        tick: state.tick,
        status: state.status,
        phase: state.phase,
        playerHp: player?.resources.hp ?? -1,
        playerHpCap: player?.caps.hp ?? -1,
        playerDouqi: player?.resources.douqi ?? -1,
        playerCooldowns: player?.cooldowns ?? {},
        playerCasts: player?.casts.length ?? -1,
        bossHp: boss?.resources.hp ?? -1,
        bossHpCap: boss?.caps.hp ?? -1,
        bossCasts: boss?.casts.length ?? -1,
        skillCount: view.skills.length,
        floatingCount: view.floatingText.length,
        frameCount,
        errors: [...runtimeErrors],
      };
    },
  };

  stage.classList.add('ready');

  window.addEventListener('pagehide', () => {
    disposeStageObserver();
    loop.dispose();
  });
}

/** 键位（与 DEFAULT_SLOTS 对应）。 */
const DEFAULT_BINDINGS_LOCAL = DEFAULT_BINDINGS;

void bootstrap();
