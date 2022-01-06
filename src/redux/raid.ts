

import { createSlice } from "@reduxjs/toolkit";
import { Enemy, RealtimeEnemy } from "types/types";
import { v4 as uuid } from 'uuid';
import { Log } from "./log";

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
    skillId: string
}

interface RaidState {
    raidStatus: 'stopped' | 'started',
    raidStartTime?: number,
    enemies: Array<RealtimeEnemy>,
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
                const { staticAttributes, staticResources, staticEnhancements } = item;
                const { health, mana, energy } = staticResources;
                return {
                    ...item,
                    realtimeResources: {
                        health,
                        mana,
                        energy,
                        fury: 0
                    },
                    realtimeAttributes: staticAttributes,
                    realtimeEnhancements: staticEnhancements,
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
            const { type, targetId, value, skillId, time, caster } = payload;
            const target = state.enemies.find(e => e.id === targetId);
            console.log(target, targetId, value, skillId, time, caster)
            if (target) {
                if (type === 'health') {
                    target.realtimeResources.health = target.realtimeResources!.health - value;
                    state.effectHistory.push({
                        id: uuid(), time, type: 'battle',
                        value,
                        target,
                        caster,
                        shown: false,
                        skillId
                    })
                }
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