/**
 * 纯数据类型 开始
 * 即属性里没有function类型，单纯作为数据结构的约束
 */
export type ElementType = 'fire' | 'water'// | 'wind' |'water'  

export type TargetType = 'enemy' | 'ally' | 'self';

export type CharacterResource = keyof CharacterResources
export interface CharacterResources {
    health: number,
    mana: number,
    energy: number,
    fury: number,
}

export type CharacterAttribute = keyof CharacterAttributes
export interface CharacterAttributes {
    strength: number,
    agility: number,
    intelligence: number,
    spirit: number,
}

export interface CharacterEnhancements {
    // 暴击率
    criticalChance: number,
    // 暴击伤害
    criticalDamage: number,
    // 急速
    haste: number,
    // 元素精通
    mastery: {
        [key in ElementType]: number
    },
}

export interface CharacterObject {
    id: string,
    name: string,
    staticResources: CharacterResources,
    staticAttributes: CharacterAttributes,
    staticEnhancements: CharacterEnhancements
}

export interface RealtimeCharacterObject extends CharacterObject {
    castingSkillId?: string,
    castingTime?: number,
    resources: CharacterResources,
    attributes: CharacterAttributes,
    enhancements: CharacterEnhancements,
    overTimeEffects: Array<{
        effectId: string,
        skillId: string,
        lastTriggerTime: number,
        startTime: number,
        caster: RealtimeCharacterObject
    }>
}

export interface CharacterSkill {
    skillId: string,
    lastTriggerTime?: number
}

export interface Character extends CharacterObject {
    skills: Array<CharacterSkill>,
    slots: Array<Slot>
}

export interface RealtimeCharacter extends RealtimeCharacterObject {
    skills: Array<CharacterSkill>,
    slots: Array<Slot>
}

export interface RealtimeEnemy extends RealtimeCharacterObject {
}
export interface Enemy extends CharacterObject {
}

export interface Slot {
    // id: number
    key?: string,
    link?: {
        type: 'skill',
        id: string
    }
}
// 纯数据类型 结束

/**
 * 模型 开始
 * 即属性里有可能有function类型，只作为静态数据的数据结构，其他模块引用
 */
export interface EffectValueProps {
    caster: RealtimeCharacterObject,
    skill: Skill,
    target?: RealtimeCharacterObject
}

export type DirectEffectType = 'damage' | 'heal';
export type OverTimeEffectType = 'dot' | 'buff' | 'hot' | 'debuff';
export type EffectType = DirectEffectType | OverTimeEffectType;

export interface Effect<T = EffectType> {
    id: string,
    type: T,
    target: TargetType,
    on?: CharacterResource,
    value: number | ((props: EffectValueProps) => number)
}

export interface OverTimeEffect extends Effect {
    type: OverTimeEffectType,
    name?: string,
    interval: number,
    duration: number
}

export interface costValueProps {
    caster: Character,
    skill: Skill
}
export interface Cost {
    type: CharacterResource,
    value: number | ((props: costValueProps) => number)
}

export interface Skill {
    id: string,
    name: string,
    icon?: string,
    castTime: number,
    cooldown: number,
    cost: Array<Cost>,
    effects: Array<Effect | ContinuesEffect>,
    target: TargetType
}
// 模型 结束