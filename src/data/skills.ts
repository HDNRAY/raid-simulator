import { Skill } from "redux/skill";

export const skills: Array<Skill> = [{
    id: '1',
    name: '寒冰箭',
    cooldown: 2000,
    cost: [],
    effect: [{
        type: 'damage',
        value: 200
    }]
}, {
    id: '2',
    name: '火球术',
    cooldown: 2500,
    cost: [],
    effect: [{
        type: 'damage',
        value: 300
    }]
}]