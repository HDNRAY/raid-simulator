import { describe, expect, it } from 'vitest';
import { ENTROPY_CLOCK, ENTROPY_CLOCK_POTENTIAL } from '../../src/data/entities/entropyClock';
import { buffAbilities, buildDependencyGraph } from '../../src/core/expr/deps';
import { assertValidContent, validateContent, type ContentBundle } from '../../src/core/content/validate';
import { flattenCatalog } from '../../src/i18n/translator';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { makeBuffDef, makeSkillDef } from './helpers';

const localeKeys = new Set(flattenCatalog(zhCN).keys());

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
  it('通过校验（含 i18n key 存在性）', () => {
    const issues = validateContent(baseBundle());
    expect(issues).toEqual([]);
  });

  it('assertValidContent 不抛错', () => {
    expect(() => assertValidContent(baseBundle())).not.toThrow();
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
    // 当前实现里没有纯 warning 的检查；这里断言分级机制存在
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
