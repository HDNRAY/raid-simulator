import { BattleLoop } from './app/battleLoop';
import { DEFAULT_SLOTS } from './app/viewAdapter';
import { createRegistry } from './core/content/registry';
import { VERROT_BEHAVIORS } from './core/ai';
import {
  ALL_BUFFS,
  ALL_SKILLS,
  DOUQI_MAX,
  ENERGY_MAX,
  HP_MAX,
} from './data/content';
import { BOSS_HP_DISPLAY } from './data/entities/bossHp';
import { DEFAULT_BINDINGS, type KeyBinding } from './input/keyboard';
import { flattenCatalog, translator } from './i18n/translator';
import { zhCN } from './i18n/locales/zh-CN';
import { LOGICAL_H, LOGICAL_W, type ScalingMode } from './render/scaling';
import { observeStage } from './render/sizes';
import { BattleScene } from './render/BattleScene';
import type { Combatant, StatKey } from './core/types';
import { SettingsButton } from './ui/settings/SettingsButton';
import { SettingsPanel } from './ui/settings/SettingsPanel';
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
 * 新刻度下**不需要**主属性参与伤害计算了 —— 6 个技能的伤害都是
 * 内容里写死的固定值（攻 10 / 轰 30）。所以这里只留最小的基础值，
 * 属性系统本身仍然可用（装备/增益可以往里加）。
 *
 * 缠回复**不走属性**：它是固定"每 0.1 秒 1 点"，
 * 由 `data/balance.ts` 的 `ENERGY_PER_LOGIC_TICK` 决定。
 */
const PLAYER_BASE: Partial<Record<StatKey, number>> = {
  strength: 10,
  agility: 10,
  intelligence: 10,
  spirit: 10,
};

/**
 * 资源上限。
 *
 * 需求：双方都是 100 血，缠与炁上限也是 100。
 *
 * **直接用展示刻度**（不再乘 `DISPLAY_SCALE`）：内容的伤害值
 * （攻 10 / 轰 30）本身就是展示刻度，两边同刻度才能对上 ——
 * 早期把血量乘了 10 而伤害没乘，结果 10 点伤害变成打掉 1 点血，
 * 一场战斗要按上百次。
 */
const PLAYER_CAPS = { hp: HP_MAX, energy: ENERGY_MAX, douqi: DOUQI_MAX };

/**
 * Boss 资源上限。
 *
 * 血量取值依据见 `data/entities/bossHp.ts` —— 那是实测出来的
 * （玩家 214 DPS vs Boss 66 DPS），不是拍脑袋定的。
 */
const BOSS_CAPS = { hp: BOSS_HP_DISPLAY, energy: 0, douqi: 0 };

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
    { entities: [], skills: [...ALL_SKILLS], buffs: [...ALL_BUFFS] },
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
        passiveModifiers: new Map(),
      },
      bindings: bindings,
      slots: DEFAULT_SLOTS,
      timeLimitMs: TIME_LIMIT_MS,
      stopOnEnd: true,
    });

  /**
   * 键位表是**可变状态**，由设置界面修改。
   *
   * 放在这里而不是塞进 loop：`startBattle()` 每次重开都会重建 loop，
   * 而玩家的改键不该因为重开一局就被重置。
   */
  let bindings: readonly KeyBinding[] = DEFAULT_BINDINGS;

  let loop = startBattle();

  const disposeStageObserver = observeStage(stage, app.canvas, SCALING_MODE, () => {});

  /* ---------- 主循环 ---------- */
  app.ticker.add(() => {
    frameCount += 1;
    loop.frame(performance.now());
    scene.update(loop.snapshot);
    settingsButton.update();
    settings.update();
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
    /**
     * 直接注入一个动作（调试用）。
     *
     * 存在的理由：headless 环境下 rAF 会被降频，所以"按键 → 等技能进冷却"
     * 这条路在自动验证里不可靠。这个入口让验证脚本能精确地
     * 把游戏推到某个状态（例如"某个技能正在冷却"）再截图。
     */
    act: (skillId: string) => {
      loop.engineState.tick([
        { type: 'useSkill', skillId, atTick: loop.engineState.snapshot.tick },
      ]);
      loop.engineState.drainEvents();
    },
    /**
     * 把 Pixi stage 暴露出来。
     *
     * 用途：让验证脚本能读取**渲染层实际写进去的文本** ——
     * 只看截图无法区分"没画"和"画了但看不见"。
     */
    stage: app.stage,
    /**
     * 设置界面的调试入口。
     *
     * 存在的理由：headless 环境下模拟鼠标点击不可靠（rAF 会被降频，
     * 而且 CSS 缩放 → 逻辑坐标的换算依赖真实布局）。这个入口让验证
     * 脚本能直接把界面推到某个状态再截图。
     */
    settings: {
      open: (tab: 'general' | 'keys' = 'keys') => openSettings(tab),
      close: () => closeSettings(),
      openIn: (px: number, py: number) => settings.hitTest(px, py),
      isOpen: () => settingsOpen,
    },
    probe: () => {
      const state = loop.engineState.snapshot;
      const player = state.combatants.find((c) => c.side === 'ally');
      const boss = state.combatants.find((c) => c.side === 'enemy');
      const view = loop.snapshot;
      return {
        tick: state.tick,
        status: state.status,
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

  /* ---------- 设置界面 ---------- */
  const settings = new SettingsPanel({
    pixi: { Container, Graphics, Text },
    translate: (key) => translateSafe(key),
    getRows: () =>
      bindings.map((b) => ({
        skillId: b.skillId,
        nameKey: registry.skill(b.skillId).nameKey,
        key: b.key,
      })),
    onRebind: (skillId, key) => {
      // 同一个键只能绑一个技能：先把旧占用者解绑，再绑新的
      bindings = bindings.map((b) =>
        b.skillId === skillId ? { ...b, key } : b.key === key ? { ...b, key: '' } : b,
      );
      loop.setBindings(bindings);
    },
    onResetKeys: () => {
      bindings = DEFAULT_BINDINGS;
      loop.setBindings(bindings);
    },
    onCapture: (handler) => loop.inputSource?.capture(handler),
    onClose: () => closeSettings(),
  });
  app.stage.addChild(settings.root);

  const settingsButton = new SettingsButton({
    pixi: { Container, Graphics, Text },
    translate: (key) => translateSafe(key),
    onClick: () => toggleSettings(),
  });
  app.stage.addChild(settingsButton.root);

  let settingsOpen = false;
  const openSettings = (tab: 'general' | 'keys' = 'keys'): void => {
    settingsOpen = true;
    // 打开设置必须暂停战斗 —— 否则玩家改键时会被 Boss 打死
    loop.setPaused(true);
    settings.open(tab);
  };
  const closeSettings = (): void => {
    settingsOpen = false;
    settings.close();
    loop.setPaused(false);
  };
  const toggleSettings = (): void => {
    if (settingsOpen) closeSettings();
    else openSettings();
  };

  /* 鼠标：canvas 里自己算坐标（不做逐对象事件绑定，便于测试驱动） */
  app.canvas.addEventListener('pointerdown', (event) => {
    const rect = app.canvas.getBoundingClientRect();
    // CSS 尺寸 → 逻辑坐标（canvas 内部分辨率固定，靠 CSS 缩放）
    const px = ((event.clientX - rect.left) / rect.width) * LOGICAL_W;
    const py = ((event.clientY - rect.top) / rect.height) * LOGICAL_H;
    if (settingsOpen) settings.hitTest(px, py);
    else if (settingsButton.hitTest(px, py)) openSettings();
  });

  /* 设置打开时，键盘先给弹窗处理（改键捕获已经在输入层独占） */
  window.addEventListener(
    'keydown',
    (event) => {
      if (!settingsOpen) return;
      settings.handleKey(event.key.toLowerCase());
    },
    true,
  );

  /** 统一的翻译入口（缺 key 时回退到 key 本身，而不是抛错）。 */
  function translateSafe(key: string): string {
    try {
      return translator.t(key as Parameters<typeof translator.t>[0]);
    } catch {
      return key;
    }
  }

  stage.classList.add('ready');

  window.addEventListener('pagehide', () => {
    disposeStageObserver();
    loop.dispose();
  });

  void settings;
}

void bootstrap();
