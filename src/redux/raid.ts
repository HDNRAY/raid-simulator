

import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuid } from 'uuid';
import { Log } from "./log";

export interface Enemy {
    id: string,
    name: string,
    health: number
}

export interface DamageLog extends Log {
    type: 'battle',
    value: number,
    target: {
        id?: string,
        name: string
    }
    caster: {
        id?: string,
        name: string
    },
    skill: {
        name: string,
        id: string
    }
}

export interface EnemyInBattle extends Enemy {
    status: {
        health: number
    }
}

interface RaidState {
    raidStartTime?: number,
    enemies: Array<EnemyInBattle>,
    effectHistory: Array<DamageLog>
}

const initialState: RaidState = {
    enemies: [],
    effectHistory: []
}

const raidSlice = createSlice({
    name: 'raid',
    initialState,
    reducers: {
        initEnemies: (state, { payload }) => {
            state.enemies = payload.map((item: Enemy) => {
                return {
                    ...item,
                    status: {
                        ...item
                    }
                }
            });
        },
        addEnemies: (state, { payload }) => {
            state.enemies.push({
                id: uuid(),
                ...payload
            });
        },
        castSkillOnEnemy: (state, { payload }) => {
            const { targetId, skill } = payload;
            const target = state.enemies.find(i => i.id === targetId);
            if (target) {
                skill.effect.forEach((effect: any) => {
                    if (effect.type === 'damage') {
                        target.status.health = target.status.health - effect.value;
                        state.effectHistory.push({
                            id: uuid(),
                            time: new Date().getTime(),
                            type: 'battle',
                            value: effect.value,
                            target,
                            caster: {
                                name: '你'
                            },
                            skill: {
                                ...skill
                            }
                        })
                    }
                })
            }
        }
    }
})

export const { addEnemies, initEnemies, castSkillOnEnemy } = raidSlice.actions
export default raidSlice.reducer