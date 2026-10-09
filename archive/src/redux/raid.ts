

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CharacterObject, CharacterResource, RealtimeEnemyInterface } from "types/types";
import { v4 as uuid } from 'uuid';
import { Log } from "./log";

export interface DamageLog extends Log {
    type: 'battle',
    value: number,
    shown: boolean,
    critical?: boolean,
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
    enemies: Array<RealtimeEnemyInterface>,
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
            state.enemies = payload;
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
        addEnemyOverTimeEffect: (state, { payload }) => {
            const { targetId, effectId, skillId, startTime, caster, interval } = payload;
            const target = state.enemies.find(e => e.id === targetId);
            if (target) {
                const existIndex = target.overTimeEffects.findIndex(i => i.effectId === effectId);
                if (existIndex > -1) {
                    target.overTimeEffects.splice(existIndex, 1);
                }
                target.overTimeEffects.push({
                    interval, effectId, skillId, startTime, caster,
                    lastTriggerTime: startTime
                })
            }
        },
        updateEnemyOverTimeEffect: (state, { payload }) => {
            const { targetId, effectId, skillId, time } = payload;
            const target = state.enemies.find(e => e.id === targetId);
            if (target) {
                const effect = target.overTimeEffects.find(i => i.skillId === skillId && i.effectId === effectId);
                if (effect) {
                    effect.lastTriggerTime = time;
                }
            }
        },
        removeEnemyOverTimeEffect: (state, { payload }) => {
            const { targetId, effectId } = payload;
            const target = state.enemies.find(e => e.id === targetId);
            if (target) {
                const index = target.overTimeEffects.findIndex(i => i.effectId === effectId);
                target.overTimeEffects.splice(index, 1);
            }
        },
        effectOnEnemy: (state, { payload }: PayloadAction<{
            effected: CharacterResource,
            critical: boolean,
            targetId: string,
            skillId: string,
            caster: CharacterObject,
            value: number,
            time: number,
            pon: 1 | -1
        }>) => {
            const { effected, targetId, value, skillId, time, caster, pon, critical } = payload;
            const target = state.enemies.find(e => e.id === targetId);

            if (target) {
                if (effected === 'health') {
                    target.resources.health = target.resources.health + pon * value;
                }

                state.effectHistory.push({
                    id: uuid(), time, type: 'battle', shown: false, critical, value, target, caster, skillId
                })
            }
            if (state.raidStatus === 'stopped') {
                state.raidStatus = 'started';
                state.raidStartTime = time;
            }
        }
    }
})

export const { addEnemies, initEnemies,
    startRaid, stopRaid,
    effectOnEnemy, updateEffectHistory,
    addEnemyOverTimeEffect, updateEnemyOverTimeEffect, removeEnemyOverTimeEffect
} = raidSlice.actions
export default raidSlice.reducer