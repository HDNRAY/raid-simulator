/**
 * 纯数据类型 开始
 * 即属性里没有function类型，单纯作为数据结构的约束
 */
export type ElementType = 'fire' | 'water'// | 'wind' |'water'  

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
    castingSkillId?: string,
    castingTime?: number,
    staticResources: CharacterResources,
    realtimeResources?: CharacterResources,
    staticAttributes: CharacterAttributes,
    realtimeAttributes?: CharacterAttributes,
    staticEnhancements: CharacterEnhancements,
    realtimeEnhancements?: CharacterEnhancements,
    continuesEffect?: Array<{
        effectId: string,
        startTime: number
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
export type EffectType = 'damage' | 'heal' | ContinuesEffectType;
export interface Effect {
    type: EffectType,
    on?: string,
    value: number
}

export type ContinuesEffectType = 'dot' | 'buff' | 'hot' | 'debuff';
export interface ContinuesEffect extends Effect {
    type: ContinuesEffectType,
    name: string,
    repeat: number,
    duration: number
}

export interface Cost {
    type: CharacterResource,
    value: number
}

export interface Skill {
    id: string,
    name: string,
    icon?: string,
    castTime: number,
    cooldown: number,
    cost: Array<Cost>,
    effect: Array<Effect | ContinuesEffect>,
    target: 'enemy' | 'ally' | 'all' | 'self'
}
// 模型 结束