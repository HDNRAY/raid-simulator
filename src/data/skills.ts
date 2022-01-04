import { Skill } from "types/types";

export const skills: Array<Skill> = [{
    id: '11',
    name: '火球术',
    cooldown: 0,
    castTime: 2000,
    cost: [{
        type: 'mana',
        value: 250
    }],
    effect: [{
        type: 'damage',
        value: 300
    }]
}, {
    id: '12',
    name: '豪火球',
    cooldown: 10000,
    castTime: 2500,
    cost: [{
        type: 'mana',
        value: 560
    }],
    effect: [{
        type: 'damage',
        value: 1500
    }]
}, {
    id: '13',
    name: '龙破斩',
    cooldown: 0,
    castTime: 2500,
    cost: [{
        type: 'mana',
        value: 1000
    }],
    effect: [{
        type: 'damage',
        value: 2000
    }]
}, {
    id: '00',
    name: '翻滚',
    cooldown: 0,
    castTime: 0,
    cost: [{
        type: 'energy',
        value: 30
    }],
    effect: []
}]

export const skillMap: { [key: string]: Skill } = skills.reduce((result: any, skill) => {
    result[skill.id] = skill;
    return result;
}, {})