

import { createSlice } from "@reduxjs/toolkit";
import { Skill } from "types/types";

interface SkillState {
    skills: Array<Skill>
}

const initialState: SkillState = {
    skills: []
}

const skillSlice = createSlice({
    name: 'skill',
    initialState,
    reducers: {
        setupSkills: (state, { payload }) => {
            state.skills = payload;
        },
        triggerSkillCooldown: (state, { payload }) => {
            const { skillId, time } = payload;
            const skill = state.skills.find(s => s.id === skillId)
            if (skill) {
                skill.lastTriggerTime = time;
            }
        }
    }
})

export const { triggerSkillCooldown, setupSkills } = skillSlice.actions
export default skillSlice.reducer