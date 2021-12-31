import { Skill } from "redux/skill";

export const skills: Array<Skill> = [{
    id: '1',
    name: '火球术',
    cooldown: 0,
    castTime: 2500,
    cost: [],
    effect: [{
        type: 'damage',
        value: 300
    }]
}, {
    id: '2',
    name: '豪火球',
    cooldown: 10000,
    castTime: 2000,
    cost: [],
    effect: [{
        type: 'damage',
        value: 1500
    }]
}]