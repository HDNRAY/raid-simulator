

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Character, RealtimeCharacter, CharacterResource, RealtimeEnemy } from "types/types";

interface CharacterState {
    mainCharacter?: RealtimeCharacter,
    target?: RealtimeCharacter | RealtimeEnemy | Array<RealtimeCharacter | RealtimeEnemy>
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
                realtimeResources: {
                    health,
                    mana,
                    energy,
                    fury: 0
                },
                realtimeAttributes: staticAttributes,
                realtimeEnhancements: staticEnhancements,
                continuesEffect: []
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
                character.realtimeResources[type] -= value;
            }
        },
        updateCost: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.realtimeResources[type] = value;
            }
        }
    }
})

export const { setMainCharacter, setTarget, triggerSkillCooldown, startCasting, doneCasting, cancelCasting, costOnCharacter, updateCost } = characterSlice.actions
export default characterSlice.reducer