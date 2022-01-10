

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Character, RealtimeCharacter, CharacterResource, TargetType } from "types/types";

interface CharacterState {
    mainCharacter?: RealtimeCharacter,
    target?: {
        type: TargetType,
        id: string
    } | Array<{
        type: TargetType,
        id: string
    }>
}

const initialState: CharacterState = {

}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        setMainCharacter: (state, { payload }: PayloadAction<Character>) => {
            const { staticAttributes, staticResources: staticResource, staticEnhancements } = payload
            const { health, mana, energy } = staticResource;
            state.mainCharacter = {
                ...payload,
                resources: {
                    health,
                    mana,
                    energy,
                    fury: 0
                },
                attributes: staticAttributes,
                enhancements: staticEnhancements,
                overTimeEffects: []
            };
        },
        setTarget: (state, { payload }) => {
            state.target = payload;
        },
        triggerSkillCooldown: (state, { payload }) => {
            const { skillId, time } = payload;
            const skill = state.mainCharacter?.skills.find(s => s.skillId === skillId)
            if (skill) {
                skill.lastTriggerTime = time;
            }
        },
        startCasting: (state, { payload }) => {
            const { skillId, time } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = skillId;
                character.castingTime = time;
            }
        },
        doneCasting: (state) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = undefined;
                character.castingTime = undefined
            }
        },
        cancelCasting: (state, { payload }) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = undefined;
                character.castingTime = undefined
            }
        },
        costOnCharacter: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.resources[type] -= value;
            }
        },
        updateCost: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.resources[type] = Math.round(value);
            }
        },
        recoverCost: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                const newValue = character.resources[type] + value;
                character.resources[type] = Math.min(character.staticResources[type], Math.round(newValue));
            }
        },
    }
})

export const { setMainCharacter, setTarget, triggerSkillCooldown, startCasting, doneCasting, cancelCasting, costOnCharacter, updateCost, recoverCost } = characterSlice.actions
export default characterSlice.reducer