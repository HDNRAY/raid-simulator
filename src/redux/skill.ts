

import { createSlice } from "@reduxjs/toolkit";

export interface Skill {
    id: string,
    name: string,
    cd: number,
    lastTriggerTime?: number,
    icon?: string
}

interface SkillState {
    skills: Array<Skill>
}

const initialState: SkillState = {
    skills: [{
        id: '1',
        name: '寒冰箭',
        cd: 2500
    }]
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