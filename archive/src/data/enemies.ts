import { EnemyInterface } from "types/types";

export const enemyData: Array<EnemyInterface> = [{
    id: '0001',
    name: 'フォ死と',
    staticResources: {
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
        mastery: {
            fire: 0,
            water: 0
        }
    },
}]