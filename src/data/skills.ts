import { EffectValueProps, Skill } from "types/types";
import { v4 as uuid } from 'uuid';

export const skills: Array<Skill> = [{
    id: '11',
    name: '火球术',
    cooldown: 0,
    castTime: 1000,
    cost: [{
        type: 'mana',
        value: 400
    }],
    target: 'enemy',
    effects: [{
        id: uuid(),
        type: 'damage',
        target: 'enemy',
        value: 100
    }]
}, {
    id: '12',
    name: '龙破斩',
    target: 'enemy',
    cooldown: 10000,
    castTime: 2500,
    cost: [{
        type: 'mana',
        value: 2000
    }],
    effects: [{
        id: uuid(),
        type: 'damage',
        target: 'enemy',
        value: (props: EffectValueProps) => 8 * props.caster.attributes.intelligence
    }]
}, {
    id: '21',
    name: '割裂',
    target: 'enemy',
    cooldown: 0,
    castTime: 0,
    cost: [{
        type: 'fury',
        value: 1
    }],
    effects: [{
        id: uuid(),
        type: 'dot',
        target: 'enemy',
        value: (props: EffectValueProps) => 0.5 * props.caster.attributes.strength,
        interval: 3000,
        duration: 21000
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