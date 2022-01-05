

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Character, Cost, Skill, Enemy } from "types/types";

interface CharacterState {
    mainCharacter?: Character,
    target?: Character | Enemy | Array<Character | Enemy>
}

const initialState: CharacterState = {

}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        setMainCharacter: (state, { payload }: PayloadAction<Character>) => {
            const { staticAttributes, staticResource, staticEnhancements } = payload
            const { health, mana, energy } = staticResource;
            state.mainCharacter = {
                ...payload,
                realtimeResource: {
                    health,
                    mana,
                    energy,
                    fury: 0
                },
                realtimeAttributes: staticAttributes,
                realtimeEnhancements: staticEnhancements
            };
        },
        setTarget: (state, { payload }) => {
            state.target = payload;
        },
        startCasting: (state, { payload }) => {
            const { skill, time } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.castingSkill = skill;
                character.castingTime = time;
            }
        },
        doneCasting: (state) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkill = undefined;
                character.castingTime = undefined
            }
        },
        cancelCasting: (state, { payload }) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkill = undefined;
                character.castingTime = undefined
            }
        },
        costOnCharacter: (state, { payload }: PayloadAction<Skill>) => {
            const { cost } = payload as Skill;
            const character = state.mainCharacter;
            if (character) {
                cost.forEach(c => {
                    character.realtimeResource![c.type] -= c.value;
                })
            }
        },
        updateCost: (state, { payload }: PayloadAction<Cost>) => {
            const { type, value } = payload as Cost;
            const character = state.mainCharacter;
            if (character) {
                character.realtimeResource![type] = value;
            }
        }
    }
})

export const { setMainCharacter, setTarget, startCasting, doneCasting, cancelCasting, costOnCharacter, updateCost } = characterSlice.actions
export default characterSlice.reducer