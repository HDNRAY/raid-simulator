

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Character } from "types/types";

interface CharacterState {
    mainCharacter?: Character,
}

const initialState: CharacterState = {

}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        setMainCharacter: (state, { payload }: PayloadAction<Character>) => {
            const { staticAttributes, staticResource } = payload
            const { health, mana, energy } = staticResource;
            state.mainCharacter = {
                ...payload,
                realtimeResource: {
                    health,
                    mana,
                    energy,
                    fury: 0
                },
                realtimeAttributes: staticAttributes
            };
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
        }
    }
})

export const { setMainCharacter, startCasting, doneCasting, cancelCasting } = characterSlice.actions
export default characterSlice.reducer