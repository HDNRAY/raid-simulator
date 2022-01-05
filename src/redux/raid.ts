

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
    shown: boolean,
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
    raidStatus: 'stopped' | 'started',
    raidStartTime?: number,
    enemies: Array<EnemyInBattle>,
    effectHistory: Array<DamageLog>
}

const initialState: RaidState = {
    raidStatus: 'stopped',
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
        startRaid: (state, { payload }) => {
            state.raidStartTime = payload;
            state.raidStatus = 'started';
        },
        stopRaid: (state) => {
            state.raidStartTime = undefined;
            state.effectHistory = [];
            state.raidStatus = 'stopped';
        },
        updateEffectHistory: (state, { payload }) => {
            const ehIndex = state.effectHistory.findIndex(i => i.id === payload.id);
            if (ehIndex > -1) {
                state.effectHistory[ehIndex] = {
                    ...state.effectHistory[ehIndex],
                    ...payload
                }
            }
        },
        castSkillOnEnemy: (state, { payload }) => {
            const { target, skill, time, caster } = payload;
            const targetState = state.enemies.find(e => e.id === target);
            if (targetState) {
                skill.effect.forEach((effect: any) => {
                    if (effect.type === 'damage') {
                        targetState.status.health = targetState.status.health - effect.value;
                        state.effectHistory.push({
                            id: uuid(),
                            time,
                            type: 'battle',
                            value: effect.value,
                            target,
                            caster,
                            shown: false,
                            skill: {
                                ...skill
                            }
                        })
                    }
                })
                if (state.raidStatus === 'stopped') {
                    state.raidStatus = 'started';
                    state.raidStartTime = time;
                }
            }
        }
    }
})

export const { addEnemies, initEnemies, startRaid, stopRaid, castSkillOnEnemy, updateEffectHistory } = raidSlice.actions
export default raidSlice.reducer