import { EffectValueProps, Skill } from "types/types";

export const skills: Array<Skill> = [{
    id: '11',
    name: '火球术',
    cooldown: 0,
    castTime: 2000,
    cost: [{
        type: 'mana',
        value: 250
    }],
    target: 'all',
    effects: [{
        type: 'damage',
        value: 300
    }]
}, {
    id: '12',
    name: '豪火球',
    cooldown: 10000,
    castTime: 2500,
    target: 'all',
    cost: [{
        type: 'mana',
        value: 560
    }],
    effects: [{
        type: 'damage',
        value: 1500
    }]
}, {
    id: '13',
    name: '龙破斩',
    target: 'all',
    cooldown: 0,
    castTime: 2500,
    cost: [{
        type: 'mana',
        value: 1000
    }],
    effects: [{
        type: 'damage',
        value: (props: EffectValueProps) => 21 * props.caster.realtimeAttributes.intelligence
    }]
}, {
    id: '00',
    name: '翻滚',
    target: 'self',
    cooldown: 0,
    castTime: 0,
    cost: [{
        type: 'energy',
        value: 30
    }],
    effects: []
}]

export const skillMap: { [key: string]: Skill } = skills.reduce((result: any, skill) => {
    result[skill.id] = skill;
    return result;
}, {})