

import { createSlice } from "@reduxjs/toolkit";
import { skills } from "data/skills";

export interface Effect {
    type: 'damage' | 'dot',
    value: number,
    duration?: number,
    interval?: number
}

export interface Cost {
    type: 'mana',
    value: number
}

export interface Skill {
    id: string,
    name: string,
    icon?: string,
    cooldown: number,
    cost: Array<Cost>,
    effect: Array<Effect>
    lastTriggerTime?: number,
}

interface SkillState {
    skills: Array<Skill>
}

const initialState: SkillState = {
    skills
}

const skillSlice = createSlice({
    name: 'skill',
    initialState,
    reducers: {
        triggerSkillCooldown: (state, { payload }) => {
            const skill = state.skills.find(s => s.id === payload)
            if (skill) {
                skill.lastTriggerTime = new Date().getTime();
            }
        }
    }
})

export const { triggerSkillCooldown } = skillSlice.actions
export default skillSlice.reducer