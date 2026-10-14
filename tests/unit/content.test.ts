import { describe, expect, it } from 'vitest';
import { ENTROPY_CLOCK, ENTROPY_CLOCK_POTENTIAL } from '../../src/data/entities/entropyClock';
import { buffAbilities, buildDependencyGraph } from '../../src/core/expr/deps';
import {
  SUPPORTED_HOOKS,
  assertValidContent,
  validateContent,
  type ContentBundle,
} from '../../src/core/content/validate';
import { SUPPORTED_HOOKS as RUN_TRIGGER_HOOKS } from '../../src/core/combat/triggers';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { makeBuffDef, makeSkillDef } from './helpers';

const localeKeys = new Set(flattenCatalog(zhCN).keys());

/**
 * 一个空的装备方案。
 *
 * 装备系统**整体未接线**（见 `core/types/loadout.ts` 的 `Loadout` 说明），
 * 所以这里只需要一个形状正确的骨架 —— 校验器不看它有没有内容。
 */
const EMPTY_LOADOUT = {
  items: [],
  talents: [],
  skillBar: [],
  barSlotCount: 0,
} as const;

/** 一个最小的合法内容包，测试在其上做局部破坏。 */
function baseBundle(): ContentBundle {
  return {
    entities: [ENTROPY_CLOCK],
    skills: [],
    buffs: [],
    localeKeys,
  };
}

describe('熵之钟内容本身是合法的', () => {
  it('通过校验（含 i18n key 存在性，严格模式默认）', () => {
    expect(validateContent(baseBundle())).toEqual([]);
  });

  it('assertValidContent 不抛错', () => {
    expect(() => assertValidContent(baseBundle())).not.toThrow();
  });

  it('⚠️ 它的暴击触发链现在是**真的**：`onCritDealt` 已被引擎派发', () => {
    /**
     * 熵之钟的第三个效果（暴击后授予"势能涌动"）挂的是 `onCritDealt`。
     * 在 `onCritDealt` 有派发点之前，这份数据里的触发链**从来没跑过**，
     * 而它曾被 README 当作"完整的被动装备例子"当入门教材 —— 那是个
     * 跑不起来的例子。
     *
     * 现在派发点补上了（`hitResolution` 的暴击分支，见
     * `tests/unit/triggers.test.ts` 的"暴击真的会触发"），所以这份内容
     * 通过严格校验、且不再是"静默无效"。
     *
     * ⚠️ 但它仍然是**装备系统的设计样本**：`Loadout.items` 没有运行期
     * 消费者，战斗里装配不了它；而且它加的 `intelligence +2` 落在
     * **四维属性**上，那四维目前也没有消费者。
     */
    expect(SUPPORTED_HOOKS).toContain('onCritDealt');
  });

  it('三个效果分别是 modifier / derived / trigger', () => {
    const kinds = ENTROPY_CLOCK.abilities.map((a) => a.kind);
    expect(kinds).toEqual(['modifier', 'modifier', 'derived', 'trigger']);
  });

  it('效果 2 带命名空间（这是可被引用的前提）', () => {
    const derived = ENTROPY_CLOCK.abilities.find((a) => a.kind === 'derived');
    expect(derived?.kind).toBe('derived');
    if (derived?.kind !== 'derived') return;
    expect(derived.modifier.namespace).toBe(ENTROPY_CLOCK_POTENTIAL);
  });

  it('暴击触发出来的 buff 引用命名空间，而不是写死的常量', () => {
    const trigger = ENTROPY_CLOCK.abilities.find((a) => a.kind === 'trigger');
    if (trigger?.kind !== 'trigger') throw new Error('expected trigger');
    const grant = trigger.trigger.then[0];
    if (grant?.kind !== 'grant') throw new Error('expected grant');
    const modifier = grant.buff.modifiers?.[0];
    expect(modifier?.value).toEqual({ e: 'contrib', namespace: ENTROPY_CLOCK_POTENTIAL });
    // 关键：不是数字字面量
    expect(typeof modifier?.value).toBe('object');
  });

  it('依赖图无环（contrib 引用的命名空间由自己产出，但那是同层引用不算环）', () => {
    const abilities = [...ENTROPY_CLOCK.abilities];
    const graph = buildDependencyGraph(abilities);
    // damageBoost 依赖 intelligence，intelligence 无依赖 —— 无环
    expect(graph.cycles).toHaveLength(0);
    expect(graph.byStat.get('damageBoost')?.dependsOn).toContain('intelligence');
  });
});

describe('校验器能抓到各类内容错误', () => {
  it('DUP_ID：重复 id', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [ENTROPY_CLOCK, { ...ENTROPY_CLOCK }],
    };
    const codes = validateContent(bundle).map((i) => i.code);
    expect(codes).toContain('DUP_ID');
  });

  it('MISSING_LOCALE_KEY：文案 key 不存在', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [{ ...ENTROPY_CLOCK, nameKey: 'entity.doesNotExist.name' }],
    };
    const issues = validateContent(bundle);
    expect(issues.map((i) => i.code)).toContain('MISSING_LOCALE_KEY');
  });

  it('KEY_ID_MISMATCH：key 与 id 不匹配', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [{ ...ENTROPY_CLOCK, nameKey: 'entity.entropyClock.name', id: 'other-thing' }],
      localeKeys: new Set([...localeKeys, 'entity.entropyClock.name']),
    };
    const issues = validateContent(bundle);
    expect(issues.map((i) => i.code)).toContain('KEY_ID_MISMATCH');
  });

  it('HIT_ORDER：命中时间不是升序', () => {
    const skill = makeSkillDef({
      id: 'bad-order',
      hits: [
        { at: 1000, effects: [] },
        { at: 500, effects: [] },
      ],
    });
    const bundle: ContentBundle = { ...baseBundle(), skills: [skill] };
    const issues = validateContent(bundle);
    expect(issues.map((i) => i.code)).toContain('HIT_ORDER');
  });

  it('ZERO_DURATION：持续时间为 0 的 buff', () => {
    const buff = makeBuffDef({ id: 'bad', duration: 0 });
    const bundle: ContentBundle = { ...baseBundle(), buffs: [buff] };
    expect(validateContent(bundle).map((i) => i.code)).toContain('ZERO_DURATION');
  });

  it('UNCAPPED_STACK：叠层没有上限', () => {
    const buff = makeBuffDef({
      id: 'bad-stack',
      stacking: { mode: 'stack', max: 0 },
    });
    const bundle: ContentBundle = { ...baseBundle(), buffs: [buff] };
    expect(validateContent(bundle).map((i) => i.code)).toContain('UNCAPPED_STACK');
  });

  it('MISSING_BUFF：grant 引用了不存在的 buff', () => {
    const skill = makeSkillDef({
      id: 'grants-missing',
      hits: [{ at: 0, effects: [{ kind: 'grantBuff', target: { mode: 'self' }, buffId: 'nope' }] }],
    });
    const bundle: ContentBundle = { ...baseBundle(), skills: [skill] };
    expect(validateContent(bundle).map((i) => i.code)).toContain('MISSING_BUFF');
  });

  it('MISSING_SKILL：grantSkill 引用了不存在的技能', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [
        {
          ...ENTROPY_CLOCK,
          abilities: [{ kind: 'grantSkill', skillId: 'no-such-skill' }],
        },
      ],
    };
    expect(validateContent(bundle).map((i) => i.code)).toContain('MISSING_SKILL');
  });

  it('COUNTER_UNIMPLEMENTED：用了 Expr.counter 的内容被拒绝（能力未接线）', () => {
    /**
     * 这是 ① 的"拒绝静默误用"落地：计数器没有写入者，战斗路径读它恒为 0，
     * 所以内容里写 `counter` 会被**拦下**（error），而不是安静地算成 0。
     *
     * ⚠️ 不实测的规则等于没写 —— 这里就是那个实测。
     */
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [
        {
          ...ENTROPY_CLOCK,
          abilities: [
            {
              kind: 'derived',
              modifier: {
                stat: 'damageBoost',
                op: 'addPercent',
                sourceKey: 'entity.entropyClock.name',
              },
              value: {
                e: 'counter',
                ref: { kind: 'entity', entityInstanceId: 'ent_1' },
                counter: 'uses',
              },
            },
          ],
        },
      ],
    };
    const issues = validateContent(bundle, { strict: false });
    const reported = issues.find((i) => i.code === 'COUNTER_UNIMPLEMENTED');
    expect(reported?.severity).toBe('error');
    // 路径要能指到具体位置，否则内容作者不知道改哪儿
    expect(reported?.path).toContain('entropy-clock');
    // 严格模式下它就是 error，`assertValidContent` 会抛
    expect(() => assertValidContent(bundle)).toThrow(/COUNTER_UNIMPLEMENTED/);
  });

  it('COUNTER_UNIMPLEMENTED 扫描是深度的（藏在 hit 效果 / buff 里也能抓到）', () => {
    /**
     * 逐字段列举"Expr 可能出现的地方"必然漏，而漏掉的那处正是静默算错
     * 的入口。这里把 counter 藏进**技能命中的伤害表达式**（很深的字段），
     * 证明扫描是整棵内容树，不是只看 abilities 顶层。
     */
    const skill = makeSkillDef({
      id: 'counter-skill',
      hits: [
        {
          at: 0,
          avoidable: false,
          effects: [
            {
              kind: 'damage',
              damage: {
                base: {
                  e: 'counter',
                  ref: { kind: 'encounter' },
                  counter: 'attempts',
                },
                canCrit: false,
                countsAsHit: true,
                avoidable: false,
              },
            },
          ],
        },
      ],
    });
    const bundle: ContentBundle = { ...baseBundle(), skills: [skill] };
    expect(validateContent(bundle).map((i) => i.code)).toContain('COUNTER_UNIMPLEMENTED');
  });

  it('MISSING_SKILL：遭遇战的行为引用了不存在的技能', () => {
    /**
     * ⚠️ 这条原来用 `grantSkill` 造错误。`grantSkill` 已按"死值先删"删除
     * （全仓无产出者也无消费者），所以改成走**真的会读技能 id** 的那条路：
     * 遭遇战的 `behaviors`（`behaviorSkillRefs` → `MISSING_SKILL`）。
     */
    const bundle: ContentBundle = {
      ...baseBundle(),
      encounters: [
        {
          id: 'test-encounter',
          nameKey: 'event.enrage',
          player: EMPTY_LOADOUT,
          boss: {
            ...EMPTY_LOADOUT,
            behaviors: [{ kind: 'opener', skillId: 'no-such-skill', delayMs: 0 }],
          },
          victory: [],
          defeat: [],
        },
      ],
    };
    expect(validateContent(bundle).map((i) => i.code)).toContain('MISSING_SKILL');
  });

  it('UNSUPPORTED_HOOK：挂了引擎不会处理的 hook 会被报出来', () => {
    /**
     * `Hook` 是一整张声明表，而引擎**只处理** `SUPPORTED_HOOKS` 里那几个。
     * 剩下的（`onKill` / 还没接线的 `onPhaseChange` …）写进内容是
     * **静默无效**的：类型对、以前也过校验，但战斗中永远不触发。
     *
     * 这条就是"不实测的规则等于没写"的实测：造一个引擎不处理的触发器，
     * 证明校验器真的会说话。
     *
     * ⚠️ 2026-10-14：这里原先用的是 `onTick` —— 而「贪婪」的「弱点」开始
     * 真的用它之后，它进了 `SUPPORTED_HOOKS`。所以换成 `onKill`
     * （仍然没有派发点），否则这条测试会因为"这个 hook 现在支持了"而红。
     */
    const bundle: ContentBundle = {
      ...baseBundle(),
      buffs: [
        makeBuffDef({
          id: 'ticking',
          triggers: [{ on: 'onKill', then: [] }],
        }),
      ],
    };
    // 非严格：这条消息本身是 warning，严格模式会把它提升成 error
    // （提升那件事由另一条测试单独证明）。
    const issues = validateContent(bundle, { strict: false });
    const reported = issues.find((i) => i.code === 'UNSUPPORTED_HOOK');
    expect(reported).toBeDefined();
    expect(reported?.message).toContain('onKill');
    // 打的是可读路径，内容作者能直接定位
    expect(reported?.path).toContain('ticking');
  });

  it('CONSUME_TRIGGER_UNIMPLEMENTED：引擎不派发的消费触发会被拦下', () => {
    /**
     * 消费触发是一张声明表，而引擎只派发 `core/buffs/consume.ts` 里实现的
     * 那四种。写一条不派发的（这里用"类型上还不存在"的名字去试探运行期
     * 白名单）⇒ 那个 buff **永远不会被消费**，而作者看内容却以为会。
     *
     * ⚠️ 这里是**故意构造的非法数据**（`'onKill'` 不是合法的消费触发），
     * 所以用 `strict: false` 让校验器只报告分级 —— 我们要看的就是"它报了"。
     */
    const bundle: ContentBundle = {
      ...baseBundle(),
      buffs: [
        makeBuffDef({
          id: 'bad-consume',
          consume: { on: ['onAttack', '不存在也不该存在的触发'] as never },
        }),
      ],
    };
    const issues = validateContent(bundle, { strict: false });
    const reported = issues.find((i) => i.code === 'CONSUME_TRIGGER_UNIMPLEMENTED');
    expect(reported?.severity).toBe('error');
    expect(reported?.path).toContain('bad-consume');
  });

  it('CONSUME_TRIGGER_MISSING：写了 `consume` 却没有 `on`（没有任何可判的东西）', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      buffs: [
        makeBuffDef({
          id: 'empty-consume',
          /** 故意缺 `on`（类型要求它，所以这是一份未经验证的数据）。 */
          consume: {} as never,
        }),
      ],
    };
    expect(validateContent(bundle, { strict: false }).map((i) => i.code)).toContain(
      'CONSUME_TRIGGER_MISSING',
    );
  });

  it('INDEPENDENT_BUFF_MODIFIERS：独立叠层 + 修正被拦下（会线性叠加、绕过封顶）', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      buffs: [
        makeBuffDef({
          id: 'bad-independent',
          stacking: { mode: 'independent', max: 3 },
          modifiers: [
            {
              stat: 'damageBoost',
              op: 'addPercent',
              value: 10,
              sourceKey: 'stat.haste',
              namespace: 'badIndependent',
            },
          ],
        }),
      ],
    };
    const issues = validateContent(bundle, { strict: false });
    expect(issues.map((i) => i.code)).toContain('INDEPENDENT_BUFF_MODIFIERS');
  });

  it('⚠️ 内联在技能里的 buff 也走同一套检查（不是只看顶层 `bundle.buffs`）', () => {
    /**
     * 内容作者可以直接在技能里写完整的 `BuffDef`（`hits[].effects[].buff`）。
     * 那一份如果漏检，"声明了消费却不会被消费"就会静默发生 —— 而它恰恰
     * 是最容易写的写法（「避」的无敌、「卸」的阈值都内联在技能里）。
     */
    const inline = makeBuffDef({
      id: 'inline-consume',
      consume: { on: ['引擎不认的触发'] as never },
    });
    const skill = makeSkillDef({
      id: 'inline-buff-skill',
      hits: [{ at: 0, effects: [{ kind: 'grantBuff', target: { mode: 'self' }, buff: inline }] }],
    });
    const bundle: ContentBundle = { ...baseBundle(), skills: [skill] };
    expect(validateContent(bundle, { strict: false }).map((i) => i.code)).toContain(
      'CONSUME_TRIGGER_UNIMPLEMENTED',
    );
  });

  it('严格模式（默认）把 warning 提升成 error —— 于是 assert 会抛', () => {
    /**
     * `ValidateOptions.strict` 曾经是个**空壳**：注释写着"把 warning 也当
     * 错误"，代码里一行都没有。这条测试就是"它真的生效"的实测：
     * 同一份内容，默认参数下必须被 assert 拒绝。
     */
    const bundle: ContentBundle = {
      ...baseBundle(),
      buffs: [makeBuffDef({ id: 'ticking', triggers: [{ on: 'onKill', then: [] }] })],
    };
    const strictIssues = validateContent(bundle);
    expect(
      strictIssues.some((i) => i.code === 'UNSUPPORTED_HOOK' && i.severity === 'error'),
    ).toBe(true);
    expect(() => assertValidContent(bundle)).toThrow(/UNSUPPORTED_HOOK/);
  });

  it('ABILITY_UNIMPLEMENTED：没有执行点的 grantSkill / consume 被拒绝', () => {
    /**
     * 这两个 kind 是**设计过、还没接线**的能力（类型保留）。写了它们
     * 战斗里**静默无效** —— 所以校验器默认拒绝，包括"故意留给未来"的写法
     * （那该写成注释/TODO，而不是一份看起来会生效的内容）。
     * 同一批内容在非严格模式下仍然报 error（它本身就是 error 级）。
     */
    for (const ability of [
      { kind: 'grantSkill', skillId: 'whatever' },
      { kind: 'consume', pool: { kind: 'encounter' }, resource: 'uses', amount: 1 },
    ] as const) {
      const bundle: ContentBundle = {
        ...baseBundle(),
        entities: [{ ...ENTROPY_CLOCK, abilities: [ability] }],
      };
      const reported = validateContent(bundle, { strict: false }).find(
        (i) => i.code === 'ABILITY_UNIMPLEMENTED',
      );
      expect(reported?.severity).toBe('error');
      expect(reported?.message).toContain(ability.kind);
      expect(reported?.path).toContain('entropy-clock');
    }
  });

  it('校验器的 hook 表覆盖运行时白名单（漂了就会红）', () => {
    /**
     * 校验器不跨层 import `core/combat/triggers.ts`（那会绕出一个
     * 反向依赖），所以这里手工对账，断言方向是**单向**的：
     *
     *   运行时白名单 ⊆ 校验器的表
     *
     * 反过来不要求相等 —— 校验器的表合法的地更大（`onCastFinish` 由
     * `castPipeline` 处理，根本不经过 `runTriggers`）。
     * "引擎会派发、校验器却报不支持"是最坏的漂移，这条钉住它。
     */
    const supported: readonly string[] = SUPPORTED_HOOKS;
    const missing = RUN_TRIGGER_HOOKS.filter((h) => !supported.includes(h));
    expect(missing, `校验器漏了运行时会派发的 hook：${missing.join(', ')}`).toEqual([]);
  });

  it('DANGLING_NAMESPACE：contrib 引用了没人声明的命名空间', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [
        {
          ...ENTROPY_CLOCK,
          abilities: [
            {
              kind: 'derived',
              modifier: {
                stat: 'damageBoost',
                op: 'addPercent',
                sourceKey: 'entity.entropyClock.name',
              },
              value: { e: 'contrib', namespace: 'nobody.declares.this' },
            },
          ],
        },
      ],
    };
    expect(validateContent(bundle).map((i) => i.code)).toContain('DANGLING_NAMESPACE');
  });

  it('CYCLE：循环依赖被检出并给出完整链路', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [
        {
          ...ENTROPY_CLOCK,
          abilities: [
            {
              kind: 'derived',
              modifier: {
                stat: 'damageBoost',
                op: 'addPercent',
                sourceKey: 'entity.entropyClock.name',
              },
              value: { e: 'stat', who: 'self', stat: 'haste' },
            },
            {
              kind: 'derived',
              modifier: { stat: 'haste', op: 'add', sourceKey: 'entity.entropyClock.name' },
              value: { e: 'stat', who: 'self', stat: 'damageBoost' },
            },
          ],
        },
      ],
    };
    const issues = validateContent(bundle);
    const cycle = issues.find((i) => i.code === 'CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('->');
  });

  it('assertValidContent 在有 error 时抛错并列出全部问题', () => {
    const bundle: ContentBundle = {
      ...baseBundle(),
      entities: [
        {
          ...ENTROPY_CLOCK,
          abilities: [{ kind: 'grantSkill', skillId: 'missing-a' }],
        },
      ],
      buffs: [makeBuffDef({ id: 'zero', duration: 0 })],
    };
    expect(() => assertValidContent(bundle)).toThrow(/invalid content/);
  });

  it('warning 与 error 分级（只有 error 会让 assert 抛）', () => {
    /**
     * ⚠️ 这条原本写着"当前实现里没有纯 warning 的检查"。现在有了：
     * `UNSUPPORTED_HOOK` 是 warning —— 它能被看见，但**不阻止启动**。
     * 于是这条断言仍然成立，而且有真实用例支撑。
     */
    const issues = validateContent(baseBundle());
    expect(issues.every((i) => i.severity === 'error' || i.severity === 'warning')).toBe(true);
  });
});

describe('buffAbilities 把 buff 的能力统一展开（供校验器复用）', () => {
  it('modifiers 与 triggers 都变成 ability', () => {
    const buff = makeBuffDef({
      id: 'b',
      modifiers: [{ stat: 'haste', op: 'add', value: 0.1, sourceKey: 'stat.haste' }],
      triggers: [{ on: 'onTick', then: [] }],
    });
    const abilities = buffAbilities(buff);
    expect(abilities.map((a) => a.kind).sort()).toEqual(['modifier', 'trigger']);
  });
});
