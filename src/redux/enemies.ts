

import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuid } from 'uuid';

export interface Enemy {
    id: string,
    name: string,
    health: number
}

export interface EnemyInBattle extends Enemy {
    status: {
        health: number
    }
}

interface EnemiesState {
    enemies: Array<EnemyInBattle>,
}

const initialState: EnemiesState = {
    enemies: [],
}

const enemiesSlice = createSlice({
    name: 'enemies',
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
                    }
                })
            }
        }
    }
})

export const { addEnemies, initEnemies, castSkillOnEnemy } = enemiesSlice.actions
export default enemiesSlice.reducer