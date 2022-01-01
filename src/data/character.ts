
import { Character } from 'types/types';
import { v4 as uuid } from 'uuid';

export const you: Character = {
    id: uuid(),
    name: "张语寒",
    staticResource: {
        health: 10000,
        mana: 10000,
        energy: 120,
        fury: 0
    },
    staticAttributes: {
        strength: 100,
        agility: 100,
        intelligence: 100,
        spirit: 100
    },
    skills: ['1', '2'],
    slots: [{
        key: '1',
        link: {
            type: 'skill',
            id: '1'
        }
    }, {
        key: '2',
        link: {
            type: 'skill',
            id: '2'
        }
    }, {
        key: '3'
    }, {
        key: '4'
    }, {
        key: 'Q'
    }]
}