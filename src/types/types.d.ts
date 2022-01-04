export interface CharacterResource {
    health: number,
    mana: number,
    energy: number,
    fury: number,
}

export interface CharacterAttributes {
    strength: number,
    agility: number,
    intelligence: number,
    spirit: number,
}

export interface Character {
    id: string,
    name: string,
    castingSkill?: Skill,
    castingTime?: number,
    staticResource: CharacterResource,
    realtimeResource?: CharacterResource,
    staticAttributes: CharacterAttributes,
    realtimeAttributes?: CharacterAttributes,
    skills: Array<string>,
    slots: Array<Slot>
}

export interface Effect {
    type: 'damage' | 'dot',
    value: number,
    duration?: number,
    interval?: number
}

export interface Cost {
    type: 'mana' | 'energy' | 'health' | 'fury',
    value: number
}

export interface Skill {
    id: string,
    name: string,
    icon?: string,
    castTime: number,
    cooldown: number,
    cost: Array<Cost>,
    effect: Array<Effect>
    lastTriggerTime?: number,
}

export interface Slot {
    // id: number
    key?: string,
    link?: {
        type: 'skill',
        id: string,
        skill?: Skill
    }
}