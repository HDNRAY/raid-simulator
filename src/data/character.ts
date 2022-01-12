
import { Character } from 'types/types';
import { v4 as uuid } from 'uuid';

export const you: Character = {
    id: uuid(),
    name: "张语寒",
    staticResources: {
        health: 10000,
        mana: 10000,
        energy: 120,
        fury: 100
    },
    staticAttributes: {
        strength: 100,
        agility: 100,
        intelligence: 100,
        spirit: 100
    },
    staticEnhancements: {
        criticalChance: 0.5,
        criticalDamage: 1.5,
        haste: 0,
        mastery: {
            fire: 0,
            water: 0
        }
    },
    skills: [{ skillId: '11' }, { skillId: '12' }, { skillId: '21' }, { skillId: '00' }, { skillId: '32' }],
    slots: [{
        key: '1',
        link: {
            type: 'skill',
            id: '11'
        }
    }, {
        key: '2',
        link: {
            type: 'skill',
            id: '12'
        }
    }, {
        key: '3',
        link: {
            type: 'skill',
            id: '21'
        }
    }, {
        key: 'C'
    }, {
        key: 'Q',
        link: {
            type: 'skill',
            id: '00'
        }
    }, {
        key: 'E',
        link: {
            type: 'skill',
            id: '32'
        }
    }, {
        key: 'R',
    }, {
        key: 'T'
    }, {
        key: 'F'
    }, {
        key: 'G'
    }]
}