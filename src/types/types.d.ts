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


export type CharacterEnhancement = keyof CharacterEnhancements
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
    // 释放的技能
    castingSkillId?: string,
    // 释放的时间
    castingTime?: number,
    // 释放时，需要的读条时间，受急速等影响
    castTime?: number,
    // 实时资源
    resources: CharacterResources,
    // 可用资源上限
    availableResources: CharacterResources,
    // 实时属性
    attributes: CharacterAttributes,
    // 实时次级属性
    enhancements: CharacterEnhancements,
    // buff & debuff
    overTimeEffects: Array<{
        effectId: string,
        skillId: string,
        lastTriggerTime: number,
        interval: number,
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
export type EffectValueFunction = (props: EffectValueProps) => number
export interface EffectValueProps {
    caster: RealtimeCharacterObject,
    skill?: Skill,
    effect: Effect,
    target?: RealtimeCharacterObject
}

export type DirectEffectType = 'damage' | 'heal';
export type OverTimeEffectType = 'dot' | 'buff' | 'hot' | 'debuff';
export type EffectType = DirectEffectType | OverTimeEffectType;

export interface Effect<T = EffectType> {
    id: string,
    type: T,
    target: TargetType,
    on?: CharacterResource | CharacterAttribute | CharacterEnhancement,
    value: number | EffectValueFunction
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

/**
 * 主动技能，包括dot，debuff
 */
export interface Skill {
    id: string,
    name: string,
    icon?: string,
    castTime: number,
    cooldown: number,
    cost: Array<Cost>,
    effects: Array<Effect | OverTimeEffect>,
    target: TargetType
}

/**
 * 被动技能，特殊效果，如占用蓝上限，提供急速
 */
export interface Talent {
    id: string,
    name: string,
    icon?: string,
    costs: any,
    effects: any
}
// 模型 结束