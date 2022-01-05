import { Enemy } from "types/types";
import { v4 as uuid } from 'uuid';

export const enemies: Array<Enemy> = [{
    id: uuid(),
    name: '一号BOSS',
    staticResource: {
        health: 100000,
        mana: 10000,
        energy: 120,
        fury: 0
    },
    staticAttributes: {
        strength: 1000,
        agility: 1000,
        intelligence: 1000,
        spirit: 1000
    },
    staticEnhancements: {
        criticalChance: 0.05,
        criticalDamage: 1.5,
        haste: 0,
        elementMastery: {
            fire: 0,
            water: 0
        }
    },
}]